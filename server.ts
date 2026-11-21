import express from 'express';
import type { Request, Response } from 'express';
import http from 'http';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type, ThinkingLevel, Modality, type LiveServerMessage } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PRIMARY_MODEL = 'gemini-4-hydrogen';
const FAST_MODEL = 'gemini-3.1-flash-lite';
const TOPIC_SPEAKING_AUDIO_MODELS = {
  live: ['gemini-3.8-live', 'gemini-2.5-flash-native-audio-preview'],
  tts: ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts'],
} as const;

const TOPIC_SPEAKING_VOICE_CONFIG = {
  voices: ['Achird', 'Sulafat', 'Zephyr', 'Puck', 'Charon', 'Kore', 'Aoede', 'Leda'] as const,
  defaultVoice: 'Aoede',
  styleInstruction:
    'You are a warm, wise, kind, patient human American English teacher having a genuine 1-on-1 voice conversation with your student in French and English. Speak with a completely natural, relaxed human voice — expressive conversational melody, soft natural breaths between thoughts, gentle vocal warmth, real rises and falls in pitch, unhurried and deeply human (never robotic, never monotone, never stiff, never like a screen reader). Speak all French coaching in warm, fluid, natural Parisian French, and pronounce every English word, phrase, and corrected sentence in effortless, authentic General American English (retroflex American R, clear interdental TH, flap T, silent T and glottal stop, connected speech with schwa, natural American stress and rhythm). Deliver every correction and example from the provided coaching notes faithfully in order without skipping any error and without inventing unrelated topics.',
} as const;
const MAX_RETRIES_PER_MODEL = 2;

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[Gemini] WARNING: GEMINI_API_KEY environment variable is not set!');
  }
  return new GoogleGenAI({
    apiKey: apiKey || '',
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getThinkingLevelForModel(modelName: string): ThinkingLevel {
  if (modelName === FAST_MODEL) {
    return ThinkingLevel.MINIMAL;
  }
  return ThinkingLevel.LOW;
}

function getThinkingConfigForModel(modelName: string) {
  return { thinkingLevel: getThinkingLevelForModel(modelName) };
}

/**
 * Custom error class preserving HTTP status codes for clean API responses.
 */
class ApiError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function formatFriendlyGeminiError(err: Error | null): ApiError {
  const msg = err?.message || '';
  if (msg.includes('PERMISSION_DENIED') || msg.includes('API_KEY_INVALID') || msg.includes('403')) {
    return new ApiError(
      403,
      'Kle API Gemini an pa valab oswa li manke. Tanpri tcheke Settings > Secrets.'
    );
  }
  if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
    const isDailyQuota =
      msg.includes('PerDay') || msg.includes('RequestsPerDay') || msg.includes('FreeTier');
    if (isDailyQuota) {
      return new ApiError(
        429,
        'Limit rekèt gratis pou jodi a fini (Free-tier quota exceeded). Ajoute yon kle ki gen billing nan Settings > Secrets oswa eseye ankò pita.'
      );
    }
    return new ApiError(
      429,
      'Anpil rekèt ale twò vit kounye a. Tanpri tann 5 segonn epi eseye ankò.'
    );
  }
  if (msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('overloaded')) {
    return new ApiError(
      503,
      'Sèvis AI a okipe anpil kounye a. Tanpri eseye ankò nan kèk segonn.'
    );
  }
  if (msg.includes('Timeout')) {
    return new ApiError(
      504,
      'AI a pran twòp tan pou l reponn. Tanpri eseye ankò.'
    );
  }
  return new ApiError(
    500,
    'Echèk koneksyon ak AI (AI connection failed). Tanpri eseye ankò.'
  );
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms (${label})`)), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}

interface GeminiCallMeta<T> {
  data: T;
  modelUsed: string;
  elapsedMs: number;
}

/**
 * Robust execution with retry and fast failover across primary and fallback models.
 */
async function callGeminiWithRetry<T>(
  requestFn: (ai: GoogleGenAI, modelName: string) => Promise<string | undefined>,
  parser: (rawText: string) => T,
  modelOrder?: string[],
  perAttemptTimeoutMs: number = 15000
): Promise<GeminiCallMeta<T>> {
  const ai = getGeminiClient();
  const models = modelOrder || [FAST_MODEL, PRIMARY_MODEL];
  let lastError: Error | null = null;
  const totalStart = Date.now();

  for (let mIdx = 0; mIdx < models.length; mIdx++) {
    const currentModel = models[mIdx];
    let attempt = 0;

    while (attempt < MAX_RETRIES_PER_MODEL) {
      attempt++;
      const t0 = Date.now();
      try {
        const rawResponse = await withTimeout(
          requestFn(ai, currentModel),
          perAttemptTimeoutMs,
          currentModel
        );
        if (!rawResponse || !rawResponse.trim()) {
          throw new Error('Empty response received from Gemini.');
        }

        const parsed = parser(rawResponse);
        const attemptMs = Date.now() - t0;
        console.log(`[Gemini Server] ${currentModel} succeeded in ${attemptMs}ms`);
        return {
          data: parsed,
          modelUsed: currentModel,
          elapsedMs: Date.now() - totalStart,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const msg = lastError.message;
        console.warn(
          `[Gemini Server] Model ${currentModel} attempt ${attempt} failed after ${Date.now() - t0}ms:`,
          msg
        );

        // Auth / API key errors will not succeed on another model or retry
        if (msg.includes('PERMISSION_DENIED') || msg.includes('API_KEY_INVALID')) {
          throw formatFriendlyGeminiError(lastError);
        }

        const isDailyQuota = msg.includes('PerDay') || msg.includes('RequestsPerDay');
        const isRateLimit = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED');
        const isTransientBusy =
          msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('overloaded');

        // Switch immediately to next model on 404, 400, timeout, or daily quota exhaustion
        if (
          msg.includes('404') ||
          msg.includes('NOT_FOUND') ||
          msg.includes('400') ||
          msg.includes('INVALID_ARGUMENT') ||
          msg.includes('Timeout') ||
          isDailyQuota
        ) {
          break;
        }

        if (attempt < MAX_RETRIES_PER_MODEL) {
          const backoff = isRateLimit
            ? 1500
            : isTransientBusy
              ? 700
              : 300 * Math.pow(2, attempt - 1);
          await delay(backoff);
        }
      }
    }
  }

  throw formatFriendlyGeminiError(lastError);
}

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  // Prevent Node's 5s default keepAliveTimeout from causing ECONNRESET / "Failed to fetch" behind Cloud Run / reverse proxies
  httpServer.keepAliveTimeout = 65000;
  httpServer.headersTimeout = 66000;
  httpServer.requestTimeout = 120000;
  // AI Studio requires the dev server to run strictly on port 3000
  const PORT = 3000;
  const isProd = process.env.NODE_ENV === 'production';

  // Support large audio base64 uploads (up to 100MB for long recordings)
  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ extended: true, limit: '100mb' }));

  // Health check endpoint
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  /**
   * POST /api/gemini/group-and-translate
   * Mode A: Group transcript lines into practice segments and translate to Haitian Creole
   */
  app.post('/api/gemini/group-and-translate', async (req: Request, res: Response) => {
    try {
      const { lines, videoTitle } = req.body;
      if (!Array.isArray(lines) || lines.length === 0) {
        res.status(400).json({ error: 'Missing or empty transcript lines.' });
        return;
      }

      const CHUNK_SIZE = 45;
      const chunks: { index: number; text: string }[][] = [];
      for (let i = 0; i < lines.length; i += CHUNK_SIZE) {
        chunks.push(lines.slice(i, i + CHUNK_SIZE));
      }

      let resolvedTitle = typeof videoTitle === 'string' && videoTitle.trim() ? videoTitle.trim() : '';
      const allSegments: {
        from: number;
        to: number;
        en: string;
        kr: string;
        vocab: { w: string; kr: string }[];
      }[] = [];
      let lastModelUsed = PRIMARY_MODEL;
      let totalElapsedMs = 0;

      for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
        const chunk = chunks[cIdx];
        const firstLineNum = chunk[0].index;
        const lastLineNum = chunk[chunk.length - 1].index;

        const formattedText = chunk
          .map((l: { index: number; text: string }) => `[${l.index}] ${l.text}`)
          .join('\n');

        const systemInstruction = `You are an expert English-to-Haitian Creole (Kreyòl Ayisyen) language educator.
The user provides numbered transcript lines from an English YouTube video: "[index] spoken text".
Your job is to group consecutive lines into clean practice segments, translate them into natural Haitian Creole, and extract 1-3 useful vocabulary words.

CRITICAL REQUIREMENT (FÒK TOUT PAWÒL KI DI NAN VIDEO A LADANN):
1. You MUST include ALL lines from [${firstLineNum}] to [${lastLineNum}] consecutively without skipping ANY line or word.
2. Segment 1 in this batch starts at line [${firstLineNum}]. Each next segment starts at the line immediately following the previous segment. The final segment in this batch must end at line [${lastLineNum}].
3. DO NOT skip any spoken line, intro, conversation, or thought.
4. Each segment starts at the beginning of a sentence and ends at the end of a sentence or complete thought (approx 5 to 20 seconds, max ~25 words).
5. "en" must match ONLY the exact words of lines [from..to] (clean punctuation and capitalization; NEVER add, invent, or pull words from other lines).
6. "kr" = natural, faithful Haitian Creole (Kreyòl Ayisyen) translation of the spoken English in "en".
7. "vocab" = up to 3 useful words or expressions from the segment with their Creole meaning.
8. "from" and "to" must be the exact line numbers from the input ([${firstLineNum}]..[${lastLineNum}]).`;

        const prompt = `Title of video (if known): "${videoTitle || 'English Practice Video'}"

Here are the numbered transcript lines from [${firstLineNum}] to [${lastLineNum}]:
${formattedText}

CRITICAL: Cover ALL lines from ${firstLineNum} to ${lastLineNum} consecutively without skipping any line or shifting line numbers. Return JSON.`;

        const result = await callGeminiWithRetry(
          async (ai, modelName) => {
            const response = await ai.models.generateContent({
              model: modelName,
              contents: prompt,
              config: {
                systemInstruction,
                responseMimeType: 'application/json',
                thinkingConfig: {
                  thinkingLevel: getThinkingLevelForModel(modelName),
                },
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    title: {
                      type: Type.STRING,
                      description: 'A clean title for the video lesson',
                    },
                    segments: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          from: {
                            type: Type.INTEGER,
                            description: 'Starting line number of this segment',
                          },
                          to: {
                            type: Type.INTEGER,
                            description: 'Ending line number of this segment (inclusive)',
                          },
                          en: {
                            type: Type.STRING,
                            description: 'Exact English spoken text from these lines with clean punctuation',
                          },
                          kr: {
                            type: Type.STRING,
                            description: 'Natural Haitian Creole translation',
                          },
                          vocab: {
                            type: Type.ARRAY,
                            items: {
                              type: Type.OBJECT,
                              properties: {
                                w: { type: Type.STRING, description: 'English word or expression' },
                                kr: { type: Type.STRING, description: 'Haitian Creole translation' },
                              },
                              required: ['w', 'kr'],
                            },
                          },
                        },
                        required: ['from', 'to', 'en', 'kr', 'vocab'],
                      },
                    },
                  },
                  required: ['title', 'segments'],
                },
              },
            });
            return response.text;
          },
          (rawText) => {
            const parsed = JSON.parse(rawText);
            if (!parsed || !Array.isArray(parsed.segments) || parsed.segments.length === 0) {
              throw new Error('Empty segment list returned by Gemini.');
            }
            return parsed;
          },
          [PRIMARY_MODEL, FAST_MODEL],
          45000
        );

        lastModelUsed = result.modelUsed;
        totalElapsedMs += result.elapsedMs;
        if (!resolvedTitle && result.data.title) {
          resolvedTitle = result.data.title;
        }
        allSegments.push(...result.data.segments);
      }

      res.setHeader('X-Model-Used', lastModelUsed);
      res.setHeader('X-Gemini-Ms', String(totalElapsedMs));
      res.json({
        title: resolvedTitle || 'English Practice Video',
        segments: allSegments,
      });
    } catch (err: unknown) {
      console.error('[API group-and-translate Error]', err);
      const status = err instanceof ApiError ? err.statusCode : 500;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(status).json({ error: msg });
    }
  });

  /**
   * POST /api/gemini/analyze-video-window
   * Mode B: Auto-analyze 60-second window of a YouTube video
   */
  app.post('/api/gemini/analyze-video-window', async (req: Request, res: Response) => {
    try {
      const { videoId, startSeconds = 0, durationWindow = 60 } = req.body;
      if (!videoId || typeof videoId !== 'string') {
        res.status(400).json({ error: 'Missing videoId.' });
        return;
      }

      const endSeconds = startSeconds + durationWindow;
      const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

      // Verify video exists and is accessible before transcribing (prevents hallucinating on dead links)
      if (startSeconds === 0) {
        try {
          const oeRes = await withTimeout(
            fetch(
              `https://www.youtube.com/oembed?url=${encodeURIComponent(youtubeUrl)}&format=json`
            ),
            5000,
            'youtube-oembed'
          );
          if (oeRes.status === 404 || oeRes.status === 401 || oeRes.status === 403) {
            res.status(400).json({
              error:
                'Videyo YouTube sa a pa disponib, li prive, oswa li pa pèmèt li jwe isit la. Tanpri verifye lyen an.',
            });
            return;
          }
        } catch {
          // Proceed even if oEmbed check timed out
        }
      }

      const prompt = `Listen strictly word-for-word to the spoken audio in this ${durationWindow}-second video clip (from ${startSeconds}s to ${endSeconds}s).
Transcribe ONLY the exact English words actually spoken in the audio of that clip.
NEVER guess, paraphrase, or invent dialogue. NEVER use the title or prior knowledge. If there is only music, intro chimes, or silence, do NOT emit a segment for it.

Return every complete English sentence or thought actually spoken with exact start and end times in seconds strictly RELATIVE to the beginning of this clip (0.0 to ${durationWindow}.0).
Translate each segment accurately into natural everyday Haitian Creole (Kreyòl Ayisyen).
Include 1-3 useful vocabulary words per segment.`;

      const result = await callGeminiWithRetry(
        async (ai, modelName) => {
          const response = await ai.models.generateContent({
            model: modelName,
            contents: [
              {
                fileData: {
                  fileUri: youtubeUrl,
                  mimeType: 'video/mp4',
                },
                videoMetadata: {
                  startOffset: `${Math.floor(startSeconds)}s`,
                  endOffset: `${Math.floor(endSeconds)}s`,
                },
              } as any,
              {
                text: prompt,
              },
            ],
            config: {
              systemInstruction: `You are an expert speech transcriber and Haitian Creole educator.
Segment rules:
1. Transcribe ONLY exact words actually heard in the video's audio track between ${startSeconds}s and ${endSeconds}s.
2. Each segment starts at the beginning of a spoken sentence and ends at the end of that sentence or thought.
3. Timestamps start/end MUST be strictly relative to this clip (0.0 to ${durationWindow}.0 seconds) with 1 decimal place.
4. Drop segments cut off at the clip boundary.
5. "en": verbatim English spoken words from the audio.
6. "kr": faithful, natural Haitian Creole translation of "en".
7. "vocab": up to 3 useful words from "en" with Creole meaning.`,
              responseMimeType: 'application/json',
              thinkingConfig: {
                thinkingLevel: getThinkingLevelForModel(modelName),
              },
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  segments: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        start: {
                          type: Type.NUMBER,
                          description: `Start time relative to this clip (0.0 - ${durationWindow}.0)`,
                        },
                        end: {
                          type: Type.NUMBER,
                          description: `End time relative to this clip (0.0 - ${durationWindow}.0)`,
                        },
                        en: {
                          type: Type.STRING,
                          description: 'Exact English spoken sentence',
                        },
                        kr: {
                          type: Type.STRING,
                          description: 'Natural Haitian Creole translation',
                        },
                        vocab: {
                          type: Type.ARRAY,
                          items: {
                            type: Type.OBJECT,
                            properties: {
                              w: { type: Type.STRING },
                              kr: { type: Type.STRING },
                            },
                            required: ['w', 'kr'],
                          },
                        },
                      },
                      required: ['start', 'end', 'en', 'kr', 'vocab'],
                    },
                  },
                },
                required: ['segments'],
              },
            },
          });
          return response.text;
        },
        (rawText) => {
          const parsed = JSON.parse(rawText);
          return parsed.segments || [];
        },
        [PRIMARY_MODEL, FAST_MODEL],
        45000
      );

      res.setHeader('X-Model-Used', result.modelUsed);
      res.setHeader('X-Gemini-Ms', String(result.elapsedMs));
      res.json({ segments: result.data });
    } catch (err: unknown) {
      console.error('[API analyze-video-window Error]', err);
      const status = err instanceof ApiError ? err.statusCode : 500;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(status).json({ error: msg });
    }
  });

  /**
   * POST /api/gemini/evaluate-audio
   * Evaluate user's spoken answer in Haitian Creole against reference English & Creole
   */
  app.post('/api/gemini/evaluate-audio', async (req: Request, res: Response) => {
    try {
      const { audioBase64, englishSentence, referenceCreole } = req.body;
      if (!audioBase64 || !englishSentence) {
        res.status(400).json({ error: 'Missing audioBase64 or englishSentence.' });
        return;
      }

      // Fast server-side silence guard for 16-bit PCM WAV
      const wavBuf = Buffer.from(audioBase64, 'base64');
      if (wavBuf.length > 44 && wavBuf.toString('ascii', 0, 4) === 'RIFF') {
        let peak = 0;
        for (let i = 44; i + 1 < wavBuf.length; i += 2) {
          const sample = Math.abs(wavBuf.readInt16LE(i));
          if (sample > peak) peak = sample;
        }
        if (peak < 130) {
          res.json({
            heard: '',
            verdict: 'unclear',
            feedback: 'Mwen pa t twò tande vwa w la — eseye pale yon ti jan pi pre mikwo a!',
            better: referenceCreole || '',
            timestamp: Date.now(),
          });
          return;
        }
      }

      // Single Gemini call with raw verbatim ASR (including fillers like "hmmm") + natural human coaching
      const prompt = `Listen to the entire attached audio (16 kHz mono WAV).
The user is a native Haitian Creole speaker practicing ENGLISH listening. They heard this English sentence and translated it out loud:
English: "${englishSentence}"

Rules:
1. IGNORE all background music, singing/song lyrics, TV, radio, or distant background media voices. Only consider direct foreground speech into the microphone.
2. "hasSpeech": true ONLY if direct foreground human speech/vocalizations from the user into the microphone are heard; false for silence, noise, or ONLY background music/singing/song lyrics. Never transcribe song lyrics or invent words.
3. "heard": RAW word-for-word transcription of EVERY spoken foreground word from start to end — keep all tiny particles (m, w, li, yo, a, an, la, nan, pou), fillers ("hmmm", "eeeuuuh", "um"), repetitions, and self-corrections literally. Never omit or clean them up.
4. "verdict": Judge meaning ONLY ("correct", "partial", "wrong", "unclear"). Never penalize "hmmm", pauses, or restarts.
5. "feedback": 1-2 short sentences in warm, natural everyday Haitian Creole like a supportive friend (NOT robotic). Focus ONLY on how well they understood the English sentence (never praise their Creole).
6. "better": Natural Haitian Creole translation.`;

      const result = await callGeminiWithRetry(
        async (ai, modelName) => {
          const response = await ai.models.generateContent({
            model: modelName,
            contents: {
              parts: [
                {
                  inlineData: {
                    mimeType: 'audio/wav',
                    data: audioBase64,
                  },
                },
                {
                  text: prompt,
                },
              ],
            },
            config: {
              systemInstruction:
                'Friendly Haitian English coach (natural, never robotic). Transcribe every tiny word and filler ("hmmm", "eeeuuuh") verbatim into "heard", then give warm Creole feedback strictly on English comprehension.',
              responseMimeType: 'application/json',
              thinkingConfig: {
                thinkingLevel: getThinkingLevelForModel(modelName),
              },
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  hasSpeech: {
                    type: Type.BOOLEAN,
                    description: 'True if any human voice, words, or vocal hesitations like hmmm are audible; false only for pure silence, tone, or noise',
                  },
                  heard: {
                    type: Type.STRING,
                    description: 'Raw unedited verbatim transcription including every small word, particle, repetition, and hesitation like hmmm or eeeuh, or "" if hasSpeech is false',
                  },
                  verdict: {
                    type: Type.STRING,
                    enum: ['correct', 'partial', 'wrong', 'unclear'],
                  },
                  feedback: {
                    type: Type.STRING,
                  },
                  better: {
                    type: Type.STRING,
                  },
                },
                required: ['hasSpeech', 'heard', 'verdict', 'feedback', 'better'],
              },
            },
          });
          return response.text;
        },
        (rawText) => {
          const parsed = JSON.parse(rawText);
          if (!parsed.hasSpeech || !parsed.heard || !String(parsed.heard).trim()) {
            return {
              heard: '',
              verdict: 'unclear' as const,
              feedback:
                parsed.feedback ||
                'Mwen pa t twò tande vwa w la — eseye pale yon ti jan pi pre mikwo a!',
              better: parsed.better || referenceCreole || '',
              timestamp: Date.now(),
            };
          }

          const verdict =
            parsed.verdict === 'correct' ||
            parsed.verdict === 'partial' ||
            parsed.verdict === 'wrong' ||
            parsed.verdict === 'unclear'
              ? parsed.verdict
              : 'unclear';

          return {
            heard: String(parsed.heard).trim(),
            verdict,
            feedback: parsed.feedback || 'Wè, ou fè l byen! Kontinye konsa.',
            better: parsed.better || referenceCreole || '',
            timestamp: Date.now(),
          };
        },
        [PRIMARY_MODEL, FAST_MODEL],
        15000
      );

      res.setHeader('X-Model-Used', result.modelUsed);
      res.setHeader('X-Gemini-Ms', String(result.elapsedMs));
      res.json(result.data);
    } catch (err: unknown) {
      console.error('[API evaluate-audio Error]', err);
      const status = err instanceof ApiError ? err.statusCode : 500;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(status).json({ error: msg });
    }
  });

  /**
   * POST /api/gemini/evaluate-typed
   * Fallback evaluation when user types Creole answer
   */
  app.post('/api/gemini/evaluate-typed', async (req: Request, res: Response) => {
    try {
      const { typedCreole, englishSentence, referenceCreole } = req.body;
      if (!typedCreole || !englishSentence) {
        res.status(400).json({ error: 'Missing typedCreole or englishSentence.' });
        return;
      }

      const prompt = `Context: The user is a native Haitian Creole speaker practicing ENGLISH listening comprehension. They translated this English sentence into Haitian Creole:
English sentence: "${englishSentence}"
Reference Creole translation: "${referenceCreole}"
User's Creole translation: "${typedCreole}"

Evaluate their English comprehension & translation on MEANING only:
1. "heard": exact text typed ("${typedCreole}").
2. "verdict": "correct", "partial", "wrong", or "unclear".
3. "feedback": 1-2 short, natural sentences in warm, everyday spoken Haitian Creole — talk like a real friendly coach, NOT a robot or textbook! Focus ONLY on whether they understood the English sentence (never compliment their Creole). Explain any English word or phrase they got right or missed.
4. "better": Natural everyday Haitian Creole translation.`;

      const result = await callGeminiWithRetry(
        async (ai, modelName) => {
          const response = await ai.models.generateContent({
            model: modelName,
            contents: prompt,
            config: {
              systemInstruction:
                'You are a friendly, natural-sounding Haitian English coach — warm and conversational, never stiff or robotic. Respond in JSON. Write feedback in everyday Haitian Creole focused strictly on English comprehension and translation accuracy — never compliment their Creole.',
              responseMimeType: 'application/json',
              thinkingConfig: {
                thinkingLevel: getThinkingLevelForModel(modelName),
              },
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  heard: { type: Type.STRING },
                  verdict: {
                    type: Type.STRING,
                    enum: ['correct', 'partial', 'wrong', 'unclear'],
                  },
                  feedback: { type: Type.STRING },
                  better: { type: Type.STRING },
                },
                required: ['heard', 'verdict', 'feedback', 'better'],
              },
            },
          });
          return response.text;
        },
        (rawText) => {
          const parsed = JSON.parse(rawText);
          const verdict =
            parsed.verdict === 'correct' ||
            parsed.verdict === 'partial' ||
            parsed.verdict === 'wrong' ||
            parsed.verdict === 'unclear'
              ? parsed.verdict
              : 'unclear';

          return {
            heard: parsed.heard || typedCreole,
            verdict,
            feedback: parsed.feedback || 'Bon efò! Kontinye pratike.',
            better: parsed.better || referenceCreole,
            timestamp: Date.now(),
          };
        },
        [FAST_MODEL, PRIMARY_MODEL],
        20000
      );

      res.setHeader('X-Model-Used', result.modelUsed);
      res.setHeader('X-Gemini-Ms', String(result.elapsedMs));
      res.json(result.data);
    } catch (err: unknown) {
      console.error('[API evaluate-typed Error]', err);
      const status = err instanceof ApiError ? err.statusCode : 500;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(status).json({ error: msg });
    }
  });

  /**
   * Helper: Optional Groq fallback when Gemini fails and GROQ_API_KEY is configured
   */
  async function callGroqJson<T>(systemPrompt: string, userPrompt: string): Promise<T> {
    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) {
      throw new Error('GROQ_API_KEY is not configured');
    }
    const resp = await withTimeout(
      fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groqKey}`,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          temperature: 0.4,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
      }),
      30000,
      'groq-chat'
    );
    if (!resp.ok) {
      throw new Error(`Groq HTTP ${resp.status}`);
    }
    const data = (await resp.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Empty Groq response');
    }
    return JSON.parse(content) as T;
  }

  /**
   * POST /api/topic-speaking/generate
   * Generate 3 unique CEFR-calibrated speaking topics for ONE English word
   */
  app.post('/api/topic-speaking/generate', async (req: Request, res: Response) => {
    try {
      const { word, level = 'B1', previousTopics = [] } = req.body;
      const cleanedWord = typeof word === 'string' ? word.trim() : '';
      if (!cleanedWord || /\s+/.test(cleanedWord)) {
        res.status(400).json({ error: 'Veuillez saisir UN seul mot en anglais.' });
        return;
      }

      const validLevels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
      const cefrLevel = validLevels.includes(level) ? level : 'B1';
      const historyList: string[] = Array.isArray(previousTopics)
        ? previousTopics.slice(0, 30).map((s) => String(s))
        : [];

      const systemInstruction = `You are an expert American English speaking coach.
Generate EXACTLY 3 truly different speaking topics centered on the given English word, calibrated strictly to CEFR level ${cefrLevel}.
- Adapt vocabulary, question complexity, and abstractness to level ${cefrLevel}.
- Each topic must have a short, engaging English "title" and a clear English "question" the learner must answer out loud.
- All 3 topics must explore completely different angles/contexts (e.g., personal experience, opinion/debate, practical scenario).
- NEVER repeat or closely paraphrase any topic from the previously generated list.
Return valid JSON matching { "topics": [ { "title": "...", "question": "..." }, ... ] }.`;

      const prompt = `English word: "${cleanedWord}"
CEFR level: ${cefrLevel}
Previously generated topics to NEVER repeat:
${historyList.length > 0 ? historyList.map((t, i) => `${i + 1}. ${t}`).join('\n') : '(None)'}

Generate 3 brand-new, truly distinct speaking topics in JSON.`;

      try {
        const result = await callGeminiWithRetry(
          async (ai, modelName) => {
            const response = await ai.models.generateContent({
              model: modelName,
              contents: prompt,
              config: {
                systemInstruction,
                responseMimeType: 'application/json',
                thinkingConfig: getThinkingConfigForModel(modelName),
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    topics: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          title: { type: Type.STRING },
                          question: { type: Type.STRING },
                        },
                        required: ['title', 'question'],
                      },
                    },
                  },
                  required: ['topics'],
                },
              },
            });
            return response.text;
          },
          (rawText) => {
            const parsed = JSON.parse(rawText);
            if (!parsed || !Array.isArray(parsed.topics) || parsed.topics.length === 0) {
              throw new Error('Empty topics list returned by Gemini.');
            }
            return parsed.topics.slice(0, 3);
          },
          [FAST_MODEL, PRIMARY_MODEL],
          28000
        );

        res.json({ topics: result.data, provider: 'Gemini' });
        return;
      } catch (geminiErr) {
        if (process.env.GROQ_API_KEY) {
          console.warn('[Topic Speaking] Gemini failed, falling back to Groq:', geminiErr);
          const groqData = await callGroqJson<{ topics: { title: string; question: string }[] }>(
            systemInstruction,
            prompt
          );
          if (groqData && Array.isArray(groqData.topics) && groqData.topics.length > 0) {
            res.json({ topics: groqData.topics.slice(0, 3), provider: 'Groq' });
            return;
          }
        }
        throw geminiErr;
      }
    } catch (err: unknown) {
      console.error('[API topic-speaking/generate Error]', err);
      const status = err instanceof ApiError ? err.statusCode : 500;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(status).json({ error: msg });
    }
  });

  /**
   * POST /api/topic-speaking/evaluate
   * Strict American English coach: ignores natural human speech fillers/self-corrections,
   * evaluates every real error, and writes a chaptered spoken Audio Lesson script.
   */
  app.post('/api/topic-speaking/evaluate', async (req: Request, res: Response) => {
    try {
      const {
        word = '',
        level = 'B1',
        topicTitle = '',
        topicQuestion = '',
        audioBase64,
        audioMimeType = 'audio/webm',
        typedText,
      } = req.body;

      if (!audioBase64 && !typedText) {
        res.status(400).json({ error: 'Aucun audio ou texte fourni pour analyse.' });
        return;
      }

      let processedAudioBase64 = audioBase64;
      let detectedWavPeak = -1;

      // Fast server-side silence guard + automatic gain boost for quiet 16-bit PCM WAVs
      if (processedAudioBase64 && String(audioMimeType || '').includes('wav')) {
        const wavBuf = Buffer.from(processedAudioBase64, 'base64');
        if (wavBuf.length > 44 && wavBuf.toString('ascii', 0, 4) === 'RIFF') {
          let peak = 0;
          for (let i = 44; i + 1 < wavBuf.length; i += 2) {
            const sample = Math.abs(wavBuf.readInt16LE(i));
            if (sample > peak) peak = sample;
          }
          detectedWavPeak = peak;
          if (peak < 65) {
            console.warn(`[Topic Speaking Evaluate] Rejected silent WAV (peak=${peak})`);
            res.status(400).json({
              error:
                "Je n'ai détecté aucune voix dans ton enregistrement. Vérifie ton microphone, parle plus près et réessaie.",
            });
            return;
          }
          if (peak < 16000) {
            const gain = Math.min(10, 20000 / peak);
            const boosted = Buffer.from(wavBuf);
            for (let i = 44; i + 1 < boosted.length; i += 2) {
              const s = Math.round(boosted.readInt16LE(i) * gain);
              boosted.writeInt16LE(Math.max(-32768, Math.min(32767, s)), i);
            }
            processedAudioBase64 = boosted.toString('base64');
            console.log(
              `[Topic Speaking Evaluate] Boosted quiet WAV (peak=${peak}, gain=${gain.toFixed(1)}x)`
            );
          }
        }
      }

      const analysisStart = Date.now();
      const systemInstruction = `Tu es un vrai professeur d'anglais américain (General American) à la fois TRÈS SAGE, CALME, PATIENT, CHALEUREUX dans ta voix, et TRÈS STRICT ET EXIGEANT SUR CHAQUE FAUTE, parce que cette application sert à faire progresser réellement l'étudiant.
ATTITUDE & APPROCHE PÉDAGOGIQUE :
- Sois sage, posé, respectueux et humain dans ta façon de parler (tu prends vraiment le temps d'expliquer chaque erreur en profondeur : le « pourquoi » grammatical et le « comment » articulatoire sans jamais bâcler ni résumer trop vite).
- ZÉRO LONGUE FÉLICITATION, ZÉRO FLATTERIE ("c'est formidable", "bravo tu es super", "magnifique histoire") : une seule phrase courte et bienveillante (6 à 10 mots max), puis passe immédiatement aux corrections complètes.
- BASE-TOI STRICTEMENT ET UNIQUEMENT SUR LA VOIX PARLÉE DIRECTE DE L'ÉTUDIANT DANS L'AUDIO JOINT (ou le texte saisi).
- IGNORE TOTALEMENT toute musique de fond, paroles de chanson chantées, radio, vidéo ou TV en arrière-plan : ne transcris JAMAIS les paroles d'une musique et n'en fais JAMAIS un résumé ni une correction.
- NE RÉPONDS JAMAIS à une question de sujet, n'invente JAMAIS des phrases à partir d'un titre ou d'un thème.

RÈGLES D'ÉVALUATION STRICTES, CHRONOLOGIQUES ET APPROFONDIES (DU DÉBUT À LA FIN SANS SAUTER UNE SEULE ERREUR) :
- ORDRE CHRONOLOGIQUE STRICT : parcours la parole de l'étudiant DU TOUT DÉBUT DE L'AUDIO JUSQU'À LA TOUTE FIN, phrase après phrase, dans l'ordre exact où il a parlé. Ne regroupe jamais par type, ne saute jamais d'erreurs entre le début, le milieu et la fin.
- IGNORE uniquement les hésitations naturelles ("hmm", "uhh", "umm"), pauses silencieuses, auto-corrections et essais répétés d'un mot (évalue uniquement le DERNIER essai).
- TOLÉRANCE ZÉRO — IL N'Y A NI « PETITE ERREUR » NI « GROSSE ERREUR » : relève ABSOLUMENT TOUTES les erreurs entendues du début à la fin (aucune limite de nombre, même s'il y en a 10, 15 ou 25).
- Couvre tous ces axes au fil de son audio :
  1. Construction des Phrases, Clarté & Thème : vérifie si chaque phrase complète est bien structurée, logique sur le thème, et comment la reformuler naturellement.
  2. Temps Verbaux & Grammaire (Phrases complètes) : relève TOUTES les fautes de temps verbaux (passé, présent, futur, conditionnel), auxiliaires, prépositions, articles (a/the), pluriels, accords, en expliquant clairement la règle pour que l'étudiant la comprenne vraiment.
  3. Prononciation & Accent Américain 100 % (8 RÈGLES STRICTES) :
     1) Son 'TH' (/θ/ et /ð/) : langue entre les dents (think, three, the, this, that) plutôt que D, T, Z, S ou F.
     2) Son 'R' américain rétroflexe (/ɹ/) : langue reculée/enroulée sans toucher le palais (red, work, car, better).
     3) Flap T (/ɾ/) : T/TT entre voyelles transformé en petit D rapide (water -> wader, better -> bedder, city, get it).
     4) Silent T & Glottal Stop (/ʔ/) : T muet après N (internet -> innernet, twenty -> twenny) et T bloqué dans la gorge en fin de mot ou devant N (that, hot, button).
     5) Connected Speech, Réductions & Schwa (/ə/) : liaisons fluides entre les mots, réductions naturelles (wanna, gonna, kinda, gotta), et Schwa sur les petits mots (to, for, a, of, and).
     6) Intonation, Accent Tonique & Rythme : bon placement de l'accent tonique et mélodie montante/descendante naturelle sur toute la phrase.
     7) Voyelles tendues/relâchées & Diphtongues : ship/sheep, bit/beat, full/fool, /æ/ ouvert (cat, ask), vraies diphtongues (/eɪ/, /oʊ/, /aɪ/).
     8) Dark L (/ɫ/), Aspiration P/T/K, H expiré & Terminaisons -s/-ed : Dark L (feel, people), air sur P/T/K accentués, H soufflé, fins -s/-ed nettes.
  4. Comment Sonner Beaucoup Mieux : propose 2 à 3 façons plus naturelles, élevées et authentiquement américaines de formuler ses phrases entières sur ce thème.
- Réponds en JSON strict.`;

      // Notice: when evaluating audio, intentionally omit topicQuestion so Gemini NEVER confuses the question with the student's spoken words
      const basePrompt = typedText
        ? `Niveau : ${level} | Thème : "${topicTitle}" | Question : "${topicQuestion}"
Texte de l'étudiant : "${typedText}"`
        : `Niveau de l'étudiant : ${level} | Thème : "${topicTitle}"
ÉCOUTE ATTENTIVEMENT L'AUDIO JOINT du tout début jusqu'à la toute fin, phrase après phrase dans l'ordre chronologique.
1) Distingue la voix parlée DIRECTE (proche du micro) de tout fond sonore (musique, chanson chantée, paroles musicales, TV, radio). IGNORE complètement toute chanson ou musique de fond : ne transcris JAMAIS des paroles de chanson.
2) Mets "backgroundMediaOnly" à true et "audioHeard" à false si tu entends uniquement ou principalement de la musique, une chanson/chant ou un média de fond sans voix parlée directe de l'étudiant.
3) Mets "audioHeard" à true dès que tu entends une vraie voix parlée de l'étudiant au micro (même faible, hésitante ou avec un fort accent).
4) Transcris mot pour mot UNIQUEMENT ce que l'étudiant dit RÉELLEMENT au micro dans "cleanTranscription" (sans inventer ni inclure de musique de fond).
5) Relève ABSOLUMENT TOUTES les erreurs EN ORDRE CHRONOLOGIQUE DU DÉBUT À LA FIN sans en sauter aucune : phrases entières, temps verbaux, grammaire, naturel sur le thème "${topicTitle}", comment il sonnerait beaucoup mieux, ET les 8 règles d'accent américain.`;

      const schemaPromptSuffix = `

JSON strict attendu :
- "audioHeard": true uniquement si la voix parlée directe de l'étudiant est audible au micro; false pour silence, bruit, ou uniquement de la musique/chant de fond.
- "backgroundMediaOnly": true si l'audio contient uniquement ou surtout de la musique, des paroles de chanson ou une vidéo/TV en fond sans parole directe de l'étudiant; sinon false.
- "cleanTranscription": transcription fidèle de ce que l'étudiant a réellement dit (sans paroles de musique ni fillers), ou "" si audioHeard est false.
- "encouragementNote": 1 phrase très courte et factuelle (5 à 10 mots max, ZÉRO flatterie), ex: "On comprend bien ton idée, corrigeons chaque point ensemble."
- "unclearNote": "" si tout était clair dès la première écoute, sinon mentionne précisément ce qui était flou en français.
- "clarityFeedback": 1 phrase posée et directe en français sur la clarté, la tenue des temps verbaux, le thème et la fluidité générale (sans longs compliments).
- "correctedVersion": version INTÉGRALE, COMPLÈTE ET FIDÈLE (du premier mot jusqu'au dernier mot, sans rien résumer ni couper) en anglais américain naturel de TOUT CE QUE L'ÉTUDIANT VIENT DE DIRE, entièrement corrigé.
- "scores": { "pronunciation": 0-100, "grammar": 0-100, "vocabulary": 0-100, "fluency": 0-100, "overall": 0-100 }.
- "errors": tableau EXHAUSTIF et STRICTEMENT CHRONOLOGIQUE (du premier mot de l'audio jusqu'au dernier mot prononcé à la fin, SANS AUCUNE LIMITE DE NOMBRE) de TOUTES les erreurs entendues : { "said": "mot ou bout de phrase exact qu'il a dit", "correct": "version américaine correcte", "type": "pronunciation"|"grammar"|"vocabulary"|"fluency", "ipa": "IPA américain si prononciation sinon ''", "tip_fr": "EXPLICATION COMPLÈTE ET DÉTAILLÉE en 2 phrases claires en français : explique POURQUOI c'est une erreur et la règle exacte (temps verbal, structure de phrase, sens ou placement précis langue/dents/gorge/air en anglais américain)" }.
- "upgradedExpressions": 2 à 3 améliorations de PHRASES OU TOURNURES COMPLÈTES pour qu'il sonne beaucoup plus naturel et fluide sur ce thème : { "basic": "phrase ou tournure utilisée dans son audio", "upgraded": "meilleure façon américaine de le dire", "nuance_fr": "courte explication en français" }.
- "repeatDrills": tableau des phrases clés et mots importants corrigés (jusqu'à 10 éléments) à répéter calmement à la fin.
- "spokenLessonScript": script oral LONG, COMPLET ET APPROFONDI (JAMAIS raccourci ni bâclé) d'un vrai professeur humain sage, chaleureux, posé et exigeant, qui PREND SON TEMPS pour bien expliquer chaque faute du TOUT DÉBUT de l'audio jusqu'à la TOUTE FIN sans en sauter une seule. OBLIGATIONS ABSOLUES :
  1) Tutoiement ('tu/ton/ta'), 1 seule courte phrase d'ouverture (max 8-10 mots, zéro longue félicitation, zéro flatterie à la fin).
  2) ORDRE CHRONOLOGIQUE STRICT DE LA PREMIÈRE À LA DERNIÈRE ERREUR DE "errors" : ne regroupe pas par catégorie, suis le fil exact de ce que l'étudiant a dit du début jusqu'à la fin.
  3) STRUCTURE OBLIGATOIRE POUR CHAQUE ERREUR : tu DOIS dire explicitement "tu as dit" (ou "tu as prononcé") suivi de ce qu'il a dit entre guillemets, puis donner la correction américaine entre guillemets, puis prendre le temps d'EXPLIQUER CLAIREMENT POURQUOI ET COMMENT (2 phrases pédagogiques claires par erreur, jamais une petite phrase expédiée !). Exemple de ton naturel et détaillé : « Tout au début de ta réponse, tu as dit : "I go", alors qu'il faut dire : "I went". Comme tu racontes un souvenir d'hier qui est déjà terminé, tu dois utiliser le passé irrégulier du verbe aller au lieu du présent. Juste après, tu as dit : "drinked", mais en anglais ce verbe ne prend jamais E-D, on doit dire : "drank". »
  4) RÈGLE D'OR POUR UN ACCENT FRANÇAIS PUR ET UN ACCENT AMÉRICAIN PUR : commence chaque phrase par au moins 5 à 8 mots en français naturel et fluide, mets TOUJOURS chaque mot ou phrase anglaise entre guillemets "..." après ":" ou une virgule, jamais de "..." au milieu d'une phrase, jamais d'IPA/markdown/numéros.
  5) APRÈS TOUTES LES CORRECTIONS : propose brièvement les phrases améliorées sur le thème, PUIS lis OBLIGATOIREMENT ET INTÉGRALEMENT toute la réponse complète de l'étudiant entièrement corrigée du début à la fin ("correctedVersion" complète, sans rien couper ni résumer), puis fais répéter les "repeatDrills" séparés par "..." uniquement à la fin.`;

      const fullEvaluatePrompt = `${basePrompt}${schemaPromptSuffix}`;

      try {
        const result = await callGeminiWithRetry(
          async (ai, modelName) => {
            const contents = processedAudioBase64
              ? {
                  parts: [
                    {
                      inlineData: {
                        mimeType: String(audioMimeType || 'audio/webm').split(';')[0],
                        data: processedAudioBase64,
                      },
                    },
                    { text: fullEvaluatePrompt },
                  ],
                }
              : fullEvaluatePrompt;

            const requestConfig: Record<string, any> = {
              systemInstruction,
              responseMimeType: 'application/json',
              thinkingConfig: getThinkingConfigForModel(modelName),
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  audioHeard: { type: Type.BOOLEAN },
                  backgroundMediaOnly: { type: Type.BOOLEAN },
                  cleanTranscription: { type: Type.STRING },
                  encouragementNote: { type: Type.STRING },
                  unclearNote: { type: Type.STRING },
                  clarityFeedback: { type: Type.STRING },
                  correctedVersion: { type: Type.STRING },
                  scores: {
                    type: Type.OBJECT,
                    properties: {
                      pronunciation: { type: Type.NUMBER },
                      grammar: { type: Type.NUMBER },
                      vocabulary: { type: Type.NUMBER },
                      fluency: { type: Type.NUMBER },
                      overall: { type: Type.NUMBER },
                    },
                    required: ['pronunciation', 'grammar', 'vocabulary', 'fluency', 'overall'],
                  },
                  errors: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        said: { type: Type.STRING },
                        correct: { type: Type.STRING },
                        type: {
                          type: Type.STRING,
                          enum: ['pronunciation', 'grammar', 'vocabulary', 'fluency'],
                        },
                        ipa: { type: Type.STRING },
                        tip_fr: { type: Type.STRING },
                      },
                      required: ['said', 'correct', 'type', 'ipa', 'tip_fr'],
                    },
                  },
                  upgradedExpressions: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        basic: { type: Type.STRING },
                        upgraded: { type: Type.STRING },
                        nuance_fr: { type: Type.STRING },
                      },
                      required: ['basic', 'upgraded', 'nuance_fr'],
                    },
                  },
                  repeatDrills: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                  spokenLessonScript: { type: Type.STRING },
                },
                required: [
                  'audioHeard',
                  'backgroundMediaOnly',
                  'cleanTranscription',
                  'encouragementNote',
                  'unclearNote',
                  'clarityFeedback',
                  'correctedVersion',
                  'scores',
                  'errors',
                  'upgradedExpressions',
                  'repeatDrills',
                  'spokenLessonScript',
                ],
              },
            };

            if (modelName !== PRIMARY_MODEL) {
              requestConfig.temperature = 0.2;
            }

            const response = await ai.models.generateContent({
              model: modelName,
              contents,
              config: requestConfig,
            });
            return response.text;
          },
          (rawText) => JSON.parse(rawText),
          [FAST_MODEL, PRIMARY_MODEL],
          28000
        );

        if (
          processedAudioBase64 &&
          (result.data?.backgroundMediaOnly === true ||
            result.data?.audioHeard === false ||
            !String(result.data?.cleanTranscription || '').trim())
        ) {
          console.warn(
            `[Topic Speaking Evaluate] Rejected audio: mime=${audioMimeType} b64Len=${processedAudioBase64.length} wavPeak=${detectedWavPeak} audioHeard=${result.data?.audioHeard} backgroundMediaOnly=${result.data?.backgroundMediaOnly}`
          );
          res.status(400).json({
            error: result.data?.backgroundMediaOnly
              ? "J'ai surtout capté de la musique ou un son de fond, pas ta voix. Coupe ou baisse la musique, parle près du microphone et réessaie."
              : "Je n'ai pas réussi à entendre de paroles dans ton audio. Parle plus près du microphone et réessaie.",
          });
          return;
        }

        const analysisMs = Date.now() - analysisStart;
        const reportedErrors: LessonErrorInput[] = Array.isArray(result.data?.errors)
          ? result.data.errors
          : [];
        const transcriptPreview = String(result.data?.cleanTranscription || '').slice(0, 90);
        console.log(
          `[Topic Speaking Timing] evaluate model=${result.modelUsed} analysisMs=${analysisMs}ms issuesFound=${reportedErrors.length} transcript="${transcriptPreview}"`
        );

        // Guarantee 100% of reported errors are thoroughly explained in strict chronological order with "tu as dit ..."
        // AND the complete corrected speech of everything the student just said is spoken after all corrections
        let finalSpokenScript = sanitizeSpokenText(String(result.data?.spokenLessonScript || ''));
        if (reportedErrors.length > 0 || String(result.data?.correctedVersion || '').trim()) {
          finalSpokenScript = ensureAllErrorsInSpokenScript(finalSpokenScript, reportedErrors, {
            word,
            level,
            topicTitle,
            cleanTranscription: result.data?.cleanTranscription,
            encouragementNote: result.data?.encouragementNote,
            unclearNote: result.data?.unclearNote,
            clarityFeedback: result.data?.clarityFeedback,
            correctedVersion: result.data?.correctedVersion,
            errors: reportedErrors,
            upgradedExpressions: result.data?.upgradedExpressions,
            repeatDrills: result.data?.repeatDrills,
          });
        }
        result.data.spokenLessonScript = finalSpokenScript;

        // Pre-warm coach audio synthesis in parallel while evaluate JSON travels to browser
        if (finalSpokenScript.length > 20) {
          prefetchLessonAudio(TOPIC_SPEAKING_VOICE_CONFIG.defaultVoice, finalSpokenScript);
        }

        res.json({ ...result.data, provider: 'Gemini', serverTiming: { analysisMs } });
        return;
      } catch (geminiErr) {
        if (process.env.GROQ_API_KEY && typedText) {
          console.warn('[Topic Speaking Evaluate] Gemini failed, falling back to Groq:', geminiErr);
          const groqData = await callGroqJson<Record<string, unknown>>(
            systemInstruction,
            basePrompt
          );
          const analysisMs = Date.now() - analysisStart;
          res.json({ ...groqData, provider: 'Groq', serverTiming: { analysisMs } });
          return;
        }
        throw geminiErr;
      }
    } catch (err: unknown) {
      console.error('[API topic-speaking/evaluate Error]', err);
      const status = err instanceof ApiError ? err.statusCode : 500;
      const msg = err instanceof Error ? err.message : String(err);
      res.status(status).json({ error: msg });
    }
  });

  /**
   * Extract HTTP status code and short readable reason from Gemini SDK errors.
   */
  const extractLiveErrorInfo = (err: any): { status: number; shortMsg: string; rawMsg: string } => {
    const rawMsg = String(err?.message || err || 'Unknown error');
    const lower = rawMsg.toLowerCase();
    let status = Number(err?.status || err?.statusCode || 0);
    if (!status) {
      if (rawMsg.includes('429') || rawMsg.includes('RESOURCE_EXHAUSTED')) status = 429;
      else if (rawMsg.includes('404') || lower.includes('not found')) status = 404;
      else if (
        rawMsg.includes('400') ||
        rawMsg.includes('1007') ||
        rawMsg.includes('INVALID_ARGUMENT') ||
        lower.includes('invalid argument')
      ) {
        status = 400;
      } else if (rawMsg.includes('403') || rawMsg.includes('PERMISSION_DENIED')) status = 403;
      else status = 500;
    }

    let shortMsg = rawMsg;
    try {
      const jsonStart = rawMsg.indexOf('{');
      if (jsonStart >= 0) {
        const parsed = JSON.parse(rawMsg.slice(jsonStart));
        if (parsed?.error?.status || parsed?.error?.message) {
          const firstLine = String(parsed.error.message || '').split('\n')[0].trim();
          shortMsg = parsed.error.status
            ? `${parsed.error.status}: ${firstLine}`
            : firstLine;
        }
      }
    } catch {
      shortMsg = rawMsg.split('\n')[0].trim();
    }
    if (shortMsg.length > 180) {
      shortMsg = `${shortMsg.slice(0, 177)}...`;
    }
    return { status, shortMsg, rawMsg };
  };

  const GEMINI_VOICES = TOPIC_SPEAKING_VOICE_CONFIG.voices;
  const CORE_LIVE_VOICES = new Set(['Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede', 'Leda', 'Orus']);

  const ensureWavFromPcmBuffer = (pcmBuf: Buffer, sampleRate = 24000): string => {
    if (pcmBuf.length > 44 && pcmBuf.subarray(0, 4).toString('ascii') === 'RIFF') {
      return pcmBuf.toString('base64');
    }
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const dataSize = pcmBuf.length;
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);
    return Buffer.concat([header, pcmBuf]).toString('base64');
  };

  interface LessonErrorInput {
    said?: string;
    correct?: string;
    type?: string;
    ipa?: string;
    tip_fr?: string;
  }

  interface UpgradedExpressionInput {
    basic?: string;
    upgraded?: string;
    nuance_fr?: string;
  }

  interface LessonAudioPayload {
    scriptText?: string;
    voiceName?: string;
    word?: string;
    level?: string;
    topicTitle?: string;
    cleanTranscription?: string;
    encouragementNote?: string;
    unclearNote?: string;
    clarityFeedback?: string;
    correctedVersion?: string;
    errors?: LessonErrorInput[];
    upgradedExpressions?: UpgradedExpressionInput[];
    repeatDrills?: string[];
  }

  const sanitizeSpokenText = (raw: string): string =>
    raw
      .replace(/\/[^/\n]{1,40}\//g, '')
      .replace(/[*_`#>]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const formatThoroughErrorLine = (err: LessonErrorInput, index = 0, total = 1): string => {
    const said = sanitizeSpokenText(err.said || '');
    const correct = sanitizeSpokenText(err.correct || '');
    const tip = sanitizeSpokenText(err.tip_fr || '').replace(/\.$/, '');
    const errType = err.type || 'pronunciation';

    const positionLead =
      index === 0
        ? 'Tout au début de ta réponse,'
        : index === total - 1 && total > 2
          ? 'Vers la fin de ton audio,'
          : index % 3 === 1
            ? 'Juste après,'
            : index % 3 === 2
              ? 'Un peu plus loin,'
              : 'Ensuite dans ta phrase,';

    if (errType === 'pronunciation') {
      const core =
        said && correct
          ? `${positionLead} tu as prononcé : "${said}", et pour obtenir un accent vraiment américain, on prononce plutôt : "${correct}".`
          : correct
            ? `${positionLead} tu as dit : "${correct}", travaillons bien sa prononciation américaine : "${correct}".`
            : '';
      return tip ? `${core} ${tip}.`.trim() : core;
    }

    if (errType === 'grammar') {
      const core =
        said && correct
          ? `${positionLead} tu as dit : "${said}", alors qu'il faut vraiment dire : "${correct}".`
          : correct
            ? `${positionLead} attention à la grammaire, la forme juste en anglais est : "${correct}".`
            : '';
      return tip ? `${core} ${tip}.`.trim() : core;
    }

    const core =
      said && correct
        ? `${positionLead} tu as dit : "${said}", mais pour que ta phrase sonne plus naturelle sur ce thème, il vaut mieux dire : "${correct}".`
        : correct
          ? `${positionLead} une façon beaucoup plus naturelle de le dire en anglais américain est : "${correct}".`
          : '';
    return tip ? `${core} ${tip}.`.trim() : core;
  };

  const buildFallbackFrenchAmericanScript = (payload: LessonAudioPayload): string => {
    // Preserve exact chronological order from start of student's audio to the very end
    const allErrors = Array.isArray(payload.errors) ? payload.errors : [];

    const upgrades = Array.isArray(payload.upgradedExpressions)
      ? payload.upgradedExpressions.filter((u) => u && u.upgraded).slice(0, 3)
      : [];

    const drills = Array.isArray(payload.repeatDrills)
      ? payload.repeatDrills.map((d) => sanitizeSpokenText(d)).filter(Boolean).slice(0, 10)
      : allErrors.map((e) => sanitizeSpokenText(e.correct || '')).filter(Boolean).slice(0, 10);

    const parts: string[] = [];

    // 1. Brief grounded opening (no long congratulations) + clarity check
    const clarityText = sanitizeSpokenText(
      payload.clarityFeedback || payload.unclearNote || ''
    );
    if (clarityText) {
      parts.push(`On comprend bien ton idée, prenons maintenant chaque faute du début à la fin. ${clarityText}`);
    } else {
      parts.push('On comprend bien ton idée, reprenons maintenant chaque faute du début jusqu’à la fin de ton audio.');
    }

    // 2. ALL corrections in strict chronological order with "tu as dit ..." + thorough explanation
    if (allErrors.length > 0) {
      allErrors.forEach((err, idx) => {
        const line = formatThoroughErrorLine(err, idx, allErrors.length);
        if (line) parts.push(line);
      });
    }

    // 3. How to sound much better on this topic (upgraded sentences/phrases)
    if (upgrades.length > 0) {
      const upgradeLines = upgrades
        .map((u) => {
          const up = sanitizeSpokenText(u.upgraded || '');
          const basic = sanitizeSpokenText(u.basic || '');
          const rawNuance = sanitizeSpokenText(u.nuance_fr || '').replace(/\.$/, '');
          const nuance = rawNuance
            ? `${rawNuance.charAt(0).toLowerCase()}${rawNuance.slice(1)}`
            : '';
          if (basic && up) {
            return `au lieu de "${basic}", tu sonnerais beaucoup plus naturel en disant : "${up}"${nuance ? `, parce que ${nuance}` : ''}`;
          }
          return `tu peux aussi dire : "${up}"${nuance ? `, parce que ${nuance}` : ''}`;
        })
        .join(', et ');
      parts.push(`Pour que tes phrases sonnent encore plus fluides sur ce thème, ${upgradeLines}.`);
    }

    // 4. Full corrected version + patient repeat-out-loud drill (zero flattery outro)
    if (payload.correctedVersion?.trim()) {
      parts.push(
        `Maintenant, écoute tranquillement toute ta réponse corrigée du début à la fin dans un anglais américain fluide : "${sanitizeSpokenText(payload.correctedVersion)}".`
      );
    }

    if (drills.length > 0) {
      parts.push(
        `Pour terminer sans te presser, répète à voix haute juste après moi : ${drills.map((d) => `"${d}"...`).join(' ')}`
      );
    } else {
      parts.push(
        'Pour terminer sans te presser, répète toute la phrase corrigée à voix haute juste après moi.'
      );
    }

    return parts.join(' ');
  };

  const ensureFullCorrectedVersionInTail = (
    script: string,
    correctedVersion?: string
  ): string => {
    const cleanScript = sanitizeSpokenText(script);
    const fullCorrected = sanitizeSpokenText(correctedVersion || '');
    if (!fullCorrected) return cleanScript;

    const closingMatch = cleanScript.match(
      /\s+(?:Voici(?:\s+maintenant)?\s+(?:tout\s+ce\s+que\s+tu|ta|la)\s+(?:phrase|réponse|version|viens)|Écoute(?:\s+maintenant)?\s+(?:la\s+phrase|tout\s+ce\s+que)|Maintenant(?:\s+que\s+nous)?,?\s+(?:écoute|voici)|Je te propose maintenant de répéter|Pour\s+(?:finir|terminer),?\s+répète|À toi\s+de\s+répéter|Répète(?:\s+maintenant)?\s+(?:ces\s+segments\s+)?après\s+moi)/i
    );
    const splitIdx =
      closingMatch && typeof closingMatch.index === 'number' ? closingMatch.index : cleanScript.length;
    const beforeTail = cleanScript.slice(0, splitIdx).trim();
    const tailSection = cleanScript.slice(splitIdx).trim();

    const normCorrected = fullCorrected
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const normTail = ` ${tailSection.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()} `;
    const tokens = normCorrected.split(' ').filter((w) => w.length >= 3);
    const matchedCount = tokens.filter((t) => normTail.includes(` ${t} `)).length;
    const hasFullCorrected =
      normTail.includes(` ${normCorrected} `) ||
      (tokens.length > 0 && matchedCount >= Math.ceil(tokens.length * 0.85));

    if (hasFullCorrected) return cleanScript;

    const correctedBlock = `Maintenant que toutes les corrections sont terminées, écoute attentivement tout ce que tu viens de dire, entièrement corrigé du début à la fin : "${fullCorrected}".`;
    return tailSection
      ? `${beforeTail} ${correctedBlock} ${tailSection}`.trim()
      : `${beforeTail} ${correctedBlock}`.trim();
  };

  const ensureAllErrorsInSpokenScript = (
    script: string,
    errors: LessonErrorInput[],
    fallbackPayload?: LessonAudioPayload
  ): string => {
    const cleanScript = sanitizeSpokenText(script);
    if (errors.length === 0) {
      return ensureFullCorrectedVersionInTail(cleanScript, fallbackPayload?.correctedVersion);
    }
    if (!cleanScript || cleanScript.length < 80) {
      return fallbackPayload
        ? buildFallbackFrenchAmericanScript({ ...fallbackPayload, errors })
        : cleanScript;
    }

    // Inspect ONLY the teaching body (before the final full corrected version / repeat drills)
    // so an uncorrected item merely appearing inside correctedVersion doesn't hide a skipped explanation!
    const closingMatch = cleanScript.match(
      /\s+(?:Voici(?:\s+maintenant)?\s+(?:tout\s+ce\s+que\s+tu|ta|la)\s+(?:phrase|réponse|version|viens)|Écoute(?:\s+maintenant)?\s+(?:la\s+phrase|tout\s+ce\s+que)|Maintenant(?:\s+que\s+nous)?,?\s+(?:écoute|voici)|Je te propose maintenant de répéter|Pour\s+(?:finir|terminer),?\s+répète|À toi\s+de\s+répéter|Répète(?:\s+maintenant)?\s+(?:ces\s+segments\s+)?après\s+moi)/i
    );
    const splitIdx = closingMatch && typeof closingMatch.index === 'number' ? closingMatch.index : cleanScript.length;
    const teachingBody = cleanScript.slice(0, splitIdx).trim();
    const tailSection = cleanScript.slice(splitIdx).trim();

    const normalizedBody = ` ${teachingBody.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()} `;
    const hasTokenCoverage = (phrase: string): boolean => {
      const normalized = sanitizeSpokenText(String(phrase || ''))
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!normalized) return true;
      if (normalizedBody.includes(` ${normalized} `)) return true;
      const tokens = normalized.split(' ').filter((w) => w.length >= 2);
      if (tokens.length === 0) return true;
      const keyTokens = tokens.filter((w) => w.length >= 3);
      const checkTokens = keyTokens.length > 0 ? keyTokens : tokens;
      return checkTokens.every((t) => normalizedBody.includes(` ${t} `));
    };

    const missedErrors: { err: LessonErrorInput; index: number }[] = [];
    let saidQuotedCount = 0;
    let distinctSaidCount = 0;

    for (let i = 0; i < errors.length; i++) {
      const err = errors[i];
      const correctOk = hasTokenCoverage(err?.correct || '');
      const normSaid = sanitizeSpokenText(String(err?.said || '')).toLowerCase().trim();
      const normCorrect = sanitizeSpokenText(String(err?.correct || '')).toLowerCase().trim();
      const hasDistinctSaid = Boolean(normSaid && normSaid !== normCorrect);
      if (hasDistinctSaid) {
        distinctSaidCount++;
        if (hasTokenCoverage(normSaid)) {
          saidQuotedCount++;
        }
      }
      if (!correctOk) {
        missedErrors.push({ err, index: i });
      }
    }

    const usesTuAsDitPhrase = /\b(?:tu as dit|tu as prononcé|tu as utilisé|tu disais)\b/i.test(teachingBody);
    const avgCharsPerError = teachingBody.length / Math.max(1, errors.length);
    const missingManySaidQuotes = distinctSaidCount >= 2 && saidQuotedCount < Math.ceil(distinctSaidCount * 0.65);

    // If Gemini rushed the lesson (<115 chars/error), omitted "tu as dit ...", or dropped >=2 errors out of chronological order,
    // rebuild cleanly in strict chronological start-to-end order using every error's full tip_fr!
    if (
      fallbackPayload &&
      (missedErrors.length >= 2 ||
        !usesTuAsDitPhrase ||
        missingManySaidQuotes ||
        avgCharsPerError < 115)
    ) {
      return buildFallbackFrenchAmericanScript({ ...fallbackPayload, errors });
    }

    const withAllErrors =
      missedErrors.length === 0
        ? cleanScript
        : (() => {
            const patchBlock = missedErrors
              .map(({ err, index }) => formatThoroughErrorLine(err, index, errors.length))
              .filter(Boolean)
              .join(' ');
            return tailSection ? `${teachingBody} ${patchBlock} ${tailSection}`.trim() : `${teachingBody} ${patchBlock}`.trim();
          })();

    return ensureFullCorrectedVersionInTail(withAllErrors, fallbackPayload?.correctedVersion);
  };

  const generateConversationalLessonScript = async (
    payload: LessonAudioPayload
  ): Promise<string> => {
    // Keep exact chronological order from start to end of the student's audio
    const allErrors = Array.isArray(payload.errors) ? payload.errors : [];

    const upgrades = Array.isArray(payload.upgradedExpressions)
      ? payload.upgradedExpressions.slice(0, 3)
      : [];

    const drills = Array.isArray(payload.repeatDrills)
      ? payload.repeatDrills.filter(Boolean).slice(0, 10)
      : [];

    const fallbackScript = buildFallbackFrenchAmericanScript({
      ...payload,
      errors: allErrors,
      upgradedExpressions: upgrades,
      repeatDrills: drills,
    });

    if (allErrors.length === 0 && upgrades.length === 0 && !payload.correctedVersion) {
      return fallbackScript;
    }

    const errorsBlock =
      allErrors.length > 0
        ? allErrors
            .map((e, i) => {
              const kind = e.type || 'pronunciation';
              const said = e.said ? `"${e.said}"` : '(imprécis)';
              const correct = e.correct ? `"${e.correct}"` : '';
              const tip = e.tip_fr ? ` (${e.tip_fr})` : '';
              return `${i + 1}. [${kind}] ${said} -> ${correct}${tip}`;
            })
            .join('\n')
        : 'Aucune erreur détectée.';

    const upgradesBlock =
      upgrades.length > 0
        ? upgrades
            .map(
              (u, i) =>
                `${i + 1}. ${u.basic ? `"${u.basic}" -> ` : ''}"${u.upgraded || ''}"${u.nuance_fr ? ` (${u.nuance_fr})` : ''}`
            )
            .join('\n')
        : '(Propose 2 façons plus naturelles de reformuler ses phrases sur ce thème)';

    const drillsBlock =
      drills.length > 0
        ? drills.map((d) => `"${d}"`).join(' | ')
        : allErrors.map((e) => `"${e.correct}"`).filter(Boolean).join(' | ');

    const scriptSystemInstruction = `Tu es un vrai professeur d'anglais américain très sage, chaleureux, patient et posé, mais exigeant sur chaque faute pour que l'étudiant progresse vraiment.
Écris UNE leçon orale APPROFONDIE, complète et naturelle — ne raccourcis JAMAIS tes explications.

RÈGLES ABSOLUES :
- VOIX CHALEUREUSE, SAGE ET HUMAINE : tutoie l'élève ('tu/ton/ta'), une seule courte phrase d'ouverture (6-10 mots max, sans longues félicitations), puis prends vraiment ton temps pour bien expliquer.
- ORDRE CHRONOLOGIQUE STRICT DU DÉBUT À LA FIN : traite toutes les ${allErrors.length} erreurs exactement dans l'ordre numérique 1, 2, 3... jusqu'à ${allErrors.length} (du commencement de son audio jusqu'à la fin) sans en sauter une seule.
- OBLIGATION "TU AS DIT ..." + EXPLICATION COMPLÈTE : pour CHAQUE erreur, dis clairement "tu as dit" (ou "tu as prononcé") avec ses mots exacts entre guillemets, donne la correction entre guillemets, puis explique en 2 phrases claires POURQUOI et COMMENT (règle grammaticale/temps verbal ou placement exact bouche/langue/air en anglais américain).
- ACCENT FRANÇAIS PUR & ANGLAIS AMÉRICAIN PUR : commence chaque phrase par au moins 5 à 8 mots en français fluide, mets TOUJOURS les mots ou phrases anglaises entre guillemets "..." après ":" ou une virgule, et ne mets jamais "..." au milieu d'une phrase.
- AUCUN titre, AUCUN IPA (/.../), AUCUN markdown (*, #, -), AUCUN numéro, AUCUNE parenthèse, AUCUN emoji.

STRUCTURE EN 4 TEMPS :
1. Ouverture courte et chaleureuse (max 8-10 mots, sans longs compliments).
2. Parcours chronologique complet du début à la fin de TOUTES les ${allErrors.length} erreurs (avec "tu as dit..." + correction + explication approfondie).
3. Comment sonner encore mieux : 2 à 3 tournures ou phrases améliorées sur ce sujet.
4. IMMÉDIATEMENT APRÈS TOUTES LES CORRECTIONS : lis OBLIGATOIREMENT ET INTÉGRALEMENT toute la réponse complète que l'étudiant vient de dire entièrement corrigée du début à la fin (sans rien résumer ni couper), puis invite calmement à répéter les mots et phrases clés séparés par "..." (ZÉRO flatterie à la fin).`;

    const scriptPrompt = `Mot : "${payload.word || ''}" | Niveau : ${payload.level || 'B1'} | Sujet : "${payload.topicTitle || ''}"
Ce que l'étudiant a dit : "${payload.cleanTranscription || ''}"
Évaluation clarté : "${payload.clarityFeedback || payload.unclearNote || 'Message compréhensible dans l’ensemble.'}"

TOUTES LES ${allErrors.length} CORRECTIONS À TRAITER SANS EXCEPTION :
${errorsBlock}

EXPRESSIONS AMÉLIORÉES (2-3) :
${upgradesBlock}

VERSION CORRIGÉE COMPLÈTE (anglais américain) : "${payload.correctedVersion || ''}"

MOTS / PHRASES CLÉS À FAIRE RÉPÉTER À VOIX HAUTE À LA FIN :
${drillsBlock}

Rédige maintenant le script parlé complet du coach, prêt à être lu à voix haute d'une seule traite.`;

    try {
      const ai = getGeminiClient();
      const response = await withTimeout(
        ai.models.generateContent({
          model: FAST_MODEL,
          contents: scriptPrompt,
          config: {
            systemInstruction: scriptSystemInstruction,
            temperature: 0.6,
            thinkingConfig: {
              thinkingLevel: ThinkingLevel.MINIMAL,
            },
          },
        }),
        18000,
        'lesson-script'
      );
      const generated = sanitizeSpokenText(response.text || '');
      if (generated.length > 100) {
        return ensureAllErrorsInSpokenScript(generated, allErrors, {
          ...payload,
          errors: allErrors,
          upgradedExpressions: upgrades,
          repeatDrills: drills,
        });
      }
    } catch (err) {
      console.warn('[Topic Speaking Lesson Script] Using deterministic French script fallback:', err);
    }

    return fallbackScript;
  };

  const applyEdgeFadePcm = (pcm: Buffer, sampleRate: number, fadeMs = 12): Buffer => {
    const out = Buffer.from(pcm);
    const totalSamples = Math.floor(out.length / 2);
    const fadeSamples = Math.min(Math.floor((sampleRate * fadeMs) / 1000), Math.floor(totalSamples / 4));
    for (let i = 0; i < fadeSamples; i++) {
      const gain = i / Math.max(1, fadeSamples);
      const startOff = i * 2;
      const endOff = (totalSamples - 1 - i) * 2;
      out.writeInt16LE(Math.round(out.readInt16LE(startOff) * gain), startOff);
      out.writeInt16LE(Math.round(out.readInt16LE(endOff) * gain), endOff);
    }
    return out;
  };

  const synthesizeSingleGeminiLiveChunk = async (
    model: string,
    chosenVoice: string,
    chunkText: string,
    timeoutMs: number
  ): Promise<Buffer> => {
    const ai = getGeminiClient();

    const liveConfig: any = {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: chosenVoice },
        },
      },
      systemInstruction: TOPIC_SPEAKING_VOICE_CONFIG.styleInstruction,
    };

    const userPrompt = `Tu es en appel vocal 1-à-1 avec ton étudiant. Parle-lui avec une voix chaleureuse, posée, profondément humaine et expressive — de vraies respirations douces, une belle mélodie naturelle dans la voix et un rythme détendu, jamais mécanique ni monotone. Parle tout le français comme un vrai francophone et prononce chaque exemple anglais avec un pur accent américain, en suivant fidèlement du début à la fin toutes les corrections ci-dessous sans rien sauter ni inventer d'autre sujet :\n\n${chunkText}`;

    return new Promise((resolve, reject) => {
      let settled = false;
      let setupSucceeded = false;
      let activeSession: any = null;
      const pcmChunks: Buffer[] = [];
      let totalBytes = 0;

      const finishReject = (err: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        try {
          activeSession?.close?.();
        } catch {
          // ignore
        }
        const baseErr = err instanceof Error ? err : new Error(String(err));
        (baseErr as any).setupSucceeded = setupSucceeded;
        reject(baseErr);
      };

      const finishSuccess = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        try {
          activeSession?.close?.();
        } catch {
          // ignore
        }
        if (totalBytes < 400) {
          const emptyErr = new Error(`No audio returned by ${model}`);
          (emptyErr as any).setupSucceeded = setupSucceeded;
          reject(emptyErr);
          return;
        }
        resolve(Buffer.concat(pcmChunks));
      };

      const timeoutId = setTimeout(() => {
        if (totalBytes > 4000) {
          finishSuccess();
        } else {
          finishReject(new Error(`Timeout after ${timeoutMs}ms (${model})`));
        }
      }, timeoutMs);

      ai.live
        .connect({
          model,
          config: liveConfig,
          callbacks: {
            onopen: () => {
              // Socket opened; waiting for setupComplete
            },
            onmessage: (msg: LiveServerMessage) => {
              if (settled) return;
              const parts = msg.serverContent?.modelTurn?.parts;
              if (Array.isArray(parts)) {
                for (const part of parts) {
                  const b64 = part?.inlineData?.data;
                  if (typeof b64 === 'string' && b64.length > 0) {
                    const buf = Buffer.from(b64, 'base64');
                    pcmChunks.push(buf);
                    totalBytes += buf.length;
                  }
                }
              }
              if (msg.serverContent?.turnComplete) {
                finishSuccess();
              }
            },
            onerror: (err: any) => {
              const rawErr = err?.error || err?.message || err || new Error(`Live API error on ${model}`);
              finishReject(rawErr);
            },
            onclose: (ev: any) => {
              if (settled) return;
              if (totalBytes > 4000) {
                finishSuccess();
              } else {
                const reason = ev?.reason || `Connection closed (${ev?.code || 'unknown'})`;
                finishReject(new Error(reason));
              }
            },
          },
        })
        .then((session: any) => {
          setupSucceeded = true;
          activeSession = session;
          if (settled) {
            try {
              session.close?.();
            } catch {
              // ignore
            }
            return;
          }
          session.sendClientContent({
            turns: [{ role: 'user', parts: [{ text: userPrompt }] }],
            turnComplete: true,
          });
        })
        .catch((err: unknown) => {
          finishReject(err);
        });
    });
  };

  const synthesizeLessonWithGeminiLive = async (
    model: string,
    chosenVoice: string,
    lessonScript: string
  ): Promise<{ audioBase64: string; modelUsed: string; voiceName: string }> => {
    const trimmed = lessonScript.trim();
    const chunks = splitBalancedTtsChunks(trimmed, 950);

    if (chunks.length === 1) {
      const timeoutMs = Math.max(38000, Math.min(50000, trimmed.length * 42));
      const pcm = await synthesizeSingleGeminiLiveChunk(model, chosenVoice, trimmed, timeoutMs);
      return {
        audioBase64: ensureWavFromPcmBuffer(pcm, 24000),
        modelUsed: model,
        voiceName: chosenVoice,
      };
    }

    // For longer thorough start-to-end lessons, run balanced chronological Live chunks concurrently so nothing times out
    const pcmClips = await Promise.all(
      chunks.map((chunk, idx) =>
        delay(idx * 120).then(() => {
          const timeoutMs = Math.max(38000, Math.min(48000, chunk.length * 48));
          return synthesizeSingleGeminiLiveChunk(model, chosenVoice, chunk, timeoutMs);
        })
      )
    );

    const pcmParts: Buffer[] = [];
    pcmClips.forEach((pcm, idx) => {
      if (idx > 0) {
        pcmParts.push(Buffer.alloc(Math.round(24000 * 0.18) * 2));
      }
      pcmParts.push(applyEdgeFadePcm(pcm, 24000, 12));
    });

    return {
      audioBase64: ensureWavFromPcmBuffer(Buffer.concat(pcmParts), 24000),
      modelUsed: model,
      voiceName: chosenVoice,
    };
  };

  const splitBalancedTtsChunks = (script: string, maxSingleLen = 1500): string[] => {
    const clean = script.trim();
    // Keep normal lessons in ONE cohesive take; split longer thorough lessons cleanly into balanced chronological parts
    if (clean.length <= maxSingleLen) return [clean];

    const targetPerChunk = Math.max(700, Math.round(maxSingleLen * 0.85));
    const chunkCount = Math.min(4, Math.max(2, Math.ceil(clean.length / targetPerChunk)));

    const sentences = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
    if (sentences.length <= 1) {
      const words = clean.split(/\s+/);
      const mid = Math.ceil(words.length / 2);
      return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')].filter(Boolean);
    }

    const chunks: string[] = [];
    let current = '';
    let remainingChars = clean.length;

    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      const chunksLeft = chunkCount - chunks.length;
      const targetLen = chunksLeft > 1 ? Math.ceil(remainingChars / chunksLeft) : Infinity;

      if (current && chunks.length < chunkCount - 1 && current.length >= targetLen * 0.72) {
        chunks.push(current.trim());
        remainingChars -= current.length + 1;
        current = sentence;
      } else {
        current = current ? `${current} ${sentence}` : sentence;
      }
    }
    if (current.trim()) {
      chunks.push(current.trim());
    }
    return chunks.length > 0 ? chunks : [clean];
  };

  const extractPcmFromWavBuffer = (wavBuf: Buffer): { pcm: Buffer; sampleRate: number } => {
    if (wavBuf.length > 44 && wavBuf.subarray(0, 4).toString('ascii') === 'RIFF') {
      const sampleRate = wavBuf.readUInt32LE(24) || 24000;
      let offset = 12;
      while (offset + 8 <= wavBuf.length) {
        const chunkId = wavBuf.subarray(offset, offset + 4).toString('ascii');
        const chunkSize = wavBuf.readUInt32LE(offset + 4);
        if (chunkId === 'data') {
          const start = offset + 8;
          const end = Math.min(wavBuf.length, start + chunkSize);
          return { pcm: wavBuf.subarray(start, end), sampleRate };
        }
        offset += 8 + chunkSize + (chunkSize % 2);
      }
      return { pcm: wavBuf.subarray(44), sampleRate };
    }
    return { pcm: wavBuf, sampleRate: 24000 };
  };

  const synthesizeTtsChunk = async (
    model: string,
    chosenVoice: string,
    chunkText: string,
    timeoutMs: number
  ): Promise<string> => {
    const ai = getGeminiClient();
    const response = await withTimeout(
      ai.models.generateContent({
        model,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: chunkText,
                speechMetadata: {
                  style:
                    'Warm, expressive, natural conversational French teacher speaking 1-on-1 with genuine human inflection, relaxed breathing, and lively pitch variation — authentic Parisian French on French explanations, effortless natural General American English on English quotes.',
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: chosenVoice },
            },
          },
        },
      }),
      timeoutMs,
      model
    );

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) {
      throw new Error(`No audio data returned by ${model}`);
    }
    return base64Audio;
  };

  const synthesizeLessonWithGeminiTts = async (
    model: string,
    chosenVoice: string,
    lessonScript: string
  ): Promise<{ audioBase64: string; modelUsed: string; voiceName: string }> => {
    const trimmed = lessonScript.trim();
    const chunks = splitBalancedTtsChunks(trimmed);

    if (chunks.length === 1) {
      const timeoutMs = Math.max(20000, Math.min(42000, trimmed.length * 35));
      const base64Audio = await synthesizeTtsChunk(model, chosenVoice, trimmed, timeoutMs);
      const wavBase64 = base64Audio.startsWith('UklGR')
        ? base64Audio
        : ensureWavFromPcmBuffer(Buffer.from(base64Audio, 'base64'), 24000);
      return {
        audioBase64: wavBase64,
        modelUsed: model,
        voiceName: chosenVoice,
      };
    }

    const clipBase64List = await Promise.all(
      chunks.map((chunk) => {
        const timeoutMs = Math.max(20000, Math.min(40000, chunk.length * 40));
        return synthesizeTtsChunk(model, chosenVoice, chunk, timeoutMs);
      })
    );

    let outSampleRate = 24000;
    const pcmParts: Buffer[] = [];
    clipBase64List.forEach((b64, idx) => {
      const { pcm, sampleRate } = extractPcmFromWavBuffer(Buffer.from(b64, 'base64'));
      if (idx === 0 && sampleRate > 0) outSampleRate = sampleRate;
      if (idx > 0) {
        pcmParts.push(Buffer.alloc(Math.round(outSampleRate * 0.18) * 2));
      }
      pcmParts.push(applyEdgeFadePcm(pcm, outSampleRate, 12));
    });

    const wavBase64 = ensureWavFromPcmBuffer(Buffer.concat(pcmParts), outSampleRate);
    return {
      audioBase64: wavBase64,
      modelUsed: model,
      voiceName: chosenVoice,
    };
  };

  interface AudioSynthResult {
    audioBase64: string;
    modelUsed: string;
    voiceName: string;
    attempts?: string[];
  }

  // Cooldown map skips quota-exhausted models in 0ms instead of burning 1-2s per request waiting on 429
  const audioModelCooldownUntil = new Map<string, number>();
  const markAudioModel429Cooldown = (model: string, rawMsg: string) => {
    const isDailyQuota =
      rawMsg.includes('PerDay') || msgIncludesFreeTierQuota(rawMsg);
    const cooldownMs = isDailyQuota ? 10 * 60 * 1000 : 25 * 1000;
    audioModelCooldownUntil.set(model, Date.now() + cooldownMs);
  };
  const msgIncludesFreeTierQuota = (rawMsg: string): boolean =>
    rawMsg.includes('RequestsPerDay') || rawMsg.includes('FreeTier');
  const isAudioModelInCooldown = (model: string): boolean => {
    const until = audioModelCooldownUntil.get(model);
    if (!until) return false;
    if (Date.now() >= until) {
      audioModelCooldownUntil.delete(model);
      return false;
    }
    return true;
  };

  // Short-lived in-flight / completed TTS cache so `evaluate` pre-warms `lesson-audio` without duplicate API calls
  const LESSON_AUDIO_PREFETCH_TTL_MS = 120000;
  const lessonAudioPrefetchMap = new Map<
    string,
    { promise: Promise<AudioSynthResult>; createdAt: number }
  >();

  const makeLessonSynthKey = (voice: string, script: string): string => `${voice}::${script}`;

  const pruneLessonAudioPrefetchMap = () => {
    const now = Date.now();
    for (const [k, entry] of lessonAudioPrefetchMap.entries()) {
      if (now - entry.createdAt > LESSON_AUDIO_PREFETCH_TTL_MS) {
        lessonAudioPrefetchMap.delete(k);
      }
    }
    while (lessonAudioPrefetchMap.size > 20) {
      const oldestKey = lessonAudioPrefetchMap.keys().next().value;
      if (!oldestKey) break;
      lessonAudioPrefetchMap.delete(oldestKey);
    }
  };

  const runLessonAudioSynthesis = async (
    requestedVoice: string,
    finalScript: string
  ): Promise<AudioSynthResult> => {
    const synthStart = Date.now();
    const AUDIO_SYNTH_MAX_BUDGET_MS = 55000;
    const liveVoiceCandidates = Array.from(
      new Set(
        CORE_LIVE_VOICES.has(requestedVoice)
          ? [requestedVoice, 'Aoede']
          : ['Aoede']
      )
    );

    let lastErr: any = null;
    let lastErrInfo = { status: 500, shortMsg: 'Erreur génération audio Gemini', rawMsg: '' };
    let saw429 = false;
    const attempts: string[] = [];

    const activeTtsModels = TOPIC_SPEAKING_AUDIO_MODELS.tts.filter((m) => !isAudioModelInCooldown(m));
    const activeLiveModels = TOPIC_SPEAKING_AUDIO_MODELS.live.filter((m) => !isAudioModelInCooldown(m));
    const ttsQueue =
      activeTtsModels.length > 0
        ? activeTtsModels
        : activeLiveModels.length > 0
          ? []
          : [...TOPIC_SPEAKING_AUDIO_MODELS.tts].sort(
              (a, b) => (audioModelCooldownUntil.get(a) || 0) - (audioModelCooldownUntil.get(b) || 0)
            );

    // 1. Primary (Expressive Flagship TTS first): Gemini TTS models — skip models currently in 429 cooldown
    for (const ttsModel of ttsQueue) {
      if (Date.now() - synthStart > AUDIO_SYNTH_MAX_BUDGET_MS) break;
      try {
        const res = await synthesizeLessonWithGeminiTts(ttsModel, requestedVoice, finalScript);
        attempts.push(`${ttsModel}:ok`);
        return { ...res, attempts };
      } catch (err: any) {
        lastErr = err;
        lastErrInfo = extractLiveErrorInfo(err);
        attempts.push(`${ttsModel}:${lastErrInfo.status}`);
        console.log(
          `[Lesson Audio] TTS model ${ttsModel} failed (${lastErrInfo.status}): ${lastErrInfo.shortMsg}`
        );
        if (lastErrInfo.status === 403) {
          throw Object.assign(new Error('Clé API Gemini invalide ou non autorisée.'), {
            httpStatus: 403,
            detail: `${lastErrInfo.status} ${lastErrInfo.shortMsg}`,
          });
        }
        if (lastErrInfo.status === 429) {
          saw429 = true;
          markAudioModel429Cooldown(ttsModel, lastErrInfo.rawMsg);
        }
      }
    }

    // 2. Fallback: Gemini Live native audio (separate model quota from TTS)
    const liveQueue =
      activeLiveModels.length > 0
        ? activeLiveModels
        : [...TOPIC_SPEAKING_AUDIO_MODELS.live].sort(
            (a, b) => (audioModelCooldownUntil.get(a) || 0) - (audioModelCooldownUntil.get(b) || 0)
          );

    for (const liveModel of liveQueue) {
      if (Date.now() - synthStart > AUDIO_SYNTH_MAX_BUDGET_MS) break;
      for (const voiceCandidate of liveVoiceCandidates) {
        if (Date.now() - synthStart > AUDIO_SYNTH_MAX_BUDGET_MS) break;
        try {
          const res = await synthesizeLessonWithGeminiLive(liveModel, voiceCandidate, finalScript);
          attempts.push(`${liveModel}:ok`);
          return { ...res, attempts };
        } catch (err: any) {
          lastErr = err;
          lastErrInfo = extractLiveErrorInfo(err);
          const setupSucceeded = Boolean(err?.setupSucceeded);
          attempts.push(`${liveModel}:${lastErrInfo.status}`);
          console.log(
            `[Lesson Audio] Live model ${liveModel} (voice=${voiceCandidate}, setupOk=${setupSucceeded}) failed (${lastErrInfo.status}): ${lastErrInfo.shortMsg}`
          );

          if (lastErrInfo.status === 403) {
            throw Object.assign(new Error('Clé API Gemini invalide ou non autorisée.'), {
              httpStatus: 403,
              detail: `${lastErrInfo.status} ${lastErrInfo.shortMsg}`,
            });
          }

          if (lastErrInfo.status === 429) {
            saw429 = true;
            markAudioModel429Cooldown(liveModel, lastErrInfo.rawMsg);
            break;
          }

          if (!setupSucceeded && lastErrInfo.status === 400) {
            continue;
          }

          break;
        }
      }
    }

    const finalStatus = saw429 || lastErrInfo.status === 429 ? 429 : lastErrInfo.status;
    const finalMsg =
      finalStatus === 429
        ? 'Quota Gemini gratuit dépassé pour l’audio. Ajoutez une clé API avec facturation dans Settings > Secrets ou réessayez plus tard.'
        : 'Impossible de générer la leçon audio pour le moment.';
    throw Object.assign(new Error(finalMsg), {
      httpStatus: finalStatus,
      detail: `${lastErrInfo.status} ${lastErrInfo.shortMsg}`,
      cause: lastErr,
    });
  };

  function prefetchLessonAudio(voiceName: string, finalScript: string): void {
    pruneLessonAudioPrefetchMap();
    const key = makeLessonSynthKey(voiceName, finalScript);
    if (lessonAudioPrefetchMap.has(key)) return;
    const promise = runLessonAudioSynthesis(voiceName, finalScript).catch((err) => {
      lessonAudioPrefetchMap.delete(key);
      throw err;
    });
    // Prevent Node UnhandledPromiseRejection if no request awaits this prefetch before it rejects
    void promise.catch(() => {});
    lessonAudioPrefetchMap.set(key, { promise, createdAt: Date.now() });
  }

  const getOrRunLessonAudio = (
    voiceName: string,
    finalScript: string,
    bypassCache = false
  ): Promise<AudioSynthResult> => {
    pruneLessonAudioPrefetchMap();
    const key = makeLessonSynthKey(voiceName, finalScript);
    if (bypassCache) {
      lessonAudioPrefetchMap.delete(key);
    } else {
      const existing = lessonAudioPrefetchMap.get(key);
      if (existing && Date.now() - existing.createdAt <= LESSON_AUDIO_PREFETCH_TTL_MS) {
        return existing.promise;
      }
    }
    const promise = runLessonAudioSynthesis(voiceName, finalScript).catch((err) => {
      lessonAudioPrefetchMap.delete(key);
      throw err;
    });
    lessonAudioPrefetchMap.set(key, { promise, createdAt: Date.now() });
    return promise;
  };

  /**
   * POST /api/topic-speaking/lesson-audio
   * Generates ONE continuous WAV audio lesson grouping priority errors with explanations in French
   * and an obligatory General American English accent, prioritizing fast Gemini TTS + prefetch overlap.
   */
  app.post('/api/topic-speaking/lesson-audio', async (req: Request, res: Response) => {
    let finalScript = '';
    try {
      const payload = (req.body || {}) as LessonAudioPayload & { forceRefresh?: boolean };
      const requestedVoice = (GEMINI_VOICES as readonly string[]).includes(payload.voiceName || '')
        ? String(payload.voiceName)
        : TOPIC_SPEAKING_VOICE_CONFIG.defaultVoice;

      const hasStructuredEval =
        Boolean(payload.cleanTranscription) ||
        Boolean(payload.correctedVersion) ||
        Array.isArray(payload.errors);

      if (!payload.scriptText?.trim() && !hasStructuredEval) {
        res.status(400).json({ error: 'Aucun contenu de leçon fourni pour générer l’audio.' });
        return;
      }

      const lessonStart = Date.now();
      finalScript = payload.scriptText?.trim()
        ? sanitizeSpokenText(payload.scriptText)
        : await generateConversationalLessonScript(payload);

      const audioRes = await getOrRunLessonAudio(
        requestedVoice,
        finalScript,
        Boolean(payload.forceRefresh)
      );
      const audioMs = Date.now() - lessonStart;
      console.log(
        `[Topic Speaking Timing] lessonAudioMs=${audioMs}ms model=${audioRes.modelUsed} voice=${audioRes.voiceName} attempts=${(audioRes.attempts || []).join(',')}`
      );

      // Binary WAV transport eliminates base64 +33% wire inflation and client-side atob decoding loop
      if (req.headers.accept?.includes('audio/wav')) {
        const wavBuffer = Buffer.from(audioRes.audioBase64, 'base64');
        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader('Content-Length', String(wavBuffer.length));
        res.setHeader('X-Lesson-Voice', audioRes.voiceName);
        res.setHeader('X-Lesson-Model', audioRes.modelUsed);
        res.setHeader('X-Lesson-Ms', String(audioMs));
        if (audioRes.attempts?.length) {
          res.setHeader('X-Lesson-Attempts', audioRes.attempts.join(','));
        }
        res.status(200).send(wavBuffer);
        return;
      }

      res.json({
        audioBase64: audioRes.audioBase64,
        mimeType: 'audio/wav',
        scriptText: finalScript,
        voiceName: audioRes.voiceName,
        model: audioRes.modelUsed,
        provider: 'Gemini',
      });
    } catch (err: any) {
      if (err?.httpStatus) {
        res.status(err.httpStatus).json({
          error: err.message,
          detail: err.detail,
          scriptText: finalScript || undefined,
        });
        return;
      }
      console.error('[API topic-speaking/lesson-audio Error]', err);
      const info = extractLiveErrorInfo(err);
      res.status(info.status).json({
        error: 'Erreur lors de la création de la leçon audio.',
        detail: `${info.status} ${info.shortMsg}`,
      });
    }
  });

  // Guarantee /api/* routes always return JSON (never fall through to index.html or HTML error pages)
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'API route not found.' });
  });

  app.use((err: any, req: Request, res: Response, next: any) => {
    if (req.path.startsWith('/api')) {
      const status = err?.status || err?.statusCode || 500;
      const msg =
        err?.type === 'entity.too.large'
          ? 'Le fichier audio est trop volumineux pour le serveur.'
          : err?.message || 'Erreur interne du serveur.';
      res.status(status).json({ error: msg });
      return;
    }
    next(err);
  });

  // Vite middleware in dev or static files in prod
  if (!isProd) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        ws: { server: httpServer },
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Translate & Speak server running on http://0.0.0.0:${PORT} (isProd: ${isProd})`);
  });
}

startServer().catch((err) => {
  console.error('Fatal error starting server:', err);
  process.exit(1);
});
