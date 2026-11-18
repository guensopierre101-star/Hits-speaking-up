import express from 'express';
import type { Request, Response } from 'express';
import http from 'http';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PRIMARY_MODEL = 'gemini-4-hydrogen';
const FAST_MODEL = 'gemini-3.1-flash-lite';
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

        // Switch immediately to next model on 404, 400, 503, timeout, or daily quota exhaustion
        if (
          msg.includes('404') ||
          msg.includes('NOT_FOUND') ||
          msg.includes('400') ||
          msg.includes('INVALID_ARGUMENT') ||
          msg.includes('503') ||
          msg.includes('UNAVAILABLE') ||
          msg.includes('Timeout') ||
          isDailyQuota
        ) {
          break;
        }

        if (attempt < MAX_RETRIES_PER_MODEL) {
          const backoff = isRateLimit ? 1500 : 300 * Math.pow(2, attempt - 1);
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

  // Support large audio base64 uploads (up to 50MB)
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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
