export type CEFRLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

export const CEFR_LEVELS: CEFRLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

export interface SpeakingTopic {
  id: string;
  title: string;
  question: string;
}

export type AmericanVoiceId =
  | 'Achird'
  | 'Sulafat'
  | 'Zephyr'
  | 'Puck'
  | 'Charon'
  | 'Kore'
  | 'Aoede'
  | 'Leda';

export const AMERICAN_VOICES: {
  id: AmericanVoiceId;
  label: string;
  description: string;
  recommended?: boolean;
}[] = [
  { id: 'Aoede', label: 'Aoede', description: 'Chaleureuse & très humaine', recommended: true },
  { id: 'Zephyr', label: 'Zephyr', description: 'Fluide & expressive', recommended: true },
  { id: 'Puck', label: 'Puck', description: 'Dynamique & souriante' },
  { id: 'Charon', label: 'Charon', description: 'Calme & posée' },
  { id: 'Kore', label: 'Kore', description: 'Claire & précise' },
  { id: 'Leda', label: 'Leda', description: 'Douce & naturelle' },
  { id: 'Achird', label: 'Achird', description: 'Chaleureuse' },
  { id: 'Sulafat', label: 'Sulafat', description: 'Posée' },
];

const EN_VOICE_KEY = 'hits_speakup_gemini_voice_v5';

export function getSavedAmericanVoice(): AmericanVoiceId {
  try {
    const saved = localStorage.getItem(EN_VOICE_KEY) as AmericanVoiceId | null;
    if (saved && AMERICAN_VOICES.some((v) => v.id === saved)) {
      return saved;
    }
  } catch {
    // ignore
  }
  return 'Aoede';
}

export function saveAmericanVoice(voice: AmericanVoiceId): void {
  try {
    localStorage.setItem(EN_VOICE_KEY, voice);
  } catch {
    // ignore
  }
}

export interface TopicScores {
  pronunciation: number;
  grammar: number;
  vocabulary: number;
  fluency: number;
  overall: number;
}

export interface CompactErrorItem {
  said: string;
  correct: string;
  type: 'pronunciation' | 'grammar' | 'vocabulary' | 'fluency';
  ipa: string;
  tip_fr: string;
}

export interface UpgradedExpressionItem {
  basic: string;
  upgraded: string;
  nuance_fr: string;
}

export interface TopicEvaluationResult {
  cleanTranscription: string;
  encouragementNote: string;
  unclearNote?: string;
  clarityFeedback?: string;
  correctedVersion: string;
  scores: TopicScores;
  errors: CompactErrorItem[];
  upgradedExpressions?: UpgradedExpressionItem[];
  repeatDrills?: string[];
  spokenLessonScript?: string;
  provider: 'Gemini' | 'Groq';
  serverAnalysisMs?: number;
}

const TOPIC_HISTORY_KEY = 'hits_speakup_topic_history_v1';
const MAX_HISTORY_PER_WORD = 30;

interface TopicHistoryStore {
  [wordLower: string]: string[];
}

function readHistoryStore(): TopicHistoryStore {
  try {
    const raw = localStorage.getItem(TOPIC_HISTORY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function getPreviousTopicsForWord(word: string): string[] {
  const key = word.trim().toLowerCase();
  if (!key) return [];
  const store = readHistoryStore();
  return Array.isArray(store[key]) ? store[key] : [];
}

export function saveGeneratedTopicsForWord(word: string, topics: SpeakingTopic[]): void {
  const key = word.trim().toLowerCase();
  if (!key || topics.length === 0) return;
  try {
    const store = readHistoryStore();
    const existing = Array.isArray(store[key]) ? store[key] : [];
    const additions = topics.map((t) => `${t.title}: ${t.question}`);
    const merged = Array.from(new Set([...additions, ...existing])).slice(0, MAX_HISTORY_PER_WORD);
    store[key] = merged;
    localStorage.setItem(TOPIC_HISTORY_KEY, JSON.stringify(store));
  } catch {
    // ignore storage quota errors
  }
}

// --- Recent Word Sessions History (last 10) ---
const RECENT_WORDS_KEY = 'hits_speakup_recent_words_v1';
const MAX_RECENT_WORDS = 10;

export interface RecentWordEntry {
  id: string;
  word: string;
  level: CEFRLevel;
  topics: SpeakingTopic[];
  provider: 'Gemini' | 'Groq';
  updatedAt: number;
}

export function getRecentWordHistory(): RecentWordEntry[] {
  try {
    const raw = localStorage.getItem(RECENT_WORDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENT_WORDS) : [];
  } catch {
    return [];
  }
}

export function saveRecentWordHistory(entry: Omit<RecentWordEntry, 'id' | 'updatedAt'>): RecentWordEntry[] {
  const cleanedWord = entry.word.trim();
  if (!cleanedWord || entry.topics.length === 0) return getRecentWordHistory();
  try {
    const existing = getRecentWordHistory();
    const newEntry: RecentWordEntry = {
      id: `${cleanedWord.toLowerCase()}_${entry.level}`,
      word: cleanedWord,
      level: entry.level,
      topics: entry.topics,
      provider: entry.provider,
      updatedAt: Date.now(),
    };
    const filtered = existing.filter(
      (item) => !(item.word.toLowerCase() === cleanedWord.toLowerCase() && item.level === entry.level)
    );
    const next = [newEntry, ...filtered].slice(0, MAX_RECENT_WORDS);
    localStorage.setItem(RECENT_WORDS_KEY, JSON.stringify(next));
    return next;
  } catch {
    return getRecentWordHistory();
  }
}

// --- Favorite Topics ---
const FAVORITE_TOPICS_KEY = 'hits_speakup_favorite_topics_v1';

export interface FavoriteTopicEntry {
  key: string;
  word: string;
  level: CEFRLevel;
  topic: SpeakingTopic;
  savedAt: number;
}

export function makeTopicKey(word: string, level: CEFRLevel, title: string): string {
  return `${word.trim().toLowerCase()}::${level}::${title.trim().toLowerCase()}`;
}

const TOPIC_RESULTS_KEY = 'hits_speakup_topic_results_v1';

export function saveTopicEvaluationResult(
  word: string,
  level: CEFRLevel,
  title: string,
  result: TopicEvaluationResult
): void {
  const key = makeTopicKey(word, level, title);
  try {
    const raw = localStorage.getItem(TOPIC_RESULTS_KEY);
    const map: Record<string, { result: TopicEvaluationResult; savedAt: number }> = raw
      ? JSON.parse(raw)
      : {};
    map[key] = { result, savedAt: Date.now() };
    // Keep last 20 saved evaluations to stay well within localStorage quota
    const entries = Object.entries(map)
      .sort((a, b) => b[1].savedAt - a[1].savedAt)
      .slice(0, 20);
    localStorage.setItem(TOPIC_RESULTS_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // ignore storage quota errors
  }
}

export function getSavedTopicEvaluationResult(
  word: string,
  level: CEFRLevel,
  title: string
): TopicEvaluationResult | null {
  const key = makeTopicKey(word, level, title);
  try {
    const raw = localStorage.getItem(TOPIC_RESULTS_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw);
    return map?.[key]?.result || null;
  } catch {
    return null;
  }
}

export function getFavoriteTopics(): FavoriteTopicEntry[] {
  try {
    const raw = localStorage.getItem(FAVORITE_TOPICS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function toggleFavoriteTopic(
  word: string,
  level: CEFRLevel,
  topic: SpeakingTopic
): FavoriteTopicEntry[] {
  const key = makeTopicKey(word, level, topic.title);
  try {
    const existing = getFavoriteTopics();
    const exists = existing.some((f) => f.key === key);
    const next = exists
      ? existing.filter((f) => f.key !== key)
      : [{ key, word: word.trim(), level, topic, savedAt: Date.now() }, ...existing].slice(0, 30);
    localStorage.setItem(FAVORITE_TOPICS_KEY, JSON.stringify(next));
    return next;
  } catch {
    return getFavoriteTopics();
  }
}

// --- Per-Topic Saved Scores (Progress Tracking) ---
const TOPIC_SCORES_KEY = 'hits_speakup_topic_scores_v1';

export function getSavedTopicScores(): Record<string, TopicScores> {
  try {
    const raw = localStorage.getItem(TOPIC_SCORES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveTopicScore(
  word: string,
  level: CEFRLevel,
  title: string,
  scores: TopicScores
): Record<string, TopicScores> {
  const key = makeTopicKey(word, level, title);
  try {
    const existing = getSavedTopicScores();
    const next = { ...existing, [key]: scores };
    localStorage.setItem(TOPIC_SCORES_KEY, JSON.stringify(next));
    return next;
  } catch {
    return getSavedTopicScores();
  }
}

async function postJson<T>(url: string, payload: unknown): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const rawText = await response.text();
    const trimmed = rawText.trim();
    const isHtml = trimmed.startsWith('<') || trimmed.toLowerCase().startsWith('<!doctype');

    let parsed: any = null;
    if (!isHtml && trimmed) {
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        parsed = null;
      }
    }

    if (response.ok && parsed !== null) {
      return parsed as T;
    }

    // Retry once automatically on transient proxy/HTML/502/503/504 responses
    const isTransient =
      isHtml || response.status === 502 || response.status === 503 || response.status === 504;
    if (attempt === 0 && isTransient) {
      await new Promise((r) => setTimeout(r, 800));
      continue;
    }

    if (!response.ok) {
      if (parsed?.detail) {
        lastError = new Error(String(parsed.detail));
      } else if (parsed?.error) {
        lastError = new Error(`${response.status} ${String(parsed.error)}`);
      } else if (response.status === 413) {
        lastError = new Error(
          '413 Enregistrement trop volumineux. Essayez un fichier un peu plus court.'
        );
      } else if (response.status === 504 || response.status === 502 || response.status === 503) {
        lastError = new Error(
          `${response.status} Le serveur met trop de temps à répondre.`
        );
      } else {
        lastError = new Error(`${response.status} Erreur serveur.`);
      }
    } else {
      console.error(`[TopicSpeaking] Expected JSON from ${url} (status ${response.status}), got:`, trimmed.slice(0, 200));
      lastError = new Error(
        'Le serveur a renvoyé une réponse inattendue (HTML au lieu de JSON). Rechargez la page et réessayez.'
      );
    }
  }

  throw lastError || new Error('Erreur réseau. Veuillez réessayer.');
}

export async function generateSpeakingTopics(
  word: string,
  level: CEFRLevel,
  previousTopics: string[]
): Promise<{ topics: SpeakingTopic[]; provider: 'Gemini' | 'Groq' }> {
  const data = await postJson<{
    topics: { title: string; question: string }[];
    provider?: 'Gemini' | 'Groq';
  }>('/api/topic-speaking/generate', {
    word,
    level,
    previousTopics,
  });

  if (!data || !Array.isArray(data.topics) || data.topics.length === 0) {
    throw new Error("Aucun sujet n'a pu être généré. Veuillez réessayer.");
  }

  const stamp = Date.now();
  const topics: SpeakingTopic[] = data.topics.slice(0, 3).map((t, idx) => ({
    id: `topic_${stamp}_${idx}`,
    title: String(t.title || '').trim(),
    question: String(t.question || '').trim(),
  }));

  saveGeneratedTopicsForWord(word, topics);

  return {
    topics,
    provider: data.provider === 'Groq' ? 'Groq' : 'Gemini',
  };
}

export async function evaluateTopicSpeaking(params: {
  word: string;
  level: CEFRLevel;
  topicTitle: string;
  topicQuestion: string;
  audioBase64?: string;
  audioMimeType?: string;
  typedText?: string;
}): Promise<TopicEvaluationResult> {
  const data = await postJson<{
    cleanTranscription?: string;
    encouragementNote?: string;
    unclearNote?: string;
    clarityFeedback?: string;
    correctedVersion?: string;
    scores?: Partial<TopicScores>;
    errors?: Partial<CompactErrorItem>[];
    upgradedExpressions?: Partial<UpgradedExpressionItem>[];
    repeatDrills?: string[];
    spokenLessonScript?: string;
    provider?: 'Gemini' | 'Groq';
    serverTiming?: { analysisMs?: number };
  }>('/api/topic-speaking/evaluate', params);

  const rawErrors: CompactErrorItem[] = Array.isArray(data.errors)
    ? data.errors
        .filter((e) => e && (e.said || e.correct || e.tip_fr))
        .map((e) => ({
          said: String(e.said || '').trim(),
          correct: String(e.correct || '').trim(),
          type:
            e.type === 'pronunciation' ||
            e.type === 'grammar' ||
            e.type === 'vocabulary' ||
            e.type === 'fluency'
              ? e.type
              : 'pronunciation',
          ipa: String(e.ipa || '').trim(),
          tip_fr: String(e.tip_fr || '').trim(),
        }))
    : [];

  // Sort pronunciation errors first and focus on top 4 most impactful corrections
  const priorityOrder = { pronunciation: 0, grammar: 1, vocabulary: 2, fluency: 3 };
  rawErrors.sort((a, b) => priorityOrder[a.type] - priorityOrder[b.type]);

  const upgradedExpressions: UpgradedExpressionItem[] = Array.isArray(data.upgradedExpressions)
    ? data.upgradedExpressions
        .filter((u) => u && (u.upgraded || u.nuance_fr))
        .slice(0, 3)
        .map((u) => ({
          basic: String(u.basic || '').trim(),
          upgraded: String(u.upgraded || '').trim(),
          nuance_fr: String(u.nuance_fr || '').trim(),
        }))
    : [];

  const repeatDrills: string[] = Array.isArray(data.repeatDrills)
    ? data.repeatDrills.map((d) => String(d || '').trim()).filter(Boolean).slice(0, 4)
    : [];

  return {
    cleanTranscription: data.cleanTranscription || '',
    encouragementNote: data.encouragementNote || '',
    unclearNote: data.unclearNote || '',
    clarityFeedback: data.clarityFeedback || '',
    correctedVersion: data.correctedVersion || '',
    scores: {
      pronunciation: Math.max(0, Math.min(100, Math.round(data.scores?.pronunciation ?? 0))),
      grammar: Math.max(0, Math.min(100, Math.round(data.scores?.grammar ?? 0))),
      vocabulary: Math.max(0, Math.min(100, Math.round(data.scores?.vocabulary ?? 0))),
      fluency: Math.max(0, Math.min(100, Math.round(data.scores?.fluency ?? 0))),
      overall: Math.max(0, Math.min(100, Math.round(data.scores?.overall ?? 0))),
    },
    errors: rawErrors.slice(0, 4),
    upgradedExpressions,
    repeatDrills,
    spokenLessonScript: typeof data.spokenLessonScript === 'string' ? data.spokenLessonScript.trim() : '',
    provider: data.provider === 'Groq' ? 'Groq' : 'Gemini',
    serverAnalysisMs: data.serverTiming?.analysisMs,
  };
}

function base64ToWavBlob(base64: string, mimeType = 'audio/wav'): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

/**
 * Normalizes a user audio Blob to mono 16 kHz 16-bit PCM WAV (up to ~4 min / 8 MB)
 * so Gemini always hears clean, universal audio without mobile WebM container quirks.
 */
export async function compressAudioBlobForUpload(
  blob: Blob,
  originalMime: string
): Promise<{ blob: Blob; mimeType: string }> {
  try {
    const AudioCtx =
      typeof window !== 'undefined'
        ? window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : undefined;
    if (!AudioCtx || typeof OfflineAudioContext === 'undefined') {
      return { blob, mimeType: originalMime };
    }

    const arrayBuf = await blob.arrayBuffer();
    const ctx = new AudioCtx();
    const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
    await ctx.close().catch(() => {});

    const targetRate = 16000;
    const frameCount = Math.max(1, Math.ceil(decoded.duration * targetRate));
    // Skip WAV expansion only for very long recordings (> ~4 min / > 8 MB WAV)
    if (frameCount * 2 + 44 > 8 * 1024 * 1024) {
      return { blob, mimeType: originalMime };
    }

    const offline = new OfflineAudioContext(1, frameCount, targetRate);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start(0);
    const rendered = await offline.startRendering();
    const samples = rendered.getChannelData(0);

    let peak = 0;
    let sumSq = 0;
    for (let i = 0; i < samples.length; i++) {
      const abs = Math.abs(samples[i]);
      if (abs > peak) peak = abs;
      sumSq += samples[i] * samples[i];
    }
    const rms = Math.sqrt(sumSq / Math.max(1, samples.length));

    if (peak < 0.002 || rms < 0.0002) {
      throw new Error("Aucun son détecté dans l'enregistrement. Vérifie ton microphone et réessaie.");
    }

    // Boost quiet mobile microphone recordings cleanly without clipping
    const gain = peak < 0.55 ? Math.min(20, 0.7 / peak) : 1;

    const dataSize = samples.length * 2;
    const wav = new ArrayBuffer(44 + dataSize);
    const view = new DataView(wav);
    const writeStr = (off: number, s: string) => {
      for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
    };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, targetRate, true);
    view.setUint32(28, targetRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
      const clamped = Math.max(-1, Math.min(1, samples[i] * gain));
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
      offset += 2;
    }

    return { blob: new Blob([wav], { type: 'audio/wav' }), mimeType: 'audio/wav' };
  } catch (err) {
    if (err instanceof Error && err.message.includes('Aucun son détecté')) {
      throw err;
    }
    return { blob, mimeType: originalMime };
  }
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('Impossible de lire le fichier audio.'));
    reader.readAsDataURL(blob);
  });
}

export interface LessonAudioResult {
  audioUrl: string;
  audioBlob: Blob;
  scriptText: string;
  voiceName: string;
  model: string;
  provider: 'Gemini';
}

const LESSON_AUDIO_DB_NAME = 'hits_speakup_lesson_audio_v2';
const LESSON_AUDIO_STORE = 'lessons';

interface CachedLessonRecord {
  key: string;
  blob: Blob;
  scriptText: string;
  voiceName: string;
  model: string;
  savedAt: number;
}

function openLessonAudioDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(LESSON_AUDIO_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(LESSON_AUDIO_STORE)) {
          db.createObjectStore(LESSON_AUDIO_STORE, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function makeLessonCacheKey(
  word: string,
  level: CEFRLevel,
  topicTitle: string,
  voiceName: AmericanVoiceId,
  evaluation: TopicEvaluationResult
): string {
  const sig = `v2::${evaluation.cleanTranscription}::${evaluation.clarityFeedback || ''}::${evaluation.correctedVersion}::${evaluation.errors
    .map((e) => `${e.said}|${e.correct}`)
    .join(';')}::${(evaluation.upgradedExpressions || []).map((u) => u.upgraded).join(';')}`;
  let hash = 0;
  for (let i = 0; i < sig.length; i++) {
    hash = (hash * 31 + sig.charCodeAt(i)) | 0;
  }
  return `${word.trim().toLowerCase()}::${level}::${topicTitle.trim().toLowerCase()}::${voiceName}::${hash}`;
}

async function getCachedLessonAudio(key: string): Promise<CachedLessonRecord | null> {
  const db = await openLessonAudioDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(LESSON_AUDIO_STORE, 'readonly');
      const store = tx.objectStore(LESSON_AUDIO_STORE);
      const req = store.get(key);
      req.onsuccess = () => resolve((req.result as CachedLessonRecord) || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function saveCachedLessonAudio(record: CachedLessonRecord): Promise<void> {
  const db = await openLessonAudioDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(LESSON_AUDIO_STORE, 'readwrite');
      const store = tx.objectStore(LESSON_AUDIO_STORE);
      store.put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Generates ONE continuous WAV audio lesson that groups ALL errors from the evaluation
 * with all explanations in natural French and an obligatory General American English accent.
 */
export async function synthesizeCompleteLessonAudio(params: {
  word: string;
  level: CEFRLevel;
  topicTitle: string;
  voiceName: AmericanVoiceId;
  evaluation: TopicEvaluationResult;
  forceRefresh?: boolean;
}): Promise<LessonAudioResult> {
  const cacheKey = makeLessonCacheKey(
    params.word,
    params.level,
    params.topicTitle,
    params.voiceName,
    params.evaluation
  );

  if (!params.forceRefresh) {
    const cached = await getCachedLessonAudio(cacheKey);
    if (cached && cached.blob && cached.blob.size > 400) {
      return {
        audioUrl: URL.createObjectURL(cached.blob),
        audioBlob: cached.blob,
        scriptText: cached.scriptText,
        voiceName: cached.voiceName,
        model: cached.model,
        provider: 'Gemini',
      };
    }
  }

  const requestBody = {
    word: params.word,
    level: params.level,
    topicTitle: params.topicTitle,
    voiceName: params.voiceName,
    forceRefresh: Boolean(params.forceRefresh),
    scriptText: params.evaluation.spokenLessonScript || undefined,
    cleanTranscription: params.evaluation.cleanTranscription,
    encouragementNote: params.evaluation.encouragementNote,
    unclearNote: params.evaluation.unclearNote,
    clarityFeedback: params.evaluation.clarityFeedback,
    correctedVersion: params.evaluation.correctedVersion,
    errors: params.evaluation.errors,
    upgradedExpressions: params.evaluation.upgradedExpressions,
    repeatDrills: params.evaluation.repeatDrills,
  };

  let audioBlob: Blob | null = null;
  let scriptText = params.evaluation.spokenLessonScript || '';
  let usedVoice: string = params.voiceName;
  let usedModel = 'gemini-3.8-flash-lite-tts';
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch('/api/topic-speaking/lesson-audio', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'audio/wav, application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const contentType = response.headers.get('content-type') || '';

    if (response.ok && contentType.includes('audio/')) {
      const blob = await response.blob();
      if (blob.size > 44) {
        audioBlob = blob;
        usedVoice = response.headers.get('x-lesson-voice') || params.voiceName;
        usedModel = response.headers.get('x-lesson-model') || usedModel;
        break;
      }
      lastError = new Error('Aucun audio reçu pour la leçon.');
      break;
    }

    const rawText = await response.text();
    const trimmed = rawText.trim();
    const isHtml = trimmed.startsWith('<') || trimmed.toLowerCase().startsWith('<!doctype');
    let parsed: any = null;
    if (!isHtml && trimmed) {
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        parsed = null;
      }
    }

    if (response.ok && parsed?.audioBase64) {
      audioBlob = base64ToWavBlob(parsed.audioBase64, parsed.mimeType || 'audio/wav');
      scriptText = parsed.scriptText || scriptText;
      usedVoice = parsed.voiceName || params.voiceName;
      usedModel = parsed.model || usedModel;
      break;
    }

    const isTransient =
      isHtml || response.status === 502 || response.status === 503 || response.status === 504;
    if (attempt === 0 && isTransient) {
      await new Promise((r) => setTimeout(r, 800));
      continue;
    }

    if (parsed?.detail) {
      lastError = new Error(String(parsed.detail));
    } else if (parsed?.error) {
      lastError = new Error(`${response.status} ${String(parsed.error)}`);
    } else {
      lastError = new Error(`${response.status || ''} Erreur lors de la préparation audio.`.trim());
    }
  }

  if (!audioBlob) {
    throw lastError || new Error('Aucun audio reçu pour la leçon.');
  }

  void saveCachedLessonAudio({
    key: cacheKey,
    blob: audioBlob,
    scriptText,
    voiceName: usedVoice,
    model: usedModel,
    savedAt: Date.now(),
  });

  return {
    audioUrl: URL.createObjectURL(audioBlob),
    audioBlob,
    scriptText,
    voiceName: usedVoice,
    model: usedModel,
    provider: 'Gemini',
  };
}

/**
 * Generates a short human French + American English sample for testing the selected voice.
 */
export async function testAmericanVoice(voiceName: AmericanVoiceId): Promise<LessonAudioResult> {
  const sampleScript =
    'Salut ! Je suis ton coach. Écoute bien mon accent américain sur cette phrase... "I feel really comfortable speaking English today." On travaille ensemble quand tu veux !';

  const data = await postJson<{
    audioBase64: string;
    mimeType?: string;
    scriptText?: string;
    voiceName?: string;
    model?: string;
  }>('/api/topic-speaking/lesson-audio', {
    voiceName,
    scriptText: sampleScript,
  });

  if (!data?.audioBase64) {
    throw new Error('Impossible de tester cette voix pour le moment.');
  }

  const audioBlob = base64ToWavBlob(data.audioBase64, data.mimeType || 'audio/wav');
  return {
    audioUrl: URL.createObjectURL(audioBlob),
    audioBlob,
    scriptText: data.scriptText || sampleScript,
    voiceName: data.voiceName || voiceName,
    model: data.model || 'gemini-live',
    provider: 'Gemini',
  };
}

