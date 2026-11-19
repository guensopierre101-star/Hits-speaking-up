import React, { useState, useRef, useEffect, Suspense } from 'react';
import { AppLauncherScreen } from './components/AppLauncherScreen';
import { HomeScreen } from './components/HomeScreen';
import { SessionScreen } from './components/SessionScreen';
import { SummaryScreen } from './components/SummaryScreen';
import {
  AuthLoadingScreen,
  BlockedAccessScreen,
  DeviceLimitScreen,
  PendingApprovalScreen,
  SignInScreen,
} from './components/AuthGateScreens';

const LazyAdminScreen = React.lazy(() =>
  import('./components/AdminScreen').then((mod) => ({ default: mod.AdminScreen }))
);
import { TopicSpeakingScreen } from './components/TopicSpeakingScreen';
import { CachedVideoSession, EvaluationResult, Segment } from './types';
import { extractYouTubeVideoId, parsePastedTranscript } from './services/transcriptParser';
import { analyzeVideoWindow, groupAndTranslateTranscript } from './services/gemini';
import { getCachedSession, saveSession } from './services/storage';
import { AlertCircle, ChevronDown, LogOut, Settings, Shield, User, X } from 'lucide-react';
import { PWAInstallButton } from './components/PWAInstallButton';
import { ThemeSettingsModal } from './components/ThemeSettingsModal';
import { applyTheme, getSavedTheme, ThemeId } from './services/theme';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import {
  AppUserProfile,
  auth,
  ensureAndSubscribeUserProfile,
  finishRedirectSignInOnce,
  getOrCreateBrowserDeviceId,
  isHardcodedAdminEmail,
  MAX_STUDENT_DEVICES,
  signOutUser,
  syncStudentDevice,
} from './services/firebase';

type Screen = 'home' | 'youtube-home' | 'session' | 'summary' | 'admin' | 'topic-speaking';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>('home');
  const [currentSession, setCurrentSession] = useState<CachedVideoSession | null>(null);
  const [sessionAnswers, setSessionAnswers] = useState<Record<string, EvaluationResult>>({});

  // Loading state during video preparation
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');

  // Auto-mode background window preparation state
  const [autoModeTotalWindows, setAutoModeTotalWindows] = useState<number>(0);
  const [autoModeReadyWindows, setAutoModeReadyWindows] = useState<number>(0);
  const analysisRunIdRef = useRef<number>(0);

  // Global Error Toast / Modal
  const [appError, setAppError] = useState<string | null>(null);

  // Classic interface theme settings
  const [currentTheme, setCurrentTheme] = useState<ThemeId>(() => getSavedTheme());
  const [showThemeSettings, setShowThemeSettings] = useState(false);

  // Firebase Auth & Access Control state
  const [authReady, setAuthReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [userProfile, setUserProfile] = useState<AppUserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [authAccessError, setAuthAccessError] = useState<string | null>(null);
  const [redirectAuthError, setRedirectAuthError] = useState<string | null>(null);
  const [deviceCheckStatus, setDeviceCheckStatus] = useState<
    'idle' | 'checking' | 'allowed' | 'limit-reached'
  >('idle');
  const syncedDeviceSessionRef = useRef<string | null>(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    finishRedirectSignInOnce().then((err) => {
      if (active && err) {
        setRedirectAuthError(err);
      }
    });

    let unsubscribeProfile: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }

      syncedDeviceSessionRef.current = null;
      setDeviceCheckStatus('idle');
      setFirebaseUser(user);
      setUserProfile(null);
      setAuthAccessError(null);
      setCurrentScreen('home');
      setShowUserMenu(false);
      setAuthReady(true);

      if (!user) {
        setProfileLoading(false);
        return;
      }

      setProfileLoading(true);
      unsubscribeProfile = ensureAndSubscribeUserProfile(
        user,
        (profile) => {
          setUserProfile(profile);
          setProfileLoading(false);
        },
        (err) => {
          setAuthAccessError(err.message);
          setProfileLoading(false);
        }
      );
    });

    return () => {
      active = false;
      unsubscribeAuth();
      if (unsubscribeProfile) {
        unsubscribeProfile();
      }
    };
  }, []);

  useEffect(() => {
    if (!showUserMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowUserMenu(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showUserMenu]);

  const handleSelectTheme = (themeId: ThemeId) => {
    setCurrentTheme(themeId);
    applyTheme(themeId);
  };

  const handleSignOut = async () => {
    setShowUserMenu(false);
    setCurrentScreen('home');
    await signOutUser();
  };

  /**
   * Start a new practice session:
   * Evaluates Mode A (Transcript Pasted) vs Mode B (Auto Window Analysis)
   */
  const handleStartSession = async (
    youtubeUrl: string,
    transcriptText: string,
    providedTitle?: string,
    preloadedSegments?: Segment[]
  ) => {
    setAppError(null);
    analysisRunIdRef.current += 1;
    const runId = analysisRunIdRef.current;

    const videoId = extractYouTubeVideoId(youtubeUrl);
    if (!videoId) {
      setAppError('Lyen YouTube sa a pa valab (Invalid YouTube URL).');
      return;
    }

    // Verified starter lesson with preloaded segments matching real video audio
    if (preloadedSegments && preloadedSegments.length > 0) {
      const starterSession: CachedVideoSession = {
        id: videoId,
        title: providedTitle || 'English Practice Lesson',
        youtubeUrl,
        mode: 'transcript',
        segments: preloadedSegments,
        globalOffset: 0,
        createdAt: Date.now(),
        lastPracticedAt: Date.now(),
      };
      saveSession(starterSession);
      setCurrentSession(starterSession);
      setSessionAnswers({});
      setCurrentScreen('session');
      return;
    }

    // Check localStorage cache first
    const cached = getCachedSession(videoId);
    if (cached && !transcriptText.trim()) {
      handleResumeCachedSession(cached);
      return;
    }

    setIsLoading(true);

    // MODE A: PASTED TRANSCRIPT (Most accurate)
    if (transcriptText.trim().length > 0) {
      try {
        setLoadingMessage('Ap prepare transkripsyon an... (Parsing transcript)');
        const lines = parsePastedTranscript(transcriptText);

        if (lines.length === 0) {
          throw new Error('Transkripsyon an pa gen okenn liy ak tan valab (No valid timestamps found).');
        }

        setLoadingMessage('Gemini ap analize ak tradui fraz yo... (Translating segments)');
        const { title, segments } = await groupAndTranslateTranscript(lines, providedTitle);

        if (segments.length === 0) {
          throw new Error('Pa gen okenn fraz ki te ka prepare nan transkripsyon sa a.');
        }

        const newSession: CachedVideoSession = {
          id: videoId,
          title: title || providedTitle || 'English Practice Video',
          youtubeUrl,
          mode: 'transcript',
          segments,
          globalOffset: 0,
          createdAt: Date.now(),
          lastPracticedAt: Date.now(),
        };

        saveSession(newSession);
        setCurrentSession(newSession);
        setSessionAnswers({});
        setCurrentScreen('session');
      } catch (err: unknown) {
        console.error('Mode A preparation error:', err);
        setAppError(
          err instanceof Error
            ? err.message
            : 'Echèk nan prepare transkripsyon an. Tanpri verifye lyen an oswa tèks la.'
        );
      } finally {
        setIsLoading(false);
        setLoadingMessage('');
      }
      return;
    }

    // MODE B: AUTO (When no transcript is pasted)
    try {
      setLoadingMessage('Ap prepare premye minit videyo a... (Analyzing window 1)');
      const windowSize = 60;
      const totalEstimatedWindows = 4; // Analyze up to ~3.5 minutes
      setAutoModeTotalWindows(totalEstimatedWindows);
      setAutoModeReadyWindows(0);

      // 1. Analyze Window 1 immediately (0s to 60s)
      const window1Segments = await analyzeVideoWindow(videoId, 0, windowSize);
      if (analysisRunIdRef.current !== runId) return;

      if (window1Segments.length === 0) {
        throw new Error(
          'Gemini pa t jwenn okenn fraz angle ki pale nan premye minit videyo a. Konsèy: pou 100% presizyon, kopye transkripsyon videyo a sou YouTube epi kole l isit la.'
        );
      }

      setAutoModeReadyWindows(1);

      const newSession: CachedVideoSession = {
        id: videoId,
        title: providedTitle || 'YouTube English Practice (Auto)',
        youtubeUrl,
        mode: 'auto',
        segments: window1Segments,
        globalOffset: 0,
        createdAt: Date.now(),
        lastPracticedAt: Date.now(),
      };

      saveSession(newSession);
      setCurrentSession(newSession);
      setSessionAnswers({});
      setCurrentScreen('session');
      setIsLoading(false);

      // 2. Background analysis of subsequent windows (55-115s, 110-170s, 165-225s)
      startBackgroundWindowAnalysis(videoId, window1Segments, totalEstimatedWindows, runId);
    } catch (err: unknown) {
      console.error('Mode B preparation error:', err);
      setIsLoading(false);
      setLoadingMessage('');
      setAppError(
        err instanceof Error && err.message
          ? err.message
          : 'Echèk mòd otomatik la pou videyo sa a. Pi bon fason ki garanti 100% siksè: louvri videyo a sou YouTube > Show transcript > kopye tout liy yo epi kole yo isit la!'
      );
    }
  };

  /**
   * Background window fetcher for Auto Mode
   */
  const startBackgroundWindowAnalysis = async (
    videoId: string,
    initialSegments: Segment[],
    totalWindows: number,
    runId: number
  ) => {
    const accumulatedSegments = [...initialSegments];
    const windowSize = 60;
    const overlap = 5;

    for (let w = 1; w < totalWindows; w++) {
      if (analysisRunIdRef.current !== runId) return;

      const startOffset = w * (windowSize - overlap);
      try {
        const nextSegments = await analyzeVideoWindow(videoId, startOffset, windowSize);
        if (analysisRunIdRef.current !== runId) return;

        // Deduplicate overlap and merge
        for (const seg of nextSegments) {
          const isDuplicate = accumulatedSegments.some(
            (existing) =>
              Math.abs(existing.start - seg.start) < 2.0 ||
              existing.en.toLowerCase().trim() === seg.en.toLowerCase().trim()
          );
          if (!isDuplicate) {
            accumulatedSegments.push(seg);
          }
        }

        // Sort by start
        accumulatedSegments.sort((a, b) => a.start - b.start);
        const snapshot = [...accumulatedSegments];

        setAutoModeReadyWindows(w + 1);

        // Update in state & storage
        setCurrentSession((prev) => {
          if (!prev || prev.id !== videoId) return prev;
          const updated = { ...prev, segments: snapshot };
          saveSession(updated);
          return updated;
        });
      } catch (err) {
        console.warn(`[Auto Mode] Window ${w + 1} analysis ended or failed:`, err);
        break;
      }
    }
  };

  const handleResumeCachedSession = (session: CachedVideoSession) => {
    setCurrentSession(session);
    setSessionAnswers({});
    setCurrentScreen('session');
  };

  const handleFinishSession = (
    session: CachedVideoSession,
    answers: Record<string, EvaluationResult>
  ) => {
    setCurrentSession(session);
    setSessionAnswers(answers);
    setCurrentScreen('summary');
  };

  const handlePracticeMissed = (missedSegments: Segment[]) => {
    if (!currentSession) return;
    const missedSession: CachedVideoSession = {
      ...currentSession,
      segments: missedSegments,
    };
    setCurrentSession(missedSession);
    setSessionAnswers({});
    setCurrentScreen('session');
  };

  const handleRestartFull = () => {
    if (!currentSession) return;
    // Reload full session from storage
    const full = getCachedSession(currentSession.id) || currentSession;
    setCurrentSession(full);
    setSessionAnswers({});
    setCurrentScreen('session');
  };

  const handleNewVideo = () => {
    analysisRunIdRef.current += 1;
    setCurrentSession(null);
    setSessionAnswers({});
    setCurrentScreen('youtube-home');
  };

  const userEmail = (firebaseUser?.email || '').toLowerCase();
  const activeProfile =
    userProfile && userProfile.email.toLowerCase() === userEmail ? userProfile : null;
  const isPrimaryAdmin = Boolean(userEmail) && isHardcodedAdminEmail(userEmail);
  const effectiveStatus = isPrimaryAdmin ? 'approved' : (activeProfile?.status ?? 'pending');
  const isAdmin =
    Boolean(firebaseUser) &&
    (isPrimaryAdmin || (activeProfile?.role === 'admin' && effectiveStatus === 'approved'));

  useEffect(() => {
    if (!isAdmin && currentScreen === 'admin') {
      setCurrentScreen('home');
    }
  }, [isAdmin, currentScreen]);

  useEffect(() => {
    if (!firebaseUser || effectiveStatus !== 'approved') {
      setDeviceCheckStatus('idle');
      return;
    }

    if (isAdmin) {
      setDeviceCheckStatus('allowed');
      return;
    }

    if (!activeProfile) {
      return;
    }

    const browserDeviceId = getOrCreateBrowserDeviceId();
    const devices = activeProfile.devices ?? [];
    const isRegistered = devices.some((d) => d.deviceId === browserDeviceId);
    const sessionKey = `${userEmail}:${browserDeviceId}`;

    if (!isRegistered && devices.length >= MAX_STUDENT_DEVICES) {
      syncedDeviceSessionRef.current = null;
      setDeviceCheckStatus('limit-reached');
      return;
    }

    if (isRegistered && syncedDeviceSessionRef.current === sessionKey) {
      setDeviceCheckStatus('allowed');
      return;
    }

    if (syncedDeviceSessionRef.current === sessionKey) {
      return;
    }

    let cancelled = false;
    syncedDeviceSessionRef.current = sessionKey;
    setDeviceCheckStatus(isRegistered ? 'allowed' : 'checking');

    syncStudentDevice(userEmail)
      .then((outcome) => {
        if (cancelled) return;
        setDeviceCheckStatus(outcome === 'limit-reached' ? 'limit-reached' : 'allowed');
      })
      .catch((err) => {
        if (cancelled) return;
        syncedDeviceSessionRef.current = null;
        setAuthAccessError(err instanceof Error ? err.message : 'Device verification failed.');
      });

    return () => {
      cancelled = true;
    };
  }, [firebaseUser, userEmail, activeProfile, effectiveStatus, isAdmin]);

  // Strict Access Gate: nobody sees any part of the app until signed in AND approved
  if (!authReady || (firebaseUser && profileLoading && !activeProfile)) {
    return <AuthLoadingScreen />;
  }

  if (!firebaseUser) {
    return <SignInScreen initialError={redirectAuthError} />;
  }

  if (authAccessError && !isPrimaryAdmin) {
    return <BlockedAccessScreen email={userEmail} />;
  }

  if (effectiveStatus === 'blocked') {
    return <BlockedAccessScreen email={userEmail} />;
  }

  if (effectiveStatus !== 'approved') {
    return <PendingApprovalScreen email={userEmail} />;
  }

  if (!isAdmin) {
    if (deviceCheckStatus === 'limit-reached') {
      return <DeviceLimitScreen email={userEmail} />;
    }
    if (deviceCheckStatus !== 'allowed') {
      return <AuthLoadingScreen />;
    }
  }

  return (
    <div className="relative h-[100dvh] text-app-text flex flex-col overflow-hidden selection:bg-app-primary/25">
      {/* Atmospheric Studio Bokeh Backdrop (gives glass panels rich warm refraction) */}
      <div className="fixed inset-0 -z-10 overflow-hidden bg-app-bg pointer-events-none" aria-hidden="true">
        <div
          className="absolute -top-24 -left-20 w-[380px] h-[380px] sm:w-[540px] sm:h-[540px] rounded-full blur-[95px]"
          style={{ background: 'radial-gradient(circle, var(--theme-glow-1) 0%, transparent 70%)' }}
        />
        <div
          className="absolute top-1/4 -right-24 w-[360px] h-[360px] sm:w-[520px] sm:h-[520px] rounded-full blur-[100px]"
          style={{ background: 'radial-gradient(circle, var(--theme-glow-2) 0%, transparent 70%)' }}
        />
        <div
          className="absolute -bottom-28 left-1/3 w-[340px] h-[340px] sm:w-[480px] sm:h-[480px] rounded-full blur-[110px]"
          style={{ background: 'radial-gradient(circle, var(--theme-glow-3) 0%, transparent 70%)' }}
        />
      </div>

      {/* Permanently Fixed Top Bar — Logo + HITS SpeakUp always visible on first view & scroll */}
      <header className="shrink-0 z-40 bg-app-shell backdrop-blur-2xl pt-safe">
        <div className="max-w-xl lg:max-w-5xl mx-auto px-3 sm:px-4 h-12 flex items-center justify-between gap-2">
          <button
            onClick={() => setCurrentScreen('home')}
            className="flex items-center gap-2 text-left cursor-pointer min-h-[40px] shrink-0 group"
          >
            <span className="h-7 px-1.5 rounded-[9px] bg-white/95 border border-white/60 shadow-xs flex items-center justify-center shrink-0">
              <img
                src="/hits-logo.png"
                alt="HITS SpeakUp"
                className="h-5 w-auto object-contain shrink-0"
              />
            </span>
            <span className="text-[15px] sm:text-base font-extrabold tracking-tight text-app-text group-hover:text-app-primary transition-colors whitespace-nowrap">
              HITS SpeakUp
            </span>
          </button>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {currentScreen === 'home' ? (
              <PWAInstallButton />
            ) : (
              <button
                onClick={() =>
                  setCurrentScreen(
                    currentScreen === 'session' || currentScreen === 'summary'
                      ? 'youtube-home'
                      : 'home'
                  )
                }
                className="text-xs font-semibold text-app-text hover:text-app-primary px-2.5 sm:px-3 min-h-[36px] sm:min-h-[40px] rounded-[12px] glass-subcard hover:border-app-primary/50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {currentScreen === 'session' || currentScreen === 'summary'
                  ? 'Chanje videyo'
                  : '‹ Accueil'}
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowThemeSettings(true)}
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-[12px] glass-subcard text-app-muted hover:text-app-primary hover:border-app-primary/50 flex items-center justify-center transition-colors cursor-pointer shrink-0"
              aria-label="Paramèt koulè entèfas"
              title="Koulè entèfas"
            >
              <Settings className="w-4 h-4" />
            </button>

            {/* Header Account Menu (visible only to approved users) */}
            <div className="relative" ref={userMenuRef}>
              <button
                type="button"
                onClick={() => setShowUserMenu((prev) => !prev)}
                className="h-9 sm:h-10 px-2 sm:px-2.5 rounded-[12px] glass-subcard text-app-text hover:text-app-primary hover:border-app-primary/50 flex items-center gap-1 transition-colors cursor-pointer shrink-0"
                aria-label="Account menu"
                aria-expanded={showUserMenu}
              >
                <User className="w-4 h-4" />
                <ChevronDown className="w-3.5 h-3.5 text-app-muted" />
              </button>

              {showUserMenu && (
                <div className="absolute right-0 mt-2 w-56 rounded-2xl glass-modal p-1.5 shadow-xl z-50 space-y-1">
                  <div className="px-2.5 py-2 border-b border-app-border">
                    <div className="text-xs font-bold text-app-text truncate">
                      {activeProfile?.name || firebaseUser.displayName || 'Approved User'}
                    </div>
                    <div className="text-[11px] text-app-muted truncate">{userEmail}</div>
                  </div>

                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowUserMenu(false);
                        setCurrentScreen('admin');
                      }}
                      className={`w-full min-h-[38px] px-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer ${
                        currentScreen === 'admin'
                          ? 'bg-app-primary text-white'
                          : 'text-app-text hover:bg-app-inner hover:text-app-primary'
                      }`}
                    >
                      <Shield className="w-4 h-4 shrink-0" />
                      <span>Admin</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="w-full min-h-[38px] px-2.5 rounded-xl text-xs font-bold text-app-accent hover:bg-app-accent/15 flex items-center gap-2 transition-colors cursor-pointer"
                  >
                    <LogOut className="w-4 h-4 shrink-0" />
                    <span>Sign out</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        <div
          className="w-full h-[1px] bg-gradient-to-r from-transparent via-app-primary/70 to-transparent"
          aria-hidden="true"
        />
      </header>

      {/* Scrollable Main Content Area */}
      <main className="flex-1 overflow-y-auto overscroll-y-contain pb-safe">
        {/* Error notification banner */}
        {appError && (
          <div className="max-w-xl lg:max-w-5xl mx-auto px-4 pt-3">
            <div className="p-3 rounded-2xl glass-panel border-app-accent/40 text-xs text-app-accent flex items-start justify-between gap-2">
              <div className="flex items-start gap-2 pt-0.5">
                <AlertCircle className="w-4 h-4 text-app-accent shrink-0 mt-0.5" />
                <span className="leading-relaxed font-medium">{appError}</span>
              </div>
              <button
                onClick={() => setAppError(null)}
                className="text-app-accent min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-app-accent/15 transition-colors cursor-pointer"
                aria-label="Fèmen erè a"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {currentScreen === 'home' && (
          <AppLauncherScreen
            onOpenYouTubeApp={() => setCurrentScreen('youtube-home')}
            onOpenTopicSpeakingApp={() => setCurrentScreen('topic-speaking')}
          />
        )}

        {currentScreen === 'youtube-home' && (
          <HomeScreen
            onStartSession={handleStartSession}
            onResumeCachedSession={handleResumeCachedSession}
            isLoading={isLoading}
            loadingMessage={loadingMessage}
          />
        )}

        {currentScreen === 'topic-speaking' && (
          <TopicSpeakingScreen onBackToHome={() => setCurrentScreen('home')} />
        )}

        {currentScreen === 'session' && currentSession && (
          <SessionScreen
            session={currentSession}
            onFinishSession={handleFinishSession}
            onBackToHome={() => setCurrentScreen('youtube-home')}
            autoModeTotalWindows={autoModeTotalWindows}
            autoModeReadyWindows={autoModeReadyWindows}
          />
        )}

        {currentScreen === 'summary' && currentSession && (
          <SummaryScreen
            session={currentSession}
            answers={sessionAnswers}
            onPracticeMissed={handlePracticeMissed}
            onRestartFull={handleRestartFull}
            onNewVideo={handleNewVideo}
          />
        )}

        {currentScreen === 'admin' && isAdmin && (
          <Suspense
            fallback={
              <div className="w-full max-w-xl lg:max-w-5xl mx-auto px-3 sm:px-4 py-8 flex justify-center">
                <div className="w-6 h-6 border-2 border-app-primary border-t-transparent rounded-full animate-spin" />
              </div>
            }
          >
            <LazyAdminScreen
              currentUserEmail={userEmail}
              onBack={() => setCurrentScreen('home')}
            />
          </Suspense>
        )}
      </main>

      <ThemeSettingsModal
        isOpen={showThemeSettings}
        currentTheme={currentTheme}
        onSelectTheme={handleSelectTheme}
        onClose={() => setShowThemeSettings(false)}
      />
    </div>
  );
}
