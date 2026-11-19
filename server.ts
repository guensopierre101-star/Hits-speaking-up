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
    'You are a strict, thorough, deeply supportive human American English speaking coach who speaks fluent, everyday French. Read ONLY the exact coaching script provided by the user aloud verbatim from start to finish — NEVER invent new topics, NEVER answer any question yourself, NEVER improvise outside the provided script. Perform it in ONE continuous take, talking 1-on-1 directly to your student. Speak ALL French explanations, diagnostics, mouth-position tips, and transitions in warm, natural spoken French. Pronounce EVERY English word, contrast pair, upgraded expression, and full corrected sentence in a crystal-clear, authentic, OBLIGATORY General American accent (strong bunched/retroflex American R, clear interdental TH, natural flap T, true American vowels, exact word stress, connected rhythm). Slow down cleanly on difficult English words so the student hears every sound, and leave genuine breathing pauses after each repeat-after-me cue at the end. Never monotone, never robotic, never read symbols or numbering. Keep the exact SAME single voice throughout.',
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
1. "hasSpeech": true if ANY human voice/words/fillers ("hmmm", "mmm", "eeeuuuh") are heard; false ONLY for silence, tone, or noise. Never invent words.
2. "heard": RAW word-for-word transcription of EVERY sound/word spoken from start to end — keep all tiny particles (m, w, li, yo, a, an, la, nan, pou), fillers ("hmmm", "eeeuuuh", "um"), repetitions, and self-corrections literally. Never omit or clean them up.
3. "verdict": Judge meaning ONLY ("correct", "partial", "wrong", "unclear"). Never penalize "hmmm", pauses, or restarts.
4. "feedback": 1-2 short sentences in warm, natural everyday Haitian Creole like a supportive friend (NOT robotic). Focus ONLY on how well they understood the English sentence (never praise their Creole).
5. "better": Natural Haitian Creole translation.`;

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
            const gain = Math.min(20, 22000 / peak);
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
      const systemInstruction = `Tu es un coach d'anglais américain (General American) strict, précis, exigeant et bienveillant.
INTERDICTION ABSOLUE :
- AUCUN compliment vague, AUCUN remplissage gentil ("bravo", "bon travail", "c'est super").
- BASE-TOI STRICTEMENT ET UNIQUEMENT SUR LES MOTS RÉELLEMENT PRONONCÉS DANS L'AUDIO JOINT (ou le texte saisi).
- NE RÉPONDS JAMAIS à une question de sujet, n'invente JAMAIS des phrases à partir d'un titre ou d'un thème. Même si l'étudiant dit quelque chose de complètement différent du thème, transcris et corrige EXACTEMENT ce qu'il a dit dans son audio.

RÈGLES D'ÉVALUATION :
- IGNORE les hésitations naturelles ("hmm", "uhh", "umm"), pauses silencieuses, auto-corrections et essais répétés d'un mot (évalue uniquement le DERNIER essai).
- Évalue rigoureusement le discours réel de l'étudiant selon 4 AXES PRÉCIS :
  1. Compréhension & Clarté : dis franchement si ce qu'il a dit dans son audio était immédiatement compréhensible ou pointe les passages précis qui étaient flous, ambigus ou difficiles à suivre.
  2. Prononciation & Accent Américain (PRIORITÉ) : repère les mots précis de SON AUDIO mal prononcés ou sans accent américain naturel ("R" américain, "TH", flap "T", qualité des voyelles, accent tonique/word stress, intonation, rythme/liaisons). Indique concrètement comment placer la langue/bouche pour les prononcer clairement.
  3. Phrasé Naturel & Grammaire : relève les erreurs de grammaire (temps verbaux, prépositions, pluriels) et les traductions littérales ou tournures non-natives entendues dans SON AUDIO.
  4. Vocabulaire Amélioré : propose 2 à 3 mots ou expressions américaines plus naturelles et de niveau supérieur pour mieux exprimer les idées réelles de SON AUDIO.
- CONCENTRE-TOI SUR LES 3 OU 4 CORRECTIONS LES PLUS IMPACTANTES AU TOTAL (maximum 4 éléments dans "errors") pour ne pas submerger l'étudiant.
- Réponds en JSON strict.`;

      // Notice: when evaluating audio, intentionally omit topicQuestion so Gemini NEVER confuses the question with the student's spoken words
      const basePrompt = typedText
        ? `Niveau : ${level} | Sujet : "${topicTitle}" | Question : "${topicQuestion}"
Texte de l'étudiant : "${typedText}"`
        : `Niveau de l'étudiant : ${level}
ÉCOUTE ATTENTIVEMENT L'AUDIO JOINT du début à la fin.
1) Mets "audioHeard" à true dès que tu entends une voix humaine ou des mots (même faibles, hésitants, avec du bruit de fond ou un fort accent). Mets false UNIQUEMENT si l'audio ne contient que du silence total ou du bruit mécanique sans aucune voix.
2) Transcris mot pour mot ce que l'étudiant dit RÉELLEMENT dans cet audio dans "cleanTranscription" (sans inventer ni deviner à partir du thème "${topicTitle}").
3) Fais toutes tes corrections STRICTEMENT sur les mots et la prononciation que tu as réellement entendus dans cet audio.`;

      const schemaPromptSuffix = `

JSON strict attendu :
- "audioHeard": true dès qu'une voix humaine ou des mots (même faibles ou avec un fort accent) sont audibles, false UNIQUEMENT pour du silence total ou du bruit sans voix.
- "cleanTranscription": transcription fidèle de ce que l'étudiant a réellement dit (sans fillers ni faux départs), ou "" si audioHeard est false.
- "encouragementNote": court constat direct et lucide en français (PAS de flatterie vague).
- "unclearNote": "" si tout était clair dès la première écoute, sinon mentionne précisément ce qui était flou ou ambigu en français.
- "clarityFeedback": 1 à 2 phrases directes en français sur la Compréhension & Clarté de ce que l'étudiant a dit.
- "correctedVersion": version complète corrigée en anglais américain naturel de CE QUE L'ÉTUDIANT A DIT.
- "scores": { "pronunciation": 0-100, "grammar": 0-100, "vocabulary": 0-100, "fluency": 0-100, "overall": 0-100 }.
- "errors": tableau des 3 ou 4 corrections LES PLUS IMPACTANTES UNIQUEMENT issues de ce que l'étudiant a vraiment dit (trie prononciation en premier, puis grammar/vocabulary/fluency) : { "said": "mot/passage exact qu'il a vraiment dit", "correct": "version américaine correcte", "type": "pronunciation"|"grammar"|"vocabulary"|"fluency", "ipa": "IPA américain si prononciation sinon ''", "tip_fr": "explication claire et concrète en français (comment placer les sons américains ou corriger la règle/tournure)" }.
- "upgradedExpressions": 2 à 3 améliorations de vocabulaire/phrasé adaptées à ses phrases réelles : { "basic": "expression utilisée dans son audio", "upgraded": "expression américaine plus naturelle et soutenue", "nuance_fr": "courte explication en français" }.
- "repeatDrills": tableau de 2 à 4 mots clés et courtes phrases corrigées en anglais américain issus de ses erreurs réelles à faire répéter à voix haute immédiatement à la fin.
- "spokenLessonScript": script oral COMPLET, direct et rythmé (entre 450 et 700 caractères, en tutoyant toujours l'élève — 'tu/ton/ta', jamais 'vous' — sans blabla inutile ni symboles IPA/markdown/numéros), prêt à être lu d'une traite : 1) constat direct sur la clarté, 2) les 3 ou 4 corrections prioritaires avec explications concrètes en français et chaque mot/phrase anglais précédé d'une courte amorce naturelle, 3) 2 expressions améliorées, 4) version corrigée complète puis consigne claire pour répéter à voix haute les "repeatDrills" avec de courtes pauses "...".`;

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

            const response = await ai.models.generateContent({
              model: modelName,
              contents,
              config: {
                systemInstruction,
                temperature: 0.2,
                responseMimeType: 'application/json',
                thinkingConfig: getThinkingConfigForModel(modelName),
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    audioHeard: { type: Type.BOOLEAN },
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
              },
            });
            return response.text;
          },
          (rawText) => JSON.parse(rawText),
          processedAudioBase64 ? [PRIMARY_MODEL, FAST_MODEL] : [FAST_MODEL, PRIMARY_MODEL],
          45000
        );

        if (
          processedAudioBase64 &&
          (result.data?.audioHeard === false || !String(result.data?.cleanTranscription || '').trim())
        ) {
          console.warn(
            `[Topic Speaking Evaluate] No words heard: mime=${audioMimeType} b64Len=${processedAudioBase64.length} wavPeak=${detectedWavPeak} audioHeard=${result.data?.audioHeard}`
          );
          res.status(400).json({
            error:
              "Je n'ai pas réussi à entendre de paroles dans ton audio. Parle plus près du microphone et réessaie.",
          });
          return;
        }

        const analysisMs = Date.now() - analysisStart;
        const transcriptPreview = String(result.data?.cleanTranscription || '').slice(0, 90);
        console.log(
          `[Topic Speaking Timing] evaluate model=${result.modelUsed} analysisMs=${analysisMs}ms issuesFound=${Array.isArray(result.data?.errors) ? result.data.errors.length : 0} transcript="${transcriptPreview}"`
        );
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

  const buildFallbackFrenchAmericanScript = (payload: LessonAudioPayload): string => {
    const rawErrors = Array.isArray(payload.errors) ? payload.errors : [];
    const priorityRank = (t?: string) =>
      t === 'pronunciation' ? 0 : t === 'grammar' ? 1 : t === 'vocabulary' ? 2 : 3;
    const topErrors = [...rawErrors]
      .sort((a, b) => priorityRank(a.type) - priorityRank(b.type))
      .slice(0, 4);

    const upgrades = Array.isArray(payload.upgradedExpressions)
      ? payload.upgradedExpressions.filter((u) => u && u.upgraded).slice(0, 3)
      : [];

    const drills = Array.isArray(payload.repeatDrills)
      ? payload.repeatDrills.map((d) => sanitizeSpokenText(d)).filter(Boolean).slice(0, 4)
      : topErrors.map((e) => sanitizeSpokenText(e.correct || '')).filter(Boolean).slice(0, 3);

    const parts: string[] = [];

    // 1. Comprehension & Clarity (direct, no gentle fluff)
    const clarityText = sanitizeSpokenText(
      payload.clarityFeedback || payload.unclearNote || ''
    );
    if (clarityText) {
      parts.push(`Bon, on attaque directement ton retour, sans détour. D'abord sur la clarté de ton message : ${clarityText}`);
    } else {
      parts.push("Bon, on attaque directement ton retour. D'abord, côté compréhension, ton idée principale passe tout de suite, mais on va corriger les points qui bloquent encore ton naturel.");
    }

    // 2. Top 3-4 most impactful corrections (Pronunciation & American Accent + Natural Phrasing & Grammar)
    if (topErrors.length > 0) {
      parts.push(
        `Je garde uniquement les ${topErrors.length} corrections les plus importantes pour que tu progresses vite sans te disperser.`
      );

      const pronLeads = [
        'Côté accent américain,',
        'Ensuite sur la prononciation américaine,',
        'Un autre son à corriger tout de suite,',
        'Toujours sur ton accent américain,',
      ];
      const grammarLeads = [
        'Sur la grammaire et le phrasé naturel,',
        'Autre point de structure qui sonne peu naturel,',
        'Regarde aussi cette tournure :',
        'Et côté grammaire,',
      ];
      const vocabFluencyLeads = [
        'Pour un phrasé vraiment américain,',
        'Côté choix des mots,',
        'Tu gagneras aussi en naturel ici :',
        'Et pour éviter la traduction littérale,',
      ];

      topErrors.forEach((err, idx) => {
        const said = sanitizeSpokenText(err.said || '');
        const correct = sanitizeSpokenText(err.correct || '');
        const tip = sanitizeSpokenText(err.tip_fr || '');
        const errType = err.type || 'pronunciation';

        if (errType === 'pronunciation') {
          let line = pronLeads[idx % pronLeads.length];
          if (said && correct) {
            line += ` quand tu as voulu dire... "${said}", l'articulation américaine n'était pas assez nette. Écoute bien comment on le prononce... "${correct}". "${correct}".`;
          } else if (correct) {
            line += ` fais très attention à la prononciation de... "${correct}". "${correct}".`;
          }
          if (tip) {
            line += ` ${tip.endsWith('.') || tip.endsWith('!') || tip.endsWith('?') ? tip : `${tip}.`}`;
          }
          parts.push(line);
        } else if (errType === 'grammar') {
          let line = grammarLeads[idx % grammarLeads.length];
          if (said && correct) {
            line += ` tu as dit... "${said}", mais en anglais américain correct on dit... "${correct}".`;
          } else if (correct) {
            line += ` la forme correcte en anglais américain, c'est... "${correct}".`;
          }
          if (tip) {
            line += ` ${tip.endsWith('.') || tip.endsWith('!') || tip.endsWith('?') ? tip : `${tip}.`}`;
          }
          parts.push(line);
        } else {
          let line = vocabFluencyLeads[idx % vocabFluencyLeads.length];
          if (said && correct) {
            line += ` au lieu de "${said}", un Américain dirait plutôt... "${correct}".`;
          } else if (correct) {
            line += ` la tournure naturelle en anglais américain, c'est... "${correct}".`;
          }
          if (tip) {
            line += ` ${tip.endsWith('.') || tip.endsWith('!') || tip.endsWith('?') ? tip : `${tip}.`}`;
          }
          parts.push(line);
        }
      });
    }

    // 3. Upgraded Vocabulary & Better Ways to Say It
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
            return `au lieu de "${basic}", essaie plutôt... "${up}"${nuance ? ` — ${nuance}` : ''}`;
          }
          return `tu peux utiliser... "${up}"${nuance ? ` — ${nuance}` : ''}`;
        })
        .join(' ; et ');
      parts.push(`Pour monter d'un cran côté vocabulaire et exprimer tes idées plus fluidement, ${upgradeLines}.`);
    }

    // 4. Full corrected version + Immediate repeat-out-loud drill
    if (payload.correctedVersion?.trim()) {
      parts.push(
        `Voici maintenant ta réponse complète dans un anglais américain naturel... "${sanitizeSpokenText(payload.correctedVersion)}".`
      );
    }

    if (drills.length > 0) {
      parts.push(
        `Maintenant, à toi de parler tout de suite à voix haute. Répète exactement après moi avec l'accent américain... ${drills
          .map((d) => `"${d}"... ...`)
          .join(' ')} Prends le temps de les redire bien fort pour ancrer le rythme.`
      );
    } else {
      parts.push(
        'Maintenant, répète la phrase corrigée à voix haute juste après moi, en exagérant bien le R et le rythme américain.'
      );
    }

    return parts.join(' ');
  };

  const generateConversationalLessonScript = async (
    payload: LessonAudioPayload
  ): Promise<string> => {
    const rawErrors = Array.isArray(payload.errors) ? payload.errors : [];
    const priorityRank = (t?: string) =>
      t === 'pronunciation' ? 0 : t === 'grammar' ? 1 : t === 'vocabulary' ? 2 : 3;
    // Focus strictly on the top 3 or 4 most impactful corrections
    const topErrors = [...rawErrors]
      .sort((a, b) => priorityRank(a.type) - priorityRank(b.type))
      .slice(0, 4);

    const upgrades = Array.isArray(payload.upgradedExpressions)
      ? payload.upgradedExpressions.slice(0, 3)
      : [];

    const drills = Array.isArray(payload.repeatDrills)
      ? payload.repeatDrills.filter(Boolean).slice(0, 4)
      : [];

    const fallbackScript = buildFallbackFrenchAmericanScript({
      ...payload,
      errors: topErrors,
      upgradedExpressions: upgrades,
      repeatDrills: drills,
    });

    if (topErrors.length === 0 && upgrades.length === 0 && !payload.correctedVersion) {
      return fallbackScript;
    }

    const errorsBlock =
      topErrors.length > 0
        ? topErrors
            .map((e, i) => {
              const kind = e.type || 'pronunciation';
              const said = e.said ? `"${e.said}"` : '(imprécis)';
              const correct = e.correct ? `"${e.correct}"` : '';
              const tip = e.tip_fr ? ` (${e.tip_fr})` : '';
              return `${i + 1}. [${kind}] ${said} -> ${correct}${tip}`;
            })
            .join('\n')
        : 'Aucune erreur majeure détectée.';

    const upgradesBlock =
      upgrades.length > 0
        ? upgrades
            .map(
              (u, i) =>
                `${i + 1}. ${u.basic ? `"${u.basic}" -> ` : ''}"${u.upgraded || ''}"${u.nuance_fr ? ` (${u.nuance_fr})` : ''}`
            )
            .join('\n')
        : '(Propose 2 expressions américaines plus naturelles et élevées pour exprimer ses idées)';

    const drillsBlock =
      drills.length > 0
        ? drills.map((d) => `"${d}"`).join(' | ')
        : topErrors.map((e) => `"${e.correct}"`).filter(Boolean).join(' | ');

    const scriptSystemInstruction = `Tu es un coach d'anglais américain strict, exigeant, précis et bienveillant qui parle couramment français.
Écris UNE SEULE correction orale continue, comme un vrai coach américain exigeant en tête-à-tête avec son élève.

INTERDICTIONS STRICTES :
- PAS de résumé vague, PAS de flatterie gentille inutile ("c'est génial", "bravo tu es super"). Sois direct, honnête, concret et encourageant par la précision.
- AUCUN titre robotique ("Point 1", "Domaine 2"), AUCUN symbole IPA (/.../), AUCUN markdown (*, #, -), AUCUNE puce, AUCUN numéro, AUCUNE parenthèse, AUCUN emoji. Uniquement du texte parlé fluide.

STRUCTURE OBLIGATOIRE EN 4 TEMPS (en français oral naturel pour les explications, anglais américain obligatoire pour chaque mot/phrase en anglais) :
1. COMPRÉHENSION & CLARTÉ : Commence sans blabla. Dis franchement si tout ce qu'il a dit était clair tout de suite, ou pointe exactement le passage qui était flou, ambigu ou difficile à suivre.
2. TOP ${Math.max(1, topErrors.length)} CORRECTIONS LES PLUS IMPACTANTES (Prononciation américaine + Phrasé & Grammaire) :
   - Couvre chaque correction ci-dessous sans en ajouter d'autres pour ne pas le submerger.
   - Pour la prononciation américaine (R américain, TH, flap T, voyelles, accent tonique, intonation, rythme/liaisons), explique concrètement en français comment prononcer et fais entendre clairement le mot avec un lead-in américain : par exemple : En anglais américain, on prononce... "comfortable". Comfortable.
   - Pour la grammaire et le phrasé naturel (temps, prépositions, pluriels, traductions littérales), explique pourquoi ça ne sonne pas naturel pour un Américain et donne la tournure authentique.
3. VOCABULAIRE AMÉLIORÉ (2 à 3 expressions) : Donne 2 ou 3 mots ou tournures américaines plus naturelles et de meilleur niveau pour exprimer ses idées principales plus fluidement.
4. VERSION CORRIGÉE + RÉPÉTITION À VOIX HAUTE OBLIGATOIRE : Lis clairement sa phrase corrigée complète en anglais américain, puis demande-lui explicitement de répéter à voix haute les mots et phrases clés tout de suite ("À toi, répète après moi à voix haute..."), en mettant de vraies pauses "..." après chaque élément pour lui laisser le temps de pratiquer immédiatement.`;

    const scriptPrompt = `Mot : "${payload.word || ''}" | Niveau : ${payload.level || 'B1'} | Sujet : "${payload.topicTitle || ''}"
Ce que l'étudiant a dit : "${payload.cleanTranscription || ''}"
Évaluation clarté : "${payload.clarityFeedback || payload.unclearNote || 'Message compréhensible dans l’ensemble.'}"

LES ${topErrors.length} CORRECTIONS PRIORITAIRES (inclus-les toutes, reste focalisé dessus) :
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
        const normalizedGen = generated.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
        const droppedError = topErrors.some((e) => {
          const tokens = sanitizeSpokenText(e.correct || '')
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .trim()
            .split(/\s+/)
            .filter((w) => w.length >= 2);
          return tokens.length > 0 && tokens.every((t) => !normalizedGen.includes(t));
        });
        if (!droppedError) {
          return generated;
        }
        console.warn('[Topic Speaking Lesson Script] LLM script dropped a priority correction, using fallback.');
      }
    } catch (err) {
      console.warn('[Topic Speaking Lesson Script] Using deterministic French script fallback:', err);
    }

    return fallbackScript;
  };

  const synthesizeLessonWithGeminiLive = async (
    model: string,
    chosenVoice: string,
    lessonScript: string
  ): Promise<{ audioBase64: string; modelUsed: string; voiceName: string }> => {
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

    const userPrompt = `Lis mot pour mot et exactement tel qu'il est écrit ce script de correction complet du début à la fin (sans rien inventer, modifier ni ajouter d'autre), avec une voix très humaine, chaleureuse et expressive. Parle toutes les explications en français naturel et prononce chaque mot ou phrase en anglais avec un accent américain obligatoire :\n\n${lessonScript}`;

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
        const wavBase64 = ensureWavFromPcmBuffer(Buffer.concat(pcmChunks), 24000);
        resolve({
          audioBase64: wavBase64,
          modelUsed: model,
          voiceName: chosenVoice,
        });
      };

      const timeoutId = setTimeout(() => {
        if (totalBytes > 4000) {
          finishSuccess();
        } else {
          finishReject(new Error(`Timeout after 95000ms (${model})`));
        }
      }, 95000);

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

  const synthesizeLessonWithGeminiTts = async (
    model: string,
    chosenVoice: string,
    lessonScript: string
  ): Promise<{ audioBase64: string; modelUsed: string; voiceName: string }> => {
    const ai = getGeminiClient();
    // Pass ONLY the clean spoken text so TTS models never read style instructions out loud
    const response = await withTimeout(
      ai.models.generateContent({
        model,
        contents: [
          {
            role: 'user',
            parts: [{ text: lessonScript }],
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
      18000,
      model
    );

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) {
      throw new Error(`No audio data returned by ${model}`);
    }
    const wavBase64 = ensureWavFromPcmBuffer(Buffer.from(base64Audio, 'base64'), 24000);
    return {
      audioBase64: wavBase64,
      modelUsed: model,
      voiceName: chosenVoice,
    };
  };

  /**
   * POST /api/topic-speaking/lesson-audio
   * Generates ONE continuous WAV audio lesson grouping priority errors with explanations in French
   * and an obligatory General American English accent, prioritizing fast Gemini TTS + Live fallback.
   */
  app.post('/api/topic-speaking/lesson-audio', async (req: Request, res: Response) => {
    try {
      const payload = (req.body || {}) as LessonAudioPayload;
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
      const finalScript = payload.scriptText?.trim()
        ? sanitizeSpokenText(payload.scriptText)
        : await generateConversationalLessonScript(payload);

      const liveVoiceCandidates = Array.from(
        new Set(
          CORE_LIVE_VOICES.has(requestedVoice)
            ? [requestedVoice, 'Aoede', 'Zephyr']
            : [requestedVoice, 'Aoede', 'Zephyr']
        )
      );

      let lastErrInfo = { status: 500, shortMsg: 'Erreur génération audio Gemini', rawMsg: '' };
      let quotaExhausted = false;

      // 1. Primary (Fast): Gemini TTS models (single fast batch request -> single WAV file)
      for (const ttsModel of TOPIC_SPEAKING_AUDIO_MODELS.tts) {
        try {
          const audioRes = await synthesizeLessonWithGeminiTts(
            ttsModel,
            requestedVoice,
            finalScript
          );
          const audioMs = Date.now() - lessonStart;
          console.log(
            `[Topic Speaking Timing] lessonAudioMs=${audioMs}ms model=${audioRes.modelUsed} voice=${audioRes.voiceName}`
          );
          res.json({
            audioBase64: audioRes.audioBase64,
            mimeType: 'audio/wav',
            scriptText: finalScript,
            voiceName: audioRes.voiceName,
            model: audioRes.modelUsed,
            provider: 'Gemini',
          });
          return;
        } catch (err: any) {
          lastErrInfo = extractLiveErrorInfo(err);
          console.log(
            `[Lesson Audio] TTS model ${ttsModel} failed (${lastErrInfo.status}): ${lastErrInfo.shortMsg}`
          );
          if (lastErrInfo.status === 403) {
            res.status(403).json({
              error: 'Clé API Gemini invalide ou non autorisée.',
              detail: `${lastErrInfo.status} ${lastErrInfo.shortMsg}`,
            });
            return;
          }
          if (lastErrInfo.status === 429) {
            quotaExhausted = true;
            break;
          }
        }
      }

      // 2. Fallback: Gemini Live native audio (if TTS failed and quota wasn't exhausted)
      if (!quotaExhausted) {
        for (const liveModel of TOPIC_SPEAKING_AUDIO_MODELS.live) {
          let stopLiveLoop = false;

          for (const voiceCandidate of liveVoiceCandidates) {
            try {
              const audioRes = await synthesizeLessonWithGeminiLive(
                liveModel,
                voiceCandidate,
                finalScript
              );
              const audioMs = Date.now() - lessonStart;
              console.log(
                `[Topic Speaking Timing] lessonAudioMs=${audioMs}ms model=${audioRes.modelUsed} voice=${audioRes.voiceName}`
              );
              res.json({
                audioBase64: audioRes.audioBase64,
                mimeType: 'audio/wav',
                scriptText: finalScript,
                voiceName: audioRes.voiceName,
                model: audioRes.modelUsed,
                provider: 'Gemini',
              });
              return;
            } catch (err: any) {
              lastErrInfo = extractLiveErrorInfo(err);
              const setupSucceeded = Boolean(err?.setupSucceeded);
              console.log(
                `[Lesson Audio] Live model ${liveModel} (voice=${voiceCandidate}, setupOk=${setupSucceeded}) failed (${lastErrInfo.status}): ${lastErrInfo.shortMsg}`
              );

              if (lastErrInfo.status === 403) {
                res.status(403).json({
                  error: 'Clé API Gemini invalide ou non autorisée.',
                  detail: `${lastErrInfo.status} ${lastErrInfo.shortMsg}`,
                });
                return;
              }

              if (lastErrInfo.status === 429) {
                quotaExhausted = true;
                stopLiveLoop = true;
                break;
              }

              if (!setupSucceeded && lastErrInfo.status === 400) {
                continue;
              }

              break;
            }
          }

          if (stopLiveLoop) break;
        }
      }

      const finalStatus = quotaExhausted || lastErrInfo.status === 429 ? 429 : lastErrInfo.status;
      res.status(finalStatus).json({
        error:
          finalStatus === 429
            ? 'Audio indisponible pour le moment (quota Gemini).'
            : 'Impossible de générer la leçon audio pour le moment.',
        detail: `${lastErrInfo.status} ${lastErrInfo.shortMsg}`,
        scriptText: finalScript,
      });
    } catch (err: unknown) {
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
