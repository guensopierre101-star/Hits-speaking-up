import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Mic,
  RotateCcw,
  Eye,
  EyeOff,
  HelpCircle,
  Volume2,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Square,
  Sparkles,
  BookOpen,
  Keyboard,
  Send,
  Loader2,
  Play,
} from 'lucide-react';
import { CachedVideoSession, EvaluationResult, Segment, Verdict, VocabItem } from '../types';
import { YouTubePlayer, YouTubePlayerHandle } from './YouTubePlayer';
import { SyncControls } from './SyncControls';
import { convertBlobTo16kHzMonoWav } from '../services/audioUtils';
import { evaluateSpokenAnswer, evaluateTypedAnswer } from '../services/gemini';
import { saveSessionStats, updateGlobalOffset, updateSegmentCut } from '../services/storage';

interface SessionScreenProps {
  session: CachedVideoSession;
  onFinishSession: (session: CachedVideoSession, answers: Record<string, EvaluationResult>) => void;
  onBackToHome: () => void;
  autoModeTotalWindows?: number;
  autoModeReadyWindows?: number;
}

type SessionState = 'playing' | 'prompt' | 'recording' | 'analyzing' | 'result' | 'missed';

export const SessionScreen: React.FC<SessionScreenProps> = ({
  session,
  onFinishSession,
  onBackToHome,
  autoModeTotalWindows,
  autoModeReadyWindows,
}) => {
  const [segments, setSegments] = useState<Segment[]>(session.segments);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [globalOffset, setGlobalOffset] = useState(session.globalOffset || 0);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [state, setState] = useState<SessionState>('playing');

  // Answers tracker: segmentId -> EvaluationResult
  const [answers, setAnswers] = useState<Record<string, EvaluationResult>>({});
  const [currentResult, setCurrentResult] = useState<EvaluationResult | null>(null);

  // Hidden text state
  const [showEnglishText, setShowEnglishText] = useState(false);

  // Audio Recording State
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Microphone Error Modal
  const [micError, setMicError] = useState<string | null>(null);

  // Text-input fallback
  const [isTypingMode, setIsTypingMode] = useState(false);
  const [typedText, setTypedText] = useState('');

  // Evaluating error
  const [evalError, setEvalError] = useState<string | null>(null);

  const playerRef = useRef<YouTubePlayerHandle>(null);

  // Sync incoming segments when background Auto Mode loads more windows
  useEffect(() => {
    setSegments((prev) => {
      const cutMap = new Map(
        prev.map((s) => [s.id, { cutOffsetStart: s.cutOffsetStart, cutOffsetEnd: s.cutOffsetEnd }])
      );
      return session.segments.map((seg) => {
        const localCut = cutMap.get(seg.id);
        return localCut
          ? {
              ...seg,
              cutOffsetStart: seg.cutOffsetStart ?? localCut.cutOffsetStart,
              cutOffsetEnd: seg.cutOffsetEnd ?? localCut.cutOffsetEnd,
            }
          : seg;
      });
    });
  }, [session.segments]);

  const currentSegment = segments[currentIndex];

  // Start current segment playback
  const playCurrentSegment = useCallback(() => {
    if (!currentSegment || !playerRef.current) return;
    setState('playing');
    setShowEnglishText(false);
    setEvalError(null);
    playerRef.current.playSegment(currentSegment, globalOffset);
  }, [currentSegment, globalOffset]);

  const playCurrentSegmentRef = useRef(playCurrentSegment);
  playCurrentSegmentRef.current = playCurrentSegment;

  // When player completes segment (currentTime >= end + 0.15s)
  const handleSegmentComplete = useCallback(() => {
    setState('prompt');
  }, []);

  // Play segment ONLY when current segment index or session changes (never when background windows arrive)
  useEffect(() => {
    if (segments.length > 0 && currentSegment) {
      const t = setTimeout(() => {
        playCurrentSegmentRef.current();
      }, 350);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, session.id]);

  // Cleanup media recording on unmount
  useEffect(() => {
    return () => {
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // Update Global Offset
  const handleUpdateGlobalOffset = (newOffset: number) => {
    setGlobalOffset(newOffset);
    updateGlobalOffset(session.id, newOffset);
  };

  // Update Segment Cut
  const handleUpdateSegmentCut = (cutStart?: number, cutEnd?: number) => {
    const updated = updateSegmentCut(session.id, currentSegment.id, cutStart, cutEnd);
    if (updated) {
      setSegments([...updated]);
    }
  };

  // Replay current segment (unlimited, returns to prompt state when done)
  const handleReplay = () => {
    if (state === 'recording') {
      stopRecordingInternal(false);
    }
    setState('playing');
    setShowEnglishText(false);
    playerRef.current?.playSegment(currentSegment, globalOffset);
  };

  // Show answer (counts as missed)
  const handleShowAnswer = () => {
    const missedResult: EvaluationResult = {
      heard: '',
      verdict: 'wrong',
      feedback: 'Ou te chwazi gade repons lan. Pratike li ankò nan fen sesyon an!',
      better: currentSegment.kr,
      timestamp: Date.now(),
    };

    setAnswers((prev) => ({
      ...prev,
      [currentSegment.id]: missedResult,
    }));
    setCurrentResult(missedResult);
    setState('missed');
  };

  // Toggle Playback Speed (0.75x / 1.0x)
  const toggleSpeed = () => {
    const nextSpeed = playbackSpeed === 1.0 ? 0.75 : 1.0;
    setPlaybackSpeed(nextSpeed);
    playerRef.current?.setSpeed(nextSpeed);
  };

  // Start Voice Recording
  const startRecording = async () => {
    setMicError(null);
    setEvalError(null);

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function' ||
      typeof MediaRecorder === 'undefined'
    ) {
      setMicError('Mikwofòn pa sipòte sou navigatè sa a. Ou ka tape repons ou an pito.');
      return;
    }

    let acquiredStream: MediaStream | null = null;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: true,
        },
      });
      acquiredStream = stream;
      streamRef.current = stream;

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, {
          type: mediaRecorder.mimeType || 'audio/webm',
        });
        audioChunksRef.current = [];

        // Clean up stream tracks
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;

        await processRecordedAudio(audioBlob);
      };

      mediaRecorder.start(200); // 200ms slice
      setState('recording');
      setRecordingSeconds(0);

      // Max 60 seconds countdown
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      recordTimerRef.current = window.setInterval(() => {
        setRecordingSeconds((prev) => {
          if (prev >= 59) {
            stopRecordingInternal(true);
            return 60;
          }
          return prev + 1;
        });
      }, 1000);
    } catch (err: unknown) {
      if (acquiredStream) {
        acquiredStream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }

      const errName = (err as { name?: string })?.name || '';
      const errMessage = ((err as { message?: string })?.message || '').toLowerCase();

      if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
        if (errMessage.includes('dismissed')) {
          setMicError(
            'Ou te fèmen demann mikwofòn nan. Peze "Pale" ankò pou pèmèt mikwo a, oswa tape repons ou an.'
          );
        } else {
          setMicError(
            'Aksè mikwofòn bloke. Tanpri pèmèt mikwo a nan paramèt navigatè w la oswa tape repons ou an pito.'
          );
        }
      } else if (errName === 'NotReadableError' || errName === 'TrackStartError') {
        console.warn('Microphone busy or unreadable:', errName);
        setMicError(
          'Yon lòt aplikasyon ap itilize mikwofòn nan kounye a. Fèmen li epi eseye ankò, oswa tape repons ou an.'
        );
      } else {
        console.warn('Microphone unavailable:', errName);
        setMicError('Pa ka jwenn mikwofòn sou aparèy sa a. Ou ka itilize opsyon pou tape repons lan.');
      }
    }
  };

  const stopRecordingInternal = (process: boolean = true) => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      if (!process) {
        recorder.onstop = null;
        recorder.stop();
        return;
      }
      // Small 150ms buffer so the very last syllable/word isn't cut off when tapping Stop
      setState('analyzing');
      setTimeout(() => {
        if (recorder.state !== 'inactive') {
          recorder.stop();
        }
      }, 150);
    }
  };

  const handleStopRecording = () => {
    stopRecordingInternal(true);
  };

  // Convert to 16 kHz WAV and send to Gemini
  const processRecordedAudio = async (blob: Blob) => {
    setState('analyzing');
    setEvalError(null);

    try {
      const { base64, isSilent } = await convertBlobTo16kHzMonoWav(blob);

      if (isSilent || !base64) {
        const silentResult: EvaluationResult = {
          heard: '',
          verdict: 'unclear',
          feedback: 'Mwen pa t twò tande vwa w la — eseye pale yon ti jan pi pre mikwo a pou m ka koute w byen!',
          better: currentSegment.kr,
          timestamp: Date.now(),
        };
        setCurrentResult(silentResult);
        setState('result');
        return;
      }

      const result = await evaluateSpokenAnswer(base64, currentSegment.en, currentSegment.kr);

      setAnswers((prev) => ({
        ...prev,
        [currentSegment.id]: result,
      }));
      setCurrentResult(result);
      setState('result');
    } catch (err: unknown) {
      console.error('Evaluation failed:', err);
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Echèk nan evalyasyon vokal la. Tanpri eseye pale ankò oswa tape repons ou an.';
      setEvalError(message);
      setState('prompt');
    }
  };

  // Submit typed answer fallback
  const handleTypedSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!typedText.trim()) return;

    setState('analyzing');
    setEvalError(null);

    try {
      const result = await evaluateTypedAnswer(typedText.trim(), currentSegment.en, currentSegment.kr);
      setAnswers((prev) => ({
        ...prev,
        [currentSegment.id]: result,
      }));
      setCurrentResult(result);
      setTypedText('');
      setIsTypingMode(false);
      setState('result');
    } catch (err: unknown) {
      console.error('Evaluation failed:', err);
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Echèk nan verifye repons lan. Tanpri eseye ankò.';
      setEvalError(message);
      setState('prompt');
    }
  };

  // Next sentence or complete session
  const handleNext = () => {
    if (currentIndex + 1 < segments.length) {
      setCurrentIndex((prev) => prev + 1);
      setCurrentResult(null);
      setShowEnglishText(false);
      setEvalError(null);
      setState('playing');
    } else {
      // Completed all sentences
      const correctCount = Object.values(answers).filter((a) => a.verdict === 'correct').length;
      const partialCount = Object.values(answers).filter((a) => a.verdict === 'partial').length;
      const missedCount = segments.length - correctCount - partialCount;

      const finalStats = {
        correct: correctCount,
        partial: partialCount,
        missed: Math.max(0, missedCount),
        total: segments.length,
      };

      saveSessionStats(session.id, finalStats);
      onFinishSession(session, answers);
    }
  };

  // Progress percentage
  const progressPercent = Math.round(((currentIndex + (state === 'result' || state === 'missed' ? 1 : 0.5)) / segments.length) * 100);

  return (
    <div className="w-full max-w-xl lg:max-w-5xl mx-auto px-3 sm:px-4 py-3 sm:py-5 pb-safe">
      <div className="glass-panel rounded-3xl p-3.5 sm:p-5 space-y-3.5">
        {/* Compact Session Info Row (no sentence fraction counter) */}
        <div className="flex items-center justify-between gap-2 px-0.5">
          <span className="text-xs sm:text-sm font-bold text-app-text truncate min-w-0">
            {session.title || 'Translate & Speak'}
          </span>

          {/* Speed Toggle */}
          <button
            onClick={toggleSpeed}
            className="px-3 min-h-[36px] text-xs font-mono font-bold rounded-xl glass-subcard text-app-gold hover:border-app-primary/50 transition-colors cursor-pointer tabular-nums shrink-0"
            title="Toggle playback speed"
          >
            {playbackSpeed}x
          </button>
        </div>

        {/* Glowing Amber Progress Bar */}
        <div className="w-full bg-app-border h-1.5 rounded-full overflow-hidden">
          <div
            className="bg-gradient-to-r from-app-primary to-app-cta-end h-full transition-all duration-300 rounded-full"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Auto-mode notice / Background window progress */}
        {session.mode === 'auto' && (
          <div className="flex items-center justify-between px-3 py-1.5 rounded-xl bg-app-gold/12 border border-app-gold/30 text-[11px] text-app-gold">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>Auto mode: itilize <strong>Sync</strong> si tan an dekale.</span>
            </div>
            {autoModeTotalWindows && autoModeReadyWindows !== undefined && autoModeReadyWindows < autoModeTotalWindows && (
              <span className="font-semibold tabular-nums">
                {autoModeReadyWindows}/{autoModeTotalWindows}
              </span>
            )}
          </div>
        )}

        {/* Responsive 2-Column Studio Grid on Desktop / Stacked on Mobile */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* Left Column: Video + Sync Controls */}
          <div className="lg:col-span-7 space-y-2.5">
            <YouTubePlayer
              ref={playerRef}
              videoId={session.id}
              playbackSpeed={playbackSpeed}
              onSegmentComplete={handleSegmentComplete}
              isPlayingSegment={state === 'playing'}
            />

            <SyncControls
              globalOffset={globalOffset}
              onUpdateGlobalOffset={handleUpdateGlobalOffset}
              currentSegment={currentSegment}
              onUpdateSegmentCut={handleUpdateSegmentCut}
              onReplay={handleReplay}
              disabled={state === 'recording' || state === 'analyzing'}
            />
          </div>

          {/* Right Column: Main Dynamic Interactive Glass Panel */}
          <div className="lg:col-span-5 glass-subcard rounded-2xl p-4 space-y-3">
            {/* STATE: PLAYING */}
            {state === 'playing' && (
              <div className="py-5 flex flex-col items-center justify-center text-center space-y-3 animate-in fade-in duration-150">
                <button
                  onClick={handleReplay}
                  className="w-16 h-16 rounded-full bg-gradient-to-br from-app-primary to-app-cta-end hover:brightness-110 text-white flex items-center justify-center shadow-lg shadow-app-primary/35 active:scale-95 transition-all cursor-pointer"
                  title="Tape pou jwe"
                >
                  <Play className="w-7 h-7 fill-white ml-0.5" />
                </button>
                <div>
                  <h2 className="text-sm font-bold text-app-text">Koute avèk atansyon...</h2>
                  <p className="text-[11px] text-app-muted mt-0.5">
                    Si videyo a pa jwe otomatikman, tape bouton anlè a.
                  </p>
                </div>
              </div>
            )}

            {/* STATE: PROMPT (Your turn: say it in Creole) */}
            {state === 'prompt' && (
              <div className="space-y-3 animate-in fade-in duration-200">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <span className="text-[11px] font-bold text-app-gold">
                      Tou pa w
                    </span>
                    <h2 className="text-base font-bold text-app-text leading-tight">
                      Di sa w tande a an Kreyòl
                    </h2>
                  </div>
                  <button
                    onClick={() => setShowEnglishText(!showEnglishText)}
                    className="inline-flex items-center gap-1 px-2.5 min-h-[38px] rounded-xl glass-subcard hover:border-app-primary/50 text-[11px] font-semibold text-app-muted hover:text-app-text transition-colors shrink-0 cursor-pointer whitespace-nowrap"
                  >
                    {showEnglishText ? (
                      <>
                        <EyeOff className="w-3.5 h-3.5 text-app-gold" />
                        <span>Kache tèks</span>
                      </>
                    ) : (
                      <>
                        <Eye className="w-3.5 h-3.5 text-app-gold" />
                        <span>Wè tèks</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Hidden English Text Panel */}
                {showEnglishText && (
                  <div className="p-3 rounded-[14px] glass-subcard text-center animate-in fade-in duration-150">
                    <div className="text-xs font-semibold text-app-text">
                      "{currentSegment.en}"
                    </div>
                  </div>
                )}

                {/* Error Message if previous evaluation failed */}
                {evalError && (
                  <div className="p-2.5 rounded-[14px] bg-app-accent/15 border border-app-accent/35 text-xs text-app-accent font-medium flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-app-accent shrink-0 mt-0.5" />
                    <span>{evalError}</span>
                  </div>
                )}

                {/* Microphone Button Area */}
                {!isTypingMode ? (
                  <div className="flex flex-col items-center justify-center py-2.5 space-y-2">
                    <button
                      onClick={startRecording}
                      className="relative group w-20 h-20 rounded-full bg-gradient-to-br from-app-primary to-app-cta-end hover:brightness-110 text-white flex flex-col items-center justify-center shadow-xl shadow-app-primary/35 active:scale-95 transition-all cursor-pointer"
                      title="Tape pou anrejistre repons ou an Kreyòl"
                    >
                      <Mic className="w-7 h-7" />
                      <span className="text-[10px] font-bold uppercase tracking-tight mt-0.5">Pale</span>
                    </button>
                    <span className="text-[11px] text-app-muted font-medium">
                      Peze pou reponn an Kreyòl
                    </span>
                  </div>
                ) : (
                  /* Fallback Typing Input */
                  <form onSubmit={handleTypedSubmit} className="space-y-2 pt-1">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={typedText}
                        onChange={(e) => setTypedText(e.target.value)}
                        placeholder="Ekri sa ou tande a an Kreyòl..."
                        className="flex-1 px-3.5 py-2.5 text-base glass-subcard rounded-[14px] text-app-text placeholder-app-muted/70 focus:outline-none focus:border-app-primary focus:ring-2 focus:ring-app-primary/25"
                        autoFocus
                      />
                      <button
                        type="submit"
                        disabled={!typedText.trim()}
                        className="px-4 min-h-[44px] rounded-[14px] bg-gradient-to-r from-app-primary to-app-cta-end hover:brightness-110 disabled:opacity-45 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>Voye</span>
                      </button>
                    </div>
                  </form>
                )}

                {/* Bottom Row Actions: Replay, Typing Toggle, Show Answer */}
                <div className="flex items-center justify-between pt-2.5 border-t border-app-border text-xs">
                  <button
                    onClick={handleReplay}
                    className="flex items-center gap-1.5 min-h-[40px] px-2.5 rounded-xl hover:bg-app-inner text-app-text font-medium transition-colors cursor-pointer"
                    title="Replay this sentence"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-app-gold" />
                    <span>Rekoute</span>
                  </button>

                  <button
                    onClick={() => setIsTypingMode(!isTypingMode)}
                    className="flex items-center gap-1.5 min-h-[40px] px-2.5 rounded-xl hover:bg-app-inner text-app-muted hover:text-app-text font-medium transition-colors cursor-pointer"
                  >
                    <Keyboard className="w-3.5 h-3.5" />
                    <span>{isTypingMode ? 'Sèvi ak vwa' : 'Ekri'}</span>
                  </button>

                  <button
                    onClick={handleShowAnswer}
                    className="flex items-center gap-1.5 min-h-[40px] px-2.5 rounded-xl hover:bg-app-inner text-app-gold font-semibold transition-colors cursor-pointer"
                    title="Show answer (marks sentence as missed)"
                  >
                    <HelpCircle className="w-3.5 h-3.5" />
                    <span>Repons</span>
                  </button>
                </div>
              </div>
            )}

            {/* STATE: RECORDING */}
            {state === 'recording' && (
              <div className="py-5 flex flex-col items-center justify-center text-center space-y-3.5 animate-in fade-in duration-150">
                <div className="text-center space-y-1.5">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-app-accent/15 border border-app-accent/35 text-app-accent text-xs font-bold">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-app-accent opacity-75" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-app-accent" />
                    </span>
                    <span>Anrejistreman an kou</span>
                  </div>
                  <p className="text-xs text-app-muted">
                    Pale an Kreyòl. Pa enkyete w pou ezitasyon oswa repete mo.
                  </p>
                </div>

                {/* Recording Stop Button with Red Pulse Animation */}
                <div className="relative my-1.5">
                  <button
                    onClick={handleStopRecording}
                    className="w-24 h-24 rounded-full bg-app-accent hover:bg-app-accent-hover text-white flex flex-col items-center justify-center shadow-xl shadow-app-accent/35 animate-pulse-ring cursor-pointer"
                    title="Tap to stop and evaluate"
                  >
                    <Square className="w-8 h-8 fill-white" />
                    <span className="text-[11px] font-bold uppercase mt-1">Fini</span>
                  </button>
                </div>

                {/* Timer countdown (Max 60s) */}
                <div className="text-sm font-mono font-semibold text-app-text tabular-nums">
                  {recordingSeconds}s / 60s
                </div>

                <button
                  onClick={() => stopRecordingInternal(false)}
                  className="min-h-[40px] px-3 text-xs font-medium text-app-muted hover:text-app-text underline cursor-pointer"
                >
                  Anile anrejistreman
                </button>
              </div>
            )}

            {/* STATE: ANALYZING */}
            {state === 'analyzing' && (
              <div className="py-8 flex flex-col items-center justify-center text-center space-y-3 animate-in fade-in duration-200">
                <Loader2 className="w-10 h-10 text-app-gold animate-spin" />
                <div>
                  <h2 className="text-base font-bold text-app-text">Gemini ap koute repons ou an...</h2>
                  <p className="text-xs text-app-muted mt-1">
                    Analiz tradiksyon Kreyòl la an kou.
                  </p>
                </div>
              </div>
            )}

            {/* STATE: RESULT */}
            {state === 'result' && currentResult && (
              <div className="space-y-3.5 animate-in fade-in duration-200">
                {/* Verdict */}
                <div className="flex items-center justify-between pb-2.5 border-b border-app-border">
                  <div className="flex items-center gap-2">
                    {currentResult.verdict === 'correct' && (
                      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-[#22C55E]/15 border border-[#22C55E]/35 text-[#22C55E] text-xs font-bold">
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Kòrèk</span>
                      </div>
                    )}
                    {currentResult.verdict === 'partial' && (
                      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-[#F59E0B]/15 border border-[#F59E0B]/35 text-[#F59E0B] text-xs font-bold">
                        <AlertTriangle className="w-4 h-4" />
                        <span>Prèske bon</span>
                      </div>
                    )}
                    {currentResult.verdict === 'wrong' && (
                      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-app-accent/15 border border-app-accent/35 text-app-accent text-xs font-bold">
                        <XCircle className="w-4 h-4" />
                        <span>Pa egzat</span>
                      </div>
                    )}
                    {currentResult.verdict === 'unclear' && (
                      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-app-primary/15 border border-app-primary/35 text-app-gold text-xs font-bold">
                        <AlertCircle className="w-4 h-4" />
                        <span>Pa klè</span>
                      </div>
                    )}
                  </div>

                  {/* "Not what I said" button */}
                  {currentResult.verdict !== 'unclear' && (
                    <button
                      onClick={() => setState('prompt')}
                      className="text-xs font-medium text-app-gold hover:text-app-primary underline cursor-pointer"
                      title="Re-record if AI transcribed incorrectly"
                    >
                      Not what I said?
                    </button>
                  )}
                </div>

                {/* What user said */}
                {currentResult.heard && (
                  <div className="text-xs space-y-1">
                    <span className="text-app-muted font-medium">Sa w te di:</span>
                    <p className="p-2.5 rounded-[14px] glass-subcard text-app-text italic">
                      "{currentResult.heard}"
                    </p>
                  </div>
                )}

                {/* Kind Creole Feedback */}
                <div className="text-xs space-y-1">
                  <span className="text-app-gold font-semibold flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Konsèy:</span>
                  </span>
                  <p className="p-2.5 rounded-[14px] glass-subcard border-app-primary/30 text-app-text leading-relaxed">
                    {currentResult.feedback}
                  </p>
                </div>

                {/* Best Creole Translation */}
                <div className="text-xs space-y-1">
                  <span className="text-app-muted font-medium">Pi bon fason pou di l:</span>
                  <p className="p-2.5 rounded-[14px] glass-subcard border-[#22C55E]/35 text-[#22C55E] font-semibold">
                    "{currentResult.better}"
                  </p>
                </div>

                {/* English Original Sentence */}
                <div className="text-xs space-y-1">
                  <span className="text-app-muted font-medium">Fraz angle orijinal la:</span>
                  <p className="p-2.5 rounded-[14px] glass-subcard text-app-text">
                    "{currentSegment.en}"
                  </p>
                </div>

                {/* Useful Vocab Items */}
                {currentSegment.vocab && currentSegment.vocab.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <span className="text-[11px] font-bold text-app-muted flex items-center gap-1">
                      <BookOpen className="w-3.5 h-3.5 text-app-gold" />
                      <span>Vokabilè itil</span>
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {currentSegment.vocab.map((v, i) => (
                        <div
                          key={i}
                          className="p-2.5 rounded-[14px] glass-subcard text-xs flex justify-between gap-2"
                        >
                          <span className="font-semibold text-app-text">{v.w}</span>
                          <span className="text-app-gold font-medium">{v.kr}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Actions: Next Sentence or Re-record if Unclear */}
                <div className="pt-1">
                  {currentResult.verdict === 'unclear' ? (
                    <button
                      onClick={() => setState('prompt')}
                      className="w-full h-12 rounded-[14px] bg-gradient-to-r from-app-primary to-app-cta-end hover:brightness-110 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-md shadow-app-primary/30 cursor-pointer"
                    >
                      <RotateCcw className="w-4 h-4" />
                      <span>Eseye ankò</span>
                    </button>
                  ) : (
                    <button
                      onClick={handleNext}
                      className="w-full h-12 rounded-[14px] bg-gradient-to-r from-app-primary to-app-cta-end hover:brightness-110 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-md shadow-app-primary/30 active:scale-[0.98] transition-all cursor-pointer"
                    >
                      <span>
                        {currentIndex + 1 < segments.length ? 'Kontinye' : 'Wè rezilta final la'}
                      </span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* STATE: MISSED (Show Answer clicked) */}
            {state === 'missed' && (
              <div className="space-y-3.5 animate-in fade-in duration-200">
                <div className="p-3 rounded-[14px] bg-app-gold/15 border border-app-gold/35 text-xs font-medium text-app-gold">
                  Ou te chwazi wè repons lan. Fraz sa a konte kòm rate pou ou ka revize li nan fen an.
                </div>

                <div className="text-xs space-y-1">
                  <span className="text-app-muted font-medium">Fraz angle a:</span>
                  <p className="p-3 rounded-[14px] glass-subcard text-app-text font-semibold text-sm">
                    "{currentSegment.en}"
                  </p>
                </div>

                <div className="text-xs space-y-1">
                  <span className="text-app-gold font-semibold">Tradiksyon Kreyòl:</span>
                  <p className="p-3 rounded-[14px] glass-subcard border-app-gold/35 text-app-gold font-semibold text-sm">
                    "{currentSegment.kr}"
                  </p>
                </div>

                {/* Useful Vocab */}
                {currentSegment.vocab && currentSegment.vocab.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <span className="text-[11px] font-bold text-app-muted">
                      Mo kle:
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {currentSegment.vocab.map((v, i) => (
                        <div
                          key={i}
                          className="p-2.5 rounded-[14px] glass-subcard text-xs flex justify-between gap-2"
                        >
                          <span className="font-semibold text-app-text">{v.w}</span>
                          <span className="text-app-gold font-medium">{v.kr}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <button
                    onClick={handleReplay}
                    className="flex-1 min-h-[44px] rounded-[14px] glass-subcard hover:border-app-primary/50 text-app-text font-semibold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-app-gold" />
                    <span>Rekoute</span>
                  </button>
                  <button
                    onClick={handleNext}
                    className="flex-1 min-h-[44px] rounded-[14px] bg-gradient-to-r from-app-primary to-app-cta-end hover:brightness-110 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                  >
                    <span>
                      {currentIndex + 1 < segments.length ? 'Kontinye' : 'Rezilta final'}
                    </span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Microphone Permission Modal */}
      {micError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center glass-backdrop p-4">
          <div className="w-full max-w-sm glass-modal rounded-3xl p-5 space-y-3">
            <div className="w-11 h-11 rounded-full bg-app-accent/15 border border-app-accent/35 text-app-accent flex items-center justify-center mx-auto">
              <Mic className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-app-text text-center">Aksè Mikwofòn</h3>
            <p className="text-xs text-app-muted text-center leading-relaxed">
              {micError}
            </p>
            <div className="space-y-2 pt-2">
              <button
                onClick={() => {
                  setMicError(null);
                  setIsTypingMode(true);
                }}
                className="w-full min-h-[44px] rounded-[14px] bg-gradient-to-r from-app-primary to-app-cta-end hover:brightness-110 text-white font-bold text-xs cursor-pointer"
              >
                Tape repons ou an pito
              </button>
              <button
                onClick={() => setMicError(null)}
                className="w-full min-h-[44px] rounded-[14px] glass-subcard hover:border-app-primary/50 text-app-text font-medium text-xs cursor-pointer"
              >
                Fèmen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
