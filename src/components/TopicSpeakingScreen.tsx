import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  Download,
  FileAudio,
  Keyboard,
  Loader2,
  Mic,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Square,
  Volume2,
} from 'lucide-react';
import {
  blobToBase64,
  CEFR_LEVELS,
  CEFRLevel,
  compressAudioBlobForUpload,
  evaluateTopicSpeaking,
  generateSpeakingTopics,
  getPreviousTopicsForWord,
  getSavedTopicScores,
  makeTopicKey,
  saveTopicEvaluationResult,
  saveTopicScore,
  SpeakingTopic,
  synthesizeCompleteLessonAudio,
  TopicEvaluationResult,
  TopicScores,
} from '../services/topicSpeaking';

interface TopicSpeakingScreenProps {
  onBackToHome: () => void;
}

function formatTimer(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function pickSupportedRecorderMimeType(): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return '';
}

interface EvaluationPayload {
  audioBase64?: string;
  audioMimeType?: string;
  typedText?: string;
  userAudioUrl?: string;
  userAudioDuration?: number;
}

interface TopicCardState {
  isTyping: boolean;
  typedText: string;
  isAnalyzing: boolean;
  loadingStage: string;
  error: string | null;
  lastPayload: EvaluationPayload | null;
  result: TopicEvaluationResult | null;
  userAudioUrl: string | null;
  userAudioDuration: number;
  audioStatus: 'idle' | 'loading' | 'ready' | 'error';
  audioUrl: string | null;
  audioError: string | null;
}

const DEFAULT_CARD_STATE: TopicCardState = {
  isTyping: false,
  typedText: '',
  isAnalyzing: false,
  loadingStage: '',
  error: null,
  lastPayload: null,
  result: null,
  userAudioUrl: null,
  userAudioDuration: 0,
  audioStatus: 'idle',
  audioUrl: null,
  audioError: null,
};

interface WakeLockSentinelLike {
  release: () => Promise<void>;
}

interface UserAudioPlayerProps {
  audioUrl: string;
  fallbackDuration?: number;
}

const UserAudioPlayer: React.FC<UserAudioPlayerProps> = ({ audioUrl, fallbackDuration = 0 }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(fallbackDuration);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(fallbackDuration > 0 ? fallbackDuration : 0);
  }, [audioUrl, fallbackDuration]);

  const syncValidDuration = (el: HTMLAudioElement) => {
    if (Number.isFinite(el.duration) && el.duration > 0) {
      setDuration(el.duration);
    } else if (fallbackDuration > 0) {
      setDuration(fallbackDuration);
    }
  };

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play().catch(() => {});
    } else {
      el.pause();
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = audioRef.current;
    if (!el) return;
    const nextTime = Number(e.target.value);
    if (Number.isFinite(nextTime)) {
      el.currentTime = nextTime;
      setCurrentTime(nextTime);
    }
  };

  const maxDur = Number.isFinite(duration) && duration > 0 ? duration : 1;

  return (
    <div className="rounded-xl bg-app-bg/45 border border-app-border/60 px-3.5 py-2.5 space-y-2">
      <audio
        ref={audioRef}
        src={audioUrl}
        preload="metadata"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime;
          setCurrentTime(Number.isFinite(t) ? t : 0);
          syncValidDuration(e.currentTarget);
        }}
        onLoadedMetadata={(e) => syncValidDuration(e.currentTarget)}
        onDurationChange={(e) => syncValidDuration(e.currentTarget)}
      />

      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-app-muted flex items-center gap-1.5">
          <Mic className="w-3.5 h-3.5 text-app-muted" />
          <span>Ton audio</span>
        </span>
        <span className="text-[10px] font-mono text-app-muted tabular-nums">
          {formatTimer(currentTime)} / {duration > 0 ? formatTimer(duration) : '--:--'}
        </span>
      </div>

      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={isPlaying ? 'Pause' : 'Écouter ton audio'}
          className="w-8 h-8 rounded-full bg-app-inner hover:bg-app-primary/20 border border-app-border text-app-text flex items-center justify-center shrink-0 cursor-pointer transition-colors"
        >
          {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
        </button>

        <input
          type="range"
          min={0}
          max={maxDur}
          step={0.1}
          value={Math.min(currentTime, maxDur)}
          onChange={handleSeek}
          aria-label="Progression de ton audio"
          className="w-full h-1.5 accent-app-primary cursor-pointer"
        />
      </div>
    </div>
  );
};

interface LessonAudioPlayerProps {
  audioUrl: string;
  topicTitle: string;
  onRegenerate: () => void;
}

const LessonAudioPlayer: React.FC<LessonAudioPlayerProps> = ({
  audioUrl,
  topicTitle,
  onRegenerate,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState<0.75 | 1 | 1.25>(1);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    el.playbackRate = rate;
    const playPromise = el.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {
        setIsPlaying(false);
      });
    }
  }, [audioUrl]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
  }, [rate]);

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play().catch(() => {});
    } else {
      el.pause();
    }
  };

  const handleReplay = () => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = 0;
    void el.play().catch(() => {});
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = audioRef.current;
    if (!el) return;
    const nextTime = Number(e.target.value);
    if (Number.isFinite(nextTime)) {
      el.currentTime = nextTime;
      setCurrentTime(nextTime);
    }
  };

  const safeFileName = `${topicTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'lesson'}-coach.wav`;

  const maxDur = Number.isFinite(duration) && duration > 0 ? duration : 1;

  return (
    <div className="rounded-xl bg-app-bg/45 border border-app-primary/35 px-3.5 py-3 space-y-2.5">
      {/* ONE continuous audio element for the coach's oral correction */}
      <audio
        ref={audioRef}
        src={audioUrl}
        preload="auto"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime;
          setCurrentTime(Number.isFinite(t) ? t : 0);
        }}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          setDuration(Number.isFinite(d) && d > 0 ? d : 0);
        }}
      />

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-app-text flex items-center gap-1.5">
          <Volume2 className="w-3.5 h-3.5 text-app-primary shrink-0" />
          <span>Correction du coach</span>
        </span>

        <div className="flex items-center gap-1">
          {([0.75, 1, 1.25] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRate(r)}
              className={`px-2 py-0.5 rounded-md text-[10px] font-semibold cursor-pointer transition-colors ${
                rate === r
                  ? 'bg-app-primary text-white'
                  : 'text-app-muted hover:text-app-text'
              }`}
            >
              {r}x
            </button>
          ))}
        </div>
      </div>

      {/* Play / Scrub Controls */}
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={isPlaying ? 'Pause' : 'Lire la correction audio'}
          className="w-9 h-9 rounded-full bg-gradient-to-r from-app-primary to-app-cta-end hover:brightness-110 text-white flex items-center justify-center shrink-0 shadow-sm cursor-pointer"
        >
          {isPlaying ? <Pause className="w-4 h-4 fill-white" /> : <Play className="w-4 h-4 fill-white ml-0.5" />}
        </button>

        <div className="flex-1 min-w-0 flex items-center gap-2.5">
          <input
            type="range"
            min={0}
            max={maxDur}
            step={0.1}
            value={Math.min(currentTime, maxDur)}
            onChange={handleSeek}
            aria-label="Progression de la correction audio"
            className="w-full h-1.5 accent-app-primary cursor-pointer"
          />
          <span className="text-[10px] font-mono text-app-muted tabular-nums shrink-0">
            {formatTimer(currentTime)} / {duration > 0 ? formatTimer(duration) : '--:--'}
          </span>
        </div>
      </div>

      {/* Quiet secondary actions */}
      <div className="flex items-center justify-between gap-2 pt-0.5 text-[11px]">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleReplay}
            className="text-app-muted hover:text-app-text font-medium inline-flex items-center gap-1 cursor-pointer transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Réécouter</span>
          </button>

          <a
            href={audioUrl}
            download={safeFileName}
            className="text-app-muted hover:text-app-text font-medium inline-flex items-center gap-1 cursor-pointer transition-colors"
          >
            <Download className="w-3 h-3" />
            <span>Télécharger</span>
          </a>
        </div>

        <button
          type="button"
          onClick={onRegenerate}
          className="text-app-primary/90 hover:text-app-primary font-medium inline-flex items-center gap-1 cursor-pointer transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          <span>Régénérer</span>
        </button>
      </div>
    </div>
  );
};

export const TopicSpeakingScreen: React.FC<TopicSpeakingScreenProps> = ({ onBackToHome }) => {
  const [word, setWord] = useState('');
  const [activeWord, setActiveWord] = useState('');
  const [level, setLevel] = useState<CEFRLevel>('B1');
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [topics, setTopics] = useState<SpeakingTopic[]>([]);

  // Clean UI flow state
  const [isSearchOpen, setIsSearchOpen] = useState(true);
  const [focusedTopicId, setFocusedTopicId] = useState<string | null>(null);
  const [pendingSwitchTopicId, setPendingSwitchTopicId] = useState<string | null>(null);

  // Persisted scores
  const [savedScores, setSavedScores] = useState<Record<string, TopicScores>>(() =>
    getSavedTopicScores()
  );

  // Per-topic card state
  const [cardStates, setCardStates] = useState<Record<string, TopicCardState>>({});
  const audioRequestIdsRef = useRef<Record<string, number>>({});
  const activeObjectUrlsRef = useRef<Record<string, string>>({});
  const activeUserAudioUrlsRef = useRef<Record<string, string>>({});

  // Single active recorder across topic cards (NO time limit)
  const [recordingTopicId, setRecordingTopicId] = useState<string | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Section refs for smooth auto-scroll
  const searchSectionRef = useRef<HTMLDivElement | null>(null);
  const topicsSectionRef = useRef<HTMLDivElement | null>(null);
  const topicCardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const scrollToElement = (el: HTMLElement | null) => {
    if (!el) return;
    window.requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const acquireWakeLock = async () => {
    try {
      const nav = navigator as Navigator & {
        wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
      };
      if (nav.wakeLock && typeof nav.wakeLock.request === 'function') {
        wakeLockRef.current = await nav.wakeLock.request('screen');
      }
    } catch {
      // Wake Lock not supported or blocked; fail silently
    }
  };

  const releaseWakeLock = () => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
    }
  };

  const updateCard = (topicId: string, updater: (prev: TopicCardState) => TopicCardState) => {
    setCardStates((prev) => ({
      ...prev,
      [topicId]: updater(prev[topicId] || DEFAULT_CARD_STATE),
    }));
  };

  const cleanupRecorder = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    releaseWakeLock();
  };

  const revokeAllTopicAudioUrls = () => {
    Object.values(activeObjectUrlsRef.current).forEach((url) => {
      URL.revokeObjectURL(url);
    });
    activeObjectUrlsRef.current = {};
    Object.values(activeUserAudioUrlsRef.current).forEach((url) => {
      URL.revokeObjectURL(url);
    });
    activeUserAudioUrlsRef.current = {};
  };

  const recordingStartMsRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      cleanupRecorder();
      revokeAllTopicAudioUrls();
    };
  }, []);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setGenError(null);

    const cleaned = word.trim();
    if (!cleaned || /\s+/.test(cleaned)) {
      setGenError('Écris un seul mot anglais');
      return;
    }

    if (recordingTopicId) {
      stopRecording(false);
    }
    revokeAllTopicAudioUrls();

    setIsGenerating(true);
    try {
      const previousTopics = getPreviousTopicsForWord(cleaned);
      const { topics: generated } = await generateSpeakingTopics(
        cleaned,
        level,
        previousTopics
      );
      setActiveWord(cleaned);
      setTopics(generated);
      setCardStates({});
      setFocusedTopicId(null);
      setPendingSwitchTopicId(null);
      setIsSearchOpen(false);

      setTimeout(() => scrollToElement(topicsSectionRef.current), 120);
    } catch (err: unknown) {
      setGenError(
        err instanceof Error
          ? err.message
          : 'Impossible de générer les sujets pour le moment. Veuillez réessayer.'
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const getPersistedScoreForTopic = (topic: SpeakingTopic): TopicScores | null => {
    const targetWord = activeWord || word.trim();
    if (!targetWord) return null;
    const key = makeTopicKey(targetWord, level, topic.title);
    return savedScores[key] || null;
  };

  const handleReopenSearch = () => {
    if (recordingTopicId) {
      stopRecording(false);
    }
    setPendingSwitchTopicId(null);
    setIsSearchOpen(true);
    setTimeout(() => scrollToElement(searchSectionRef.current), 80);
  };

  const handleRequestSwitchTopic = (topicId: string) => {
    if (recordingTopicId && recordingTopicId !== topicId) {
      setPendingSwitchTopicId(topicId);
      return;
    }
    setFocusedTopicId(topicId);
    setTimeout(() => scrollToElement(topicCardRefs.current[topicId]), 100);
  };

  const handleConfirmSwitchTopic = () => {
    if (!pendingSwitchTopicId) return;
    const nextId = pendingSwitchTopicId;
    setPendingSwitchTopicId(null);
    stopRecording(false);
    setFocusedTopicId(nextId);
    setTimeout(() => scrollToElement(topicCardRefs.current[nextId]), 100);
  };

  const handleShowAllTopics = () => {
    if (recordingTopicId) {
      stopRecording(false);
    }
    setPendingSwitchTopicId(null);
    setFocusedTopicId(null);
    setTimeout(() => scrollToElement(topicsSectionRef.current), 100);
  };

  const generateLessonAudioForTopic = async (
    topic: SpeakingTopic,
    evalResult: TopicEvaluationResult,
    targetWordOverride?: string,
    targetLevelOverride?: CEFRLevel,
    forceRefresh = false
  ) => {
    const reqId = (audioRequestIdsRef.current[topic.id] || 0) + 1;
    audioRequestIdsRef.current[topic.id] = reqId;

    const activeTargetWord = targetWordOverride || activeWord || word.trim();
    const activeTargetLevel = targetLevelOverride || level;

    updateCard(topic.id, (prev) => ({
      ...prev,
      audioStatus: 'loading',
      audioError: null,
    }));

    try {
      const lessonAudio = await synthesizeCompleteLessonAudio({
        word: activeTargetWord,
        level: activeTargetLevel,
        topicTitle: topic.title,
        voiceName: 'Aoede',
        evaluation: evalResult,
        forceRefresh,
      });

      if (audioRequestIdsRef.current[topic.id] !== reqId) {
        URL.revokeObjectURL(lessonAudio.audioUrl);
        return;
      }

      if (activeObjectUrlsRef.current[topic.id]) {
        URL.revokeObjectURL(activeObjectUrlsRef.current[topic.id]);
      }
      activeObjectUrlsRef.current[topic.id] = lessonAudio.audioUrl;

      updateCard(topic.id, (prev) => ({
        ...prev,
        audioStatus: 'ready',
        audioUrl: lessonAudio.audioUrl,
        audioError: null,
      }));
    } catch (err: unknown) {
      if (audioRequestIdsRef.current[topic.id] !== reqId) return;
      const rawMsg =
        err instanceof Error
          ? err.message
          : 'Correction audio indisponible pour le moment.';
      updateCard(topic.id, (prev) => ({
        ...prev,
        audioStatus: 'error',
        audioError: rawMsg,
      }));
    }
  };

  const submitEvaluation = async (
    topic: SpeakingTopic,
    payload: EvaluationPayload
  ) => {
    const targetWord = activeWord || word.trim();

    setFocusedTopicId(topic.id);
    if (activeObjectUrlsRef.current[topic.id]) {
      URL.revokeObjectURL(activeObjectUrlsRef.current[topic.id]);
      delete activeObjectUrlsRef.current[topic.id];
    }

    if (payload.userAudioUrl) {
      if (
        activeUserAudioUrlsRef.current[topic.id] &&
        activeUserAudioUrlsRef.current[topic.id] !== payload.userAudioUrl
      ) {
        URL.revokeObjectURL(activeUserAudioUrlsRef.current[topic.id]);
      }
      activeUserAudioUrlsRef.current[topic.id] = payload.userAudioUrl;
    }

    updateCard(topic.id, (prev) => ({
      ...prev,
      isAnalyzing: true,
      lastPayload: payload,
      loadingStage: payload.audioBase64 ? 'Analyse de ton audio...' : 'Analyse en cours...',
      error: null,
      userAudioUrl: payload.userAudioUrl ?? prev.userAudioUrl,
      userAudioDuration: payload.userAudioDuration ?? prev.userAudioDuration,
      audioStatus: 'idle',
      audioUrl: null,
      audioError: null,
    }));

    try {
      const evalResult = await evaluateTopicSpeaking({
        word: targetWord,
        level,
        topicTitle: topic.title,
        topicQuestion: topic.question,
        audioBase64: payload.audioBase64,
        audioMimeType: payload.audioMimeType,
        typedText: payload.typedText,
      });

      if (targetWord) {
        saveTopicEvaluationResult(targetWord, level, topic.title, evalResult);
        const nextScores = saveTopicScore(targetWord, level, topic.title, evalResult.scores);
        setSavedScores(nextScores);
      }

      // Show user audio immediately while coach correction audio generates
      updateCard(topic.id, (prev) => ({
        ...prev,
        result: evalResult,
        isAnalyzing: false,
        isTyping: false,
        typedText: '',
        loadingStage: '',
        audioStatus: 'loading',
      }));

      setTimeout(() => scrollToElement(topicCardRefs.current[topic.id]), 120);

      void generateLessonAudioForTopic(topic, evalResult, targetWord, level, false);
    } catch (err: unknown) {
      updateCard(topic.id, (prev) => ({
        ...prev,
        isAnalyzing: false,
        loadingStage: '',
        error:
          err instanceof Error
            ? err.message
            : "L'analyse a échoué. Veuillez réessayer.",
      }));
    }
  };

  const startRecording = async (topic: SpeakingTopic) => {
    if (recordingTopicId) {
      stopRecording(false);
    }

    setFocusedTopicId(topic.id);
    setPendingSwitchTopicId(null);
    updateCard(topic.id, (prev) => ({ ...prev, error: null, isTyping: false }));
    setTimeout(() => scrollToElement(topicCardRefs.current[topic.id]), 100);

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function' ||
      typeof MediaRecorder === 'undefined'
    ) {
      updateCard(topic.id, (prev) => ({
        ...prev,
        error:
          "Votre navigateur ne prend pas en charge l'enregistrement audio. Utilisez « 📁 Audio » ou « ✍️ Écrit ».",
      }));
      return;
    }

    let acquiredStream: MediaStream | null = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      acquiredStream = stream;
      streamRef.current = stream;

      const mimeType = pickSupportedRecorderMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32000 })
        : new MediaRecorder(stream, { audioBitsPerSecond: 32000 });

      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const finalMime = (recorder.mimeType || mimeType || 'audio/webm').split(';')[0];
        const audioBlob = new Blob(audioChunksRef.current, { type: finalMime });
        const recordedDuration =
          recordingStartMsRef.current > 0
            ? Math.max(1, Math.round((Date.now() - recordingStartMsRef.current) / 1000))
            : 0;
        audioChunksRef.current = [];
        cleanupRecorder();
        setRecordingTopicId(null);

        if (audioBlob.size < 1000) {
          updateCard(topic.id, (prev) => ({
            ...prev,
            error: 'Enregistrement trop court. Essayez de parler un peu plus longtemps.',
          }));
          return;
        }

        try {
          const userAudioUrl = URL.createObjectURL(audioBlob);
          const compressed = await compressAudioBlobForUpload(audioBlob, finalMime);
          const base64 = await blobToBase64(compressed.blob);
          await submitEvaluation(topic, {
            audioBase64: base64,
            audioMimeType: compressed.mimeType,
            userAudioUrl,
            userAudioDuration: recordedDuration,
          });
        } catch (readErr: unknown) {
          updateCard(topic.id, (prev) => ({
            ...prev,
            error:
              readErr instanceof Error
                ? readErr.message
                : 'Impossible de traiter votre enregistrement audio.',
          }));
        }
      };

      recorder.start(500);
      recordingStartMsRef.current = Date.now();
      setRecordingTopicId(topic.id);
      setRecordingSeconds(0);
      void acquireWakeLock();

      // Informational timer counting up — NO time limit
      timerRef.current = window.setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err: unknown) {
      if (acquiredStream) {
        acquiredStream.getTracks().forEach((track) => track.stop());
      }
      cleanupRecorder();
      setRecordingTopicId(null);

      const errName = (err as { name?: string })?.name || '';
      if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
        updateCard(topic.id, (prev) => ({
          ...prev,
          error:
            "Accès au microphone refusé. Veuillez autoriser le microphone dans les paramètres de votre navigateur, ou utilisez « 📁 Audio » / « ✍️ Écrit ».",
        }));
      } else {
        updateCard(topic.id, (prev) => ({
          ...prev,
          error:
            "Impossible d'accéder au microphone sur cet appareil. Vous pouvez importer un fichier audio ou écrire votre réponse.",
        }));
      }
    }
  };

  const stopRecording = (processAudio: boolean) => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      if (!processAudio) {
        recorder.onstop = null;
        recorder.stop();
        cleanupRecorder();
        setRecordingTopicId(null);
        return;
      }
      setTimeout(() => {
        if (recorder.state !== 'inactive') {
          recorder.stop();
        }
      }, 150);
    } else {
      cleanupRecorder();
      setRecordingTopicId(null);
    }
  };

  const handleAudioFileUpload = async (
    topic: SpeakingTopic,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setFocusedTopicId(topic.id);

    if (file.size > 60 * 1024 * 1024) {
      updateCard(topic.id, (prev) => ({
        ...prev,
        error: 'Le fichier audio est trop volumineux (maximum 60 Mo).',
      }));
      return;
    }

    try {
      const mimeType = (file.type || 'audio/mp3').split(';')[0];
      const userAudioUrl = URL.createObjectURL(file);
      const compressed = await compressAudioBlobForUpload(file, mimeType);
      const base64 = await blobToBase64(compressed.blob);
      await submitEvaluation(topic, {
        audioBase64: base64,
        audioMimeType: compressed.mimeType,
        userAudioUrl,
      });
    } catch (err: unknown) {
      updateCard(topic.id, (prev) => ({
        ...prev,
        error:
          err instanceof Error ? err.message : 'Impossible de lire ce fichier audio.',
      }));
    }
  };

  const handleTypedSubmit = async (topic: SpeakingTopic, e: React.FormEvent) => {
    e.preventDefault();
    const state = cardStates[topic.id] || DEFAULT_CARD_STATE;
    if (!state.typedText.trim()) return;
    await submitEvaluation(topic, { typedText: state.typedText.trim() });
  };

  const handleRetryTopic = (topicId: string) => {
    if (activeObjectUrlsRef.current[topicId]) {
      URL.revokeObjectURL(activeObjectUrlsRef.current[topicId]);
      delete activeObjectUrlsRef.current[topicId];
    }
    if (activeUserAudioUrlsRef.current[topicId]) {
      URL.revokeObjectURL(activeUserAudioUrlsRef.current[topicId]);
      delete activeUserAudioUrlsRef.current[topicId];
    }
    updateCard(topicId, (prev) => ({
      ...prev,
      result: null,
      error: null,
      userAudioUrl: null,
      userAudioDuration: 0,
      audioStatus: 'idle',
      audioUrl: null,
      audioError: null,
    }));
  };

  const isAnyCardAnalyzing = Object.values(cardStates).some((c) => c.isAnalyzing);

  return (
    <div className="w-full max-w-2xl mx-auto px-3 sm:px-5 py-3 sm:py-5 pb-safe overflow-x-hidden">
      <div className="space-y-3">
        {/* Minimal, classic context header (no duplicate Accueil button or step boxes) */}
        <div ref={searchSectionRef} className="transition-all duration-200">
          {!isSearchOpen && topics.length > 0 ? (
            <div className="flex items-center justify-between gap-3 px-1">
              <div className="flex items-center gap-2 min-w-0">
                <h1 className="text-sm sm:text-base font-bold text-app-text tracking-tight">
                  Topic Speaking
                </h1>
                <span className="text-app-muted/50">·</span>
                <span className="text-xs sm:text-sm font-semibold text-app-text truncate">
                  {activeWord}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-app-primary/15 text-app-primary text-[10px] font-bold shrink-0">
                  {level}
                </span>
              </div>
              <button
                type="button"
                onClick={handleReopenSearch}
                disabled={isGenerating || isAnyCardAnalyzing}
                className="text-xs font-semibold text-app-primary hover:underline inline-flex items-center gap-1 shrink-0 cursor-pointer disabled:opacity-45"
              >
                <span>Nouveau mot</span>
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 px-1">
                <h1 className="text-base sm:text-lg font-bold tracking-tight text-app-text">
                  Topic Speaking
                </h1>
                {topics.length > 0 && !isGenerating && (
                  <button
                    type="button"
                    onClick={() => setIsSearchOpen(false)}
                    className="text-xs font-medium text-app-muted hover:text-app-text cursor-pointer"
                  >
                    Fermer
                  </button>
                )}
              </div>
              <form
                onSubmit={handleGenerate}
                className="glass-panel rounded-2xl p-4 space-y-3.5"
              >
                <div className="space-y-1.5">
                  <label htmlFor="topic-word" className="text-xs font-semibold text-app-muted block">
                    Mot en anglais
                  </label>
                  <div className="relative">
                    <Search className="w-4 h-4 text-app-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="topic-word"
                      type="text"
                      value={word}
                      onChange={(e) => {
                        setWord(e.target.value);
                        if (genError) setGenError(null);
                      }}
                      placeholder="Ex : travel, confidence, eat..."
                      className="w-full pl-9 pr-3 py-2 min-h-[42px] text-sm bg-app-bg/50 border border-app-border rounded-xl text-app-text placeholder-app-muted/60 focus:outline-none focus:border-app-primary"
                      disabled={isGenerating}
                    />
                  </div>
                </div>

                {/* CEFR Level Selector */}
                <div className="space-y-1.5">
                  <span className="text-xs font-semibold text-app-muted block">Niveau CECR</span>
                  <div className="grid grid-cols-6 gap-1.5">
                    {CEFR_LEVELS.map((lvl) => (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() => setLevel(lvl)}
                        disabled={isGenerating}
                        className={`min-h-[38px] rounded-lg text-xs font-bold transition-all cursor-pointer disabled:opacity-50 ${
                          level === lvl
                            ? 'bg-app-primary text-white shadow-sm'
                            : 'bg-app-bg/45 border border-app-border/70 text-app-muted hover:text-app-text'
                        }`}
                      >
                        {lvl}
                      </button>
                    ))}
                  </div>
                </div>

                {genError && (
                  <div className="p-2.5 rounded-xl bg-app-accent/12 border border-app-accent/35 text-xs text-app-accent font-medium flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{genError}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isGenerating}
                  className="w-full min-h-[42px] rounded-xl bg-gradient-to-r from-app-primary to-app-cta-end hover:brightness-110 disabled:opacity-50 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-sm cursor-pointer transition-all"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Génération...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>Générer 3 sujets</span>
                    </>
                  )}
                </button>
              </form>
            </div>
          )}
        </div>

        {/* In-App Confirmation Banner when trying to switch topic during active recording */}
        {pendingSwitchTopicId && (
          <div className="p-3.5 rounded-2xl bg-app-accent/12 border border-app-accent/40 space-y-2 shadow-sm">
            <div className="text-xs font-bold text-app-text">
              Arrêter l&apos;enregistrement en cours ?
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleConfirmSwitchTopic}
                className="px-3 min-h-[36px] rounded-lg bg-app-accent text-white font-bold text-xs cursor-pointer"
              >
                Arrêter et changer
              </button>
              <button
                type="button"
                onClick={() => setPendingSwitchTopicId(null)}
                className="px-3 min-h-[36px] rounded-lg bg-app-bg/50 border border-app-border text-xs font-semibold text-app-text cursor-pointer"
              >
                Continuer
              </button>
            </div>
          </div>
        )}

        {/* 2. GENERATED TOPICS LIST */}
        {topics.length > 0 && !isSearchOpen && (
          <div ref={topicsSectionRef} className="space-y-2.5">
            {topics.map((topic, index) => {
              const card = cardStates[topic.id] || DEFAULT_CARD_STATE;
              const isRecordingThis = recordingTopicId === topic.id;
              const isCollapsed = focusedTopicId !== null && focusedTopicId !== topic.id;
              const persistedScore = getPersistedScoreForTopic(topic);

              if (isCollapsed) {
                return (
                  <button
                    key={topic.id}
                    type="button"
                    onClick={() => handleRequestSwitchTopic(topic.id)}
                    className="w-full text-left glass-panel rounded-xl px-3.5 py-2.5 min-h-[44px] hover:border-app-primary/45 flex items-center justify-between gap-3 transition-all cursor-pointer"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[11px] font-bold text-app-primary shrink-0">
                        Sujet {index + 1}
                      </span>
                      <span className="text-xs sm:text-sm font-semibold text-app-text truncate">
                        {topic.title}
                      </span>
                    </div>
                    <ChevronDown className="w-4 h-4 text-app-muted shrink-0" />
                  </button>
                );
              }

              return (
                <div
                  key={topic.id}
                  ref={(el) => {
                    topicCardRefs.current[topic.id] = el;
                  }}
                  className="glass-panel rounded-2xl p-4 sm:p-5 space-y-3.5 transition-all"
                >
                  {/* Topic Header */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] font-bold uppercase tracking-wide text-app-primary">
                          Sujet {index + 1} · Niveau {level}
                        </span>
                        {persistedScore && !card.result && (
                          <span className="px-2 py-0.5 rounded-md bg-app-primary/10 text-app-primary text-[10px] font-bold tabular-nums">
                            Dernier score : {persistedScore.overall}/100
                          </span>
                        )}
                      </div>
                    </div>

                    <h2 className="text-sm sm:text-base font-bold text-app-text">
                      {topic.title}
                    </h2>
                    <p className="text-xs sm:text-sm text-app-muted leading-relaxed">
                      {topic.question}
                    </p>
                  </div>

                  {/* Error Banner (keeps recording so user can retry without re-recording) */}
                  {card.error && (
                    <div className="p-3 rounded-xl bg-app-accent/12 border border-app-accent/35 text-xs text-app-accent font-medium flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-start gap-2 min-w-0 flex-1">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span className="break-words">{card.error}</span>
                      </div>
                      {card.lastPayload && (
                        <button
                          type="button"
                          onClick={() => submitEvaluation(topic, card.lastPayload!)}
                          disabled={card.isAnalyzing}
                          className="px-3 min-h-[32px] rounded-lg bg-app-accent text-white font-bold text-[11px] inline-flex items-center gap-1.5 shrink-0 cursor-pointer hover:brightness-110 disabled:opacity-50"
                        >
                          <RefreshCw className="w-3 h-3" />
                          <span>Réessayer</span>
                        </button>
                      )}
                    </div>
                  )}

                  {/* Active Recording UI */}
                  {isRecordingThis && (
                    <div className="p-4 rounded-xl bg-app-bg/45 border border-app-accent/30 flex flex-col items-center text-center space-y-2.5">
                      <div className="inline-flex items-center gap-2 text-xs font-semibold text-app-accent">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-app-accent opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-app-accent" />
                        </span>
                        <span>Enregistrement</span>
                      </div>
                      <div className="text-xl font-mono font-bold text-app-text tabular-nums">
                        {formatTimer(recordingSeconds)}
                      </div>
                      <div className="flex items-center gap-2 w-full sm:w-auto">
                        <button
                          type="button"
                          onClick={() => stopRecording(true)}
                          className="flex-1 sm:flex-initial px-4 min-h-[40px] rounded-xl bg-app-accent hover:brightness-110 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Square className="w-3 h-3 fill-white" />
                          <span>Arrêter et analyser</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => stopRecording(false)}
                          className="px-3 min-h-[40px] rounded-xl bg-app-bg/50 border border-app-border text-xs font-medium text-app-muted hover:text-app-text cursor-pointer"
                        >
                          Annuler
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Analyzing Audio State */}
                  {card.isAnalyzing && (
                    <div className="py-4 flex items-center justify-center gap-2.5 text-center">
                      <Loader2 className="w-4 h-4 text-app-primary animate-spin" />
                      <span className="text-xs font-semibold text-app-text">
                        {card.loadingStage || 'Analyse de ton audio...'}
                      </span>
                    </div>
                  )}

                  {/* Input Controls */}
                  {!isRecordingThis && !card.isAnalyzing && !card.result && (
                    <div className="space-y-2.5 pt-1">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={isAnyCardAnalyzing}
                          onClick={() => startRecording(topic)}
                          className="flex-1 min-w-[140px] min-h-[42px] px-4 rounded-xl bg-gradient-to-r from-app-primary to-app-cta-end hover:brightness-110 disabled:opacity-45 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-sm cursor-pointer transition-all"
                        >
                          <Mic className="w-4 h-4 shrink-0" />
                          <span>Parler</span>
                        </button>

                        <input
                          ref={(el) => {
                            fileInputRefs.current[topic.id] = el;
                          }}
                          type="file"
                          accept="audio/*"
                          onChange={(e) => handleAudioFileUpload(topic, e)}
                          className="hidden"
                        />
                        <button
                          type="button"
                          disabled={isAnyCardAnalyzing}
                          onClick={() => {
                            setFocusedTopicId(topic.id);
                            fileInputRefs.current[topic.id]?.click();
                          }}
                          className="min-h-[42px] px-3.5 rounded-xl bg-app-bg/45 border border-app-border hover:border-app-primary/50 disabled:opacity-45 text-app-text font-medium text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                        >
                          <FileAudio className="w-3.5 h-3.5 text-app-primary" />
                          <span>Audio</span>
                        </button>

                        <button
                          type="button"
                          disabled={isAnyCardAnalyzing}
                          onClick={() => {
                            setFocusedTopicId(topic.id);
                            updateCard(topic.id, (prev) => ({ ...prev, isTyping: !prev.isTyping }));
                          }}
                          className="min-h-[42px] px-3.5 rounded-xl bg-app-bg/45 border border-app-border hover:border-app-primary/50 disabled:opacity-45 text-app-text font-medium text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                        >
                          <Keyboard className="w-3.5 h-3.5 text-app-primary" />
                          <span>Écrit</span>
                        </button>
                      </div>

                      {card.isTyping && (
                        <form
                          onSubmit={(e) => handleTypedSubmit(topic, e)}
                          className="space-y-2 pt-1"
                        >
                          <textarea
                            value={card.typedText}
                            onChange={(e) =>
                              updateCard(topic.id, (prev) => ({
                                ...prev,
                                typedText: e.target.value,
                              }))
                            }
                            rows={3}
                            placeholder="Écrivez votre réponse en anglais..."
                            className="w-full px-3 py-2 text-sm bg-app-bg/50 border border-app-border rounded-xl text-app-text placeholder-app-muted/60 focus:outline-none focus:border-app-primary"
                          />
                          <button
                            type="submit"
                            disabled={!card.typedText.trim() || isAnyCardAnalyzing}
                            className="px-4 min-h-[38px] rounded-xl bg-app-primary hover:brightness-110 disabled:opacity-45 text-white font-bold text-xs inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            <Send className="w-3.5 h-3.5" />
                            <span>Analyser</span>
                          </button>
                        </form>
                      )}
                    </div>
                  )}

                  {/* 3. AUDIO-ONLY RESULT (User's own audio + Coach oral correction audio) */}
                  {card.result && !card.isAnalyzing && (
                    <div className="space-y-2.5 pt-2.5 border-t border-app-border/60">
                      {card.userAudioUrl && (
                        <UserAudioPlayer
                          audioUrl={card.userAudioUrl}
                          fallbackDuration={card.userAudioDuration}
                        />
                      )}

                      {card.audioStatus === 'loading' && (
                        <div className="rounded-xl bg-app-bg/45 border border-app-primary/25 px-3.5 py-3 flex items-center gap-2.5">
                          <Loader2 className="w-4 h-4 text-app-primary animate-spin shrink-0" />
                          <span className="text-xs font-medium text-app-text">
                            Préparation de la correction audio...
                          </span>
                        </div>
                      )}

                      {card.audioStatus === 'ready' && card.audioUrl && (
                        <LessonAudioPlayer
                          audioUrl={card.audioUrl}
                          topicTitle={topic.title}
                          onRegenerate={() =>
                            void generateLessonAudioForTopic(
                              topic,
                              card.result!,
                              activeWord || word.trim(),
                              level,
                              true
                            )
                          }
                        />
                      )}

                      {card.audioStatus === 'error' && (
                        <div className="rounded-xl bg-app-bg/45 border border-app-border/70 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs text-app-muted break-words min-w-0 flex-1">
                            {card.audioError || 'Correction audio indisponible pour le moment.'}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              void generateLessonAudioForTopic(
                                topic,
                                card.result!,
                                activeWord || word.trim(),
                                level,
                                true
                              )
                            }
                            className="text-xs font-semibold text-app-primary hover:underline inline-flex items-center gap-1 shrink-0 cursor-pointer"
                          >
                            <RefreshCw className="w-3 h-3" />
                            <span>Réessayer</span>
                          </button>
                        </div>
                      )}

                      {card.audioStatus === 'idle' && (
                        <button
                          type="button"
                          onClick={() =>
                            void generateLessonAudioForTopic(
                              topic,
                              card.result!,
                              activeWord || word.trim(),
                              level,
                              false
                            )
                          }
                          className="w-full min-h-[42px] px-4 rounded-xl bg-gradient-to-r from-app-primary to-app-cta-end hover:brightness-110 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-sm cursor-pointer transition-all"
                        >
                          <Volume2 className="w-4 h-4" />
                          <span>Écouter la correction audio</span>
                        </button>
                      )}

                      {/* Quiet Action Footer */}
                      <div className="flex items-center justify-between gap-2 pt-1.5">
                        {topics.length > 1 ? (
                          <button
                            type="button"
                            onClick={handleShowAllTopics}
                            className="text-xs font-medium text-app-muted hover:text-app-text cursor-pointer transition-colors"
                          >
                            ← Voir les {topics.length} sujets
                          </button>
                        ) : (
                          <span />
                        )}

                        <button
                          type="button"
                          onClick={() => handleRetryTopic(topic.id)}
                          className="px-3 min-h-[34px] rounded-lg bg-app-primary/10 hover:bg-app-primary/18 text-app-primary font-semibold text-xs inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Réessayer ce sujet</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
