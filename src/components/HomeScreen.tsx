import React, { useState } from 'react';
import {
  Play,
  FileText,
  ChevronRight,
  HelpCircle,
  CheckCircle2,
  AlertTriangle,
  X,
  BookOpen,
  Trash2,
  Mic,
} from 'lucide-react';
import { CachedVideoSession, Segment, StarterLesson } from '../types';
import {
  STARTER_LESSONS,
  getAllCachedSessions,
  deleteCachedSession,
} from '../services/storage';
import { extractYouTubeVideoId } from '../services/transcriptParser';

interface HomeScreenProps {
  onStartSession: (
    youtubeUrl: string,
    transcriptText: string,
    title?: string,
    preloadedSegments?: Segment[]
  ) => void;
  onResumeCachedSession: (session: CachedVideoSession) => void;
  onOpenTopicSpeaking: () => void;
  isLoading: boolean;
  loadingMessage: string;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  onStartSession,
  onResumeCachedSession,
  onOpenTopicSpeaking,
  isLoading,
  loadingMessage,
}) => {
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [transcriptText, setTranscriptText] = useState('');
  const [showTranscriptInput, setShowTranscriptInput] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'starter' | 'recent'>('starter');
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [cachedSessions, setCachedSessions] = useState<CachedVideoSession[]>(() =>
    getAllCachedSessions()
  );

  const handleDeleteCachedSession = (videoId: string) => {
    const updated = deleteCachedSession(videoId);
    setCachedSessions(updated);
    if (updated.length === 0) {
      setActiveTab('starter');
    }
  };

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    const videoId = extractYouTubeVideoId(youtubeUrl);
    if (!videoId) {
      setValidationError(
        'Tanpri antre yon lyen YouTube ki valab (e.g. https://www.youtube.com/watch?v=...)'
      );
      return;
    }

    const existing = cachedSessions.find((s) => s.id === videoId);
    if (existing && !transcriptText.trim()) {
      onResumeCachedSession(existing);
      return;
    }

    onStartSession(youtubeUrl.trim(), transcriptText.trim());
  };

  const handleSelectStarter = (lesson: StarterLesson) => {
    setYoutubeUrl(lesson.youtubeUrl);
    setTranscriptText(lesson.transcript);
    setValidationError(null);
    onStartSession(lesson.youtubeUrl, lesson.transcript, lesson.title, lesson.segments);
  };

  const totalPracticedSentences = cachedSessions.reduce(
    (sum, s) => sum + (s.stats?.total || 0),
    0
  );
  const totalCorrectSentences = cachedSessions.reduce(
    (sum, s) => sum + (s.stats?.correct || 0),
    0
  );

  return (
    <div className="w-full max-w-xl lg:max-w-5xl mx-auto px-3 sm:px-4 py-2.5 sm:py-4">
      {/* Compact Glass Studio Frame */}
      <div className="glass-panel rounded-2xl sm:rounded-3xl p-3 sm:p-5 space-y-3 sm:space-y-4">
        {/* Compact Top Intro + Help Row */}
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-base sm:text-xl font-extrabold tracking-tight text-app-text truncate">
              Pratike Angle ak YouTube
            </h1>
            <p className="text-[11px] sm:text-xs text-app-muted truncate">
              Koute chak fraz epi di sa w konprann an Kreyòl.
            </p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {cachedSessions.length > 0 && totalPracticedSentences > 0 && (
              <div className="hidden sm:flex glass-subcard rounded-xl px-2.5 py-1.5 items-center gap-2 text-[11px] tabular-nums">
                <span>
                  <span className="text-app-muted">Kòrèk: </span>
                  <strong className="text-app-gold font-bold">
                    {totalCorrectSentences}/{totalPracticedSentences}
                  </strong>
                </span>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowGuideModal(true)}
              className="inline-flex items-center gap-1 px-2.5 min-h-[36px] sm:min-h-[40px] rounded-xl glass-subcard hover:border-app-primary/50 text-xs font-semibold text-app-text hover:text-app-primary transition-colors shrink-0 cursor-pointer whitespace-nowrap"
              title="Kijan aplikasyon an fonksyone"
            >
              <HelpCircle className="w-3.5 h-3.5 text-app-primary" />
              <span>Èd</span>
            </button>
          </div>
        </div>

        {/* 2-Column Responsive Workspace */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 sm:gap-5 items-start">
          {/* Left Column: Frosted Glass YouTube Link Card */}
          <div className="lg:col-span-5">
            <div className="relative rounded-2xl p-[1px] bg-gradient-to-br from-white/30 via-app-gold/35 to-app-primary/35 overflow-hidden shadow-md">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -top-10 -right-10 w-32 h-32 rounded-full bg-app-gold/25 blur-2xl"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -bottom-10 -left-10 w-28 h-28 rounded-full bg-app-primary/25 blur-2xl"
              />

              <div className="relative rounded-[15px] glass-panel border-0 p-3 sm:p-4 space-y-2.5 sm:space-y-3">
                <form onSubmit={handleStart} className="space-y-2.5 sm:space-y-3">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="yt-url"
                      className="text-xs font-bold text-app-text flex items-center justify-between gap-2"
                    >
                      <span>Lyen Videyo YouTube</span>
                      <button
                        type="button"
                        onClick={() => setShowTranscriptInput(!showTranscriptInput)}
                        className="inline-flex items-center gap-1 text-[11px] sm:text-xs font-semibold text-app-gold hover:text-app-primary transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>{showTranscriptInput ? 'Kache transkripsyon' : '+ Transkripsyon'}</span>
                      </button>
                    </label>

                    <input
                      id="yt-url"
                      type="text"
                      value={youtubeUrl}
                      onChange={(e) => {
                        setYoutubeUrl(e.target.value);
                        if (validationError) setValidationError(null);
                      }}
                      placeholder="https://www.youtube.com/watch?v=..."
                      className="w-full px-3 py-2 text-base glass-subcard rounded-[12px] text-app-text placeholder-app-muted/65 focus:outline-none focus:border-app-primary focus:ring-2 focus:ring-app-primary/25 transition-all"
                      disabled={isLoading}
                    />

                    {validationError && (
                      <p className="text-xs text-app-accent font-medium flex items-center gap-1.5 pt-0.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>{validationError}</span>
                      </p>
                    )}
                  </div>

                  {showTranscriptInput && (
                    <div className="space-y-1.5 p-2.5 glass-subcard rounded-[12px] animate-in fade-in duration-150">
                      <p className="text-[11px] text-app-muted leading-relaxed">
                        <strong className="text-app-text">Sou YouTube:</strong> ... &gt;{' '}
                        <strong className="text-app-text">Show transcript</strong> &gt; kopye epi kole liy yo isit la pou tan egzak.
                      </p>
                      <textarea
                        value={transcriptText}
                        onChange={(e) => setTranscriptText(e.target.value)}
                        placeholder="0:00 Hi everyone, welcome to this lesson...&#10;0:04 Today we are going to learn..."
                        rows={3}
                        className="w-full px-3 py-2 text-base font-mono glass-subcard rounded-xl text-app-text placeholder-app-muted/60 focus:outline-none focus:border-app-primary"
                        disabled={isLoading}
                      />
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isLoading || !youtubeUrl.trim()}
                    className="w-full h-10 sm:h-11 rounded-[12px] sm:rounded-[14px] bg-gradient-to-r from-app-primary to-app-cta-end hover:brightness-110 disabled:opacity-45 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-md shadow-app-primary/30 active:scale-[0.99] transition-all cursor-pointer"
                  >
                    {isLoading ? (
                      <div className="flex items-center gap-2 text-xs">
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span className="truncate">{loadingMessage || 'Ap prepare leson an...'}</span>
                      </div>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5 fill-white" />
                        <span>Kòmanse Pratike</span>
                      </>
                    )}
                  </button>
                </form>
              </div>
            </div>

            {/* Topic Speaking Section Card */}
            <button
              type="button"
              onClick={onOpenTopicSpeaking}
              disabled={isLoading}
              className="mt-3 w-full text-left px-3.5 py-3 rounded-2xl glass-subcard hover:border-app-primary/60 hover:bg-app-primary/10 transition-all flex items-center justify-between gap-3 group active:scale-[0.99] cursor-pointer"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-app-primary to-app-cta-end text-white flex items-center justify-center shrink-0 shadow-sm shadow-app-primary/30">
                  <Mic className="w-5 h-5" />
                </span>
                <div className="min-w-0">
                  <div className="text-xs sm:text-sm font-extrabold text-app-text group-hover:text-app-primary transition-colors truncate">
                    Topic Speaking
                  </div>
                  <p className="text-[11px] text-app-muted truncate">
                    3 sujets par mot · Niveaux A1–C2 · Correction orale
                  </p>
                </div>
              </div>
              <span className="w-7 h-7 rounded-full bg-app-primary/15 group-hover:bg-app-primary text-app-primary group-hover:text-white flex items-center justify-center shrink-0 transition-colors">
                <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
              </span>
            </button>
          </div>

          {/* Right Column: Tabbed Lessons / Recent Videos */}
          <div className="lg:col-span-7 space-y-2">
            {cachedSessions.length > 0 ? (
              <div className="grid grid-cols-2 gap-1 p-1 rounded-xl glass-subcard">
                <button
                  type="button"
                  onClick={() => setActiveTab('starter')}
                  className={`min-h-[36px] rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                    activeTab === 'starter'
                      ? 'bg-app-primary text-white shadow-sm shadow-app-primary/30'
                      : 'text-app-muted hover:text-app-text'
                  }`}
                >
                  Leson ki pare ({STARTER_LESSONS.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('recent')}
                  className={`min-h-[36px] rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                    activeTab === 'recent'
                      ? 'bg-app-primary text-white shadow-sm shadow-app-primary/30'
                      : 'text-app-muted hover:text-app-text'
                  }`}
                >
                  Videyo resan ({cachedSessions.length})
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between px-0.5">
                <h2 className="text-xs font-bold tracking-wide text-app-text flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5 text-app-gold" />
                  <span>Leson ki pare</span>
                </h2>
                <span className="text-[11px] text-app-muted">1 klik pou kòmanse</span>
              </div>
            )}

            {/* Starter Lessons List */}
            {(activeTab === 'starter' || cachedSessions.length === 0) && (
              <div className="space-y-1.5 sm:space-y-2">
                {STARTER_LESSONS.map((lesson) => (
                  <button
                    key={lesson.id}
                    onClick={() => handleSelectStarter(lesson)}
                    disabled={isLoading}
                    className="w-full text-left px-3 py-2 sm:px-3.5 sm:py-2.5 min-h-[48px] rounded-xl sm:rounded-2xl glass-subcard hover:border-app-gold/55 hover:bg-app-primary/10 transition-all flex items-center justify-between gap-2.5 group active:scale-[0.99] cursor-pointer"
                  >
                    <div className="min-w-0">
                      <div className="text-[10px] font-semibold text-app-gold leading-tight">
                        {lesson.category}
                      </div>
                      <h3 className="text-xs sm:text-sm font-bold text-app-text group-hover:text-app-primary transition-colors truncate mt-0.5">
                        {lesson.title}
                      </h3>
                    </div>
                    <span className="w-7 h-7 rounded-full bg-app-primary/15 group-hover:bg-app-primary text-app-gold group-hover:text-white flex items-center justify-center shrink-0 transition-colors">
                      <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Recent Cached Videos List */}
            {activeTab === 'recent' && cachedSessions.length > 0 && (
              <div className="space-y-1.5 sm:space-y-2">
                {cachedSessions.slice(0, 5).map((session) => (
                  <div
                    key={session.id}
                    className="w-full rounded-xl sm:rounded-2xl glass-subcard hover:border-app-gold/55 transition-all flex items-center gap-1"
                  >
                    <button
                      type="button"
                      onClick={() => onResumeCachedSession(session)}
                      disabled={isLoading}
                      className="flex-1 min-w-0 text-left px-3 py-2 sm:px-3.5 sm:py-2.5 min-h-[48px] flex items-center justify-between gap-2.5 group cursor-pointer"
                    >
                      <div className="min-w-0">
                        <div className="text-xs sm:text-sm font-bold text-app-text group-hover:text-app-primary truncate">
                          {session.title || 'YouTube Practice Video'}
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] text-app-muted tabular-nums">
                          <span className="capitalize">{session.mode} mode</span>
                          {session.stats && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-[#22C55E] font-semibold">
                                {session.stats.correct}/{session.stats.total} kòrèk
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      <span className="w-7 h-7 rounded-full bg-app-primary/15 group-hover:bg-app-primary text-app-gold group-hover:text-white flex items-center justify-center shrink-0 transition-colors">
                        <ChevronRight className="w-3.5 h-3.5" />
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDeleteCachedSession(session.id)}
                      disabled={isLoading}
                      aria-label={`Siprime ${session.title || 'videyo sa a'}`}
                      title="Siprime videyo sa a"
                      className="mr-2 w-9 h-9 rounded-xl hover:bg-app-accent/15 text-app-muted hover:text-app-accent flex items-center justify-center shrink-0 transition-colors cursor-pointer disabled:opacity-45"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* How It Works Modal */}
      {showGuideModal && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center glass-backdrop p-3"
          onClick={() => setShowGuideModal(false)}
        >
          <div
            className="w-full max-w-sm glass-modal rounded-3xl p-5 space-y-3 animate-in fade-in slide-in-from-bottom-3 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2.5 border-b border-app-border">
              <div className="flex items-center gap-2 font-bold text-sm text-app-text">
                <CheckCircle2 className="w-4 h-4 text-app-gold" />
                <span>Kijan li fonksyone</span>
              </div>
              <button
                onClick={() => setShowGuideModal(false)}
                className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-xl hover:bg-app-inner text-app-muted hover:text-app-text cursor-pointer"
                aria-label="Fèmen"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <ol className="list-decimal list-inside space-y-2 text-xs text-app-muted leading-relaxed">
              <li>
                Videyo a jwe <strong className="text-app-text">yon sèl fraz</strong> alafwa epi li kanpe otomatikman.
              </li>
              <li>
                Tèks angle a kache pandan l ap jwe pou zòrèy ou abitye tande byen.
              </li>
              <li>
                Peze mikwo a epi di sa w konprann nan an <strong className="text-app-text">Kreyòl Ayisyen</strong>.
              </li>
              <li>
                AI a verifye tradiksyon w lan epi li ba w konsèy ak bon fraz la.
              </li>
            </ol>
            <button
              onClick={() => setShowGuideModal(false)}
              className="w-full min-h-[44px] rounded-[14px] bg-app-primary hover:bg-app-primary-hover text-white text-xs font-bold cursor-pointer"
            >
              Konprann
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
