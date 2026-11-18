import React, { useEffect, useState } from 'react';
import { Clock, LogOut, ShieldAlert, AlertCircle, Smartphone, Copy, Check } from 'lucide-react';
import { GoogleAuthProvider, signInWithPopup, signInWithRedirect } from 'firebase/auth';
import {
  auth,
  formatFriendlyAuthError,
  isInAppBrowser,
  signOutUser,
} from '../services/firebase';

const AuthBackdropWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="relative min-h-[100dvh] text-app-text flex flex-col items-center justify-center p-4 overflow-hidden selection:bg-app-primary/25">
    <div
      className="fixed inset-0 -z-10 overflow-hidden bg-app-bg pointer-events-none"
      aria-hidden="true"
    >
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
    <div className="w-full max-w-md">{children}</div>
  </div>
);

const HitsBrandLogo: React.FC = () => (
  <div className="inline-flex items-center justify-center px-3.5 py-2.5 rounded-2xl bg-white/95 border border-app-border shadow-sm">
    <img
      src="/hits-logo.png"
      alt="HITS SpeakUp"
      className="h-14 sm:h-16 w-auto object-contain"
    />
  </div>
);

export const AuthLoadingScreen: React.FC = () => (
  <AuthBackdropWrapper>
    <div className="glass-panel rounded-3xl p-6 sm:p-8 flex flex-col items-center text-center space-y-4">
      <HitsBrandLogo />
      <div className="space-y-2 flex flex-col items-center">
        <h1 className="text-xl font-extrabold tracking-tight text-app-text">HITS SpeakUp</h1>
        <div className="w-6 h-6 border-2 border-app-primary border-t-transparent rounded-full animate-spin" />
      </div>
    </div>
  </AuthBackdropWrapper>
);

interface SignInScreenProps {
  initialError?: string | null;
}

export const SignInScreen: React.FC<SignInScreenProps> = ({ initialError = null }) => {
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(initialError);
  const [copiedLink, setCopiedLink] = useState(false);

  const inAppBrowser = isInAppBrowser();

  useEffect(() => {
    if (initialError) {
      setErrorMsg(initialError);
    }
  }, [initialError]);

  const handleCopyLink = async () => {
    if (typeof window === 'undefined') return;
    const url = window.location.href;
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        copied = true;
      }
    } catch {
      copied = false;
    }

    if (!copied) {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = url;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        copied = document.execCommand('copy');
        document.body.removeChild(textarea);
      } catch {
        copied = false;
      }
    }

    if (copied) {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    }
  };

  const handleGoogleSignIn = async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const popupPromise = signInWithPopup(auth, provider);

    setErrorMsg(null);
    setIsSigningIn(true);

    try {
      await popupPromise;
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setErrorMsg(null);
      } else if (
        code === 'auth/popup-blocked' ||
        code === 'auth/operation-not-supported-in-this-environment'
      ) {
        try {
          await signInWithRedirect(auth, provider);
          return;
        } catch (redirectErr: unknown) {
          setErrorMsg(formatFriendlyAuthError(redirectErr));
        }
      } else {
        setErrorMsg(formatFriendlyAuthError(err));
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  return (
    <AuthBackdropWrapper>
      <div className="glass-panel rounded-3xl p-6 sm:p-8 flex flex-col items-center text-center space-y-6">
        <div className="flex flex-col items-center space-y-3">
          <HitsBrandLogo />
          <div className="space-y-1">
            <h1 className="text-2xl font-extrabold tracking-tight text-app-text">HITS SpeakUp</h1>
            <p className="text-xs sm:text-sm text-app-muted">
              Sign in with your Google account to access practice sessions.
            </p>
          </div>
        </div>

        {inAppBrowser && (
          <div className="w-full p-3.5 rounded-2xl glass-subcard border-app-primary/35 text-xs text-app-text space-y-2.5 text-left">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-app-primary shrink-0 mt-0.5" />
              <span className="font-semibold leading-relaxed">
                Open this link in Chrome or Safari to sign in with Google
              </span>
            </div>
            <button
              type="button"
              onClick={handleCopyLink}
              className="w-full min-h-[38px] px-3 rounded-xl bg-app-primary/10 hover:bg-app-primary/15 border border-app-primary/30 text-xs font-bold text-app-primary flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              {copiedLink ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Link copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy link</span>
                </>
              )}
            </button>
          </div>
        )}

        {errorMsg && (
          <div className="w-full p-3.5 rounded-2xl glass-subcard border-app-accent/40 text-xs text-app-accent text-left">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{errorMsg}</span>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={isSigningIn}
          className="w-full min-h-[48px] px-4 rounded-[14px] bg-gradient-to-r from-app-primary to-app-cta-end hover:brightness-110 disabled:opacity-55 text-white font-bold text-sm flex items-center justify-center gap-3 shadow-md shadow-app-primary/30 active:scale-[0.99] transition-all cursor-pointer"
        >
          {isSigningIn ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span>Signing in...</span>
            </>
          ) : (
            <>
              <span className="w-6 h-6 rounded-md bg-white flex items-center justify-center shrink-0">
                <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                  />
                </svg>
              </span>
              <span>Continue with Google</span>
            </>
          )}
        </button>
      </div>
    </AuthBackdropWrapper>
  );
};

interface StatusScreenProps {
  email: string;
}

export const PendingApprovalScreen: React.FC<StatusScreenProps> = ({ email }) => {
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOutUser();
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <AuthBackdropWrapper>
      <div className="glass-panel rounded-3xl p-6 sm:p-8 flex flex-col items-center text-center space-y-5">
        <HitsBrandLogo />

        <div className="w-12 h-12 rounded-2xl glass-subcard flex items-center justify-center text-app-primary">
          <Clock className="w-6 h-6" />
        </div>

        <div className="space-y-2">
          <h1 className="text-lg sm:text-xl font-extrabold tracking-tight text-app-text">
            HITS SpeakUp
          </h1>
          <p className="text-sm text-app-text leading-relaxed font-medium">
            Your access request was sent. A member of the school administration must approve it.
          </p>
          <p className="text-xs text-app-muted break-all">{email}</p>
        </div>

        <button
          type="button"
          onClick={handleSignOut}
          disabled={isSigningOut}
          className="w-full min-h-[44px] px-4 rounded-[14px] glass-subcard hover:border-app-primary/50 text-sm font-bold text-app-text hover:text-app-primary flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
        >
          <LogOut className="w-4 h-4" />
          <span>Sign out</span>
        </button>
      </div>
    </AuthBackdropWrapper>
  );
};

export const BlockedAccessScreen: React.FC<StatusScreenProps> = ({ email }) => {
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOutUser();
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <AuthBackdropWrapper>
      <div className="glass-panel rounded-3xl p-6 sm:p-8 flex flex-col items-center text-center space-y-5">
        <HitsBrandLogo />

        <div className="w-12 h-12 rounded-2xl bg-app-accent/15 border border-app-accent/30 flex items-center justify-center text-app-accent">
          <ShieldAlert className="w-6 h-6" />
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-extrabold tracking-tight text-app-accent">Access denied</h1>
          <p className="text-xs text-app-muted break-all">{email}</p>
        </div>

        <button
          type="button"
          onClick={handleSignOut}
          disabled={isSigningOut}
          className="w-full min-h-[44px] px-4 rounded-[14px] glass-subcard hover:border-app-accent/50 text-sm font-bold text-app-text hover:text-app-accent flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
        >
          <LogOut className="w-4 h-4" />
          <span>Sign out</span>
        </button>
      </div>
    </AuthBackdropWrapper>
  );
};

export const DeviceLimitScreen: React.FC<StatusScreenProps> = ({ email }) => {
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOutUser();
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <AuthBackdropWrapper>
      <div className="glass-panel rounded-3xl p-6 sm:p-8 flex flex-col items-center text-center space-y-5">
        <HitsBrandLogo />

        <div className="w-12 h-12 rounded-2xl bg-app-accent/15 border border-app-accent/30 flex items-center justify-center text-app-accent">
          <Smartphone className="w-6 h-6" />
        </div>

        <div className="space-y-2">
          <h1 className="text-lg sm:text-xl font-extrabold tracking-tight text-app-accent">
            Device limit reached. Ask the school administration to reset your devices.
          </h1>
          <p className="text-xs text-app-muted break-all">{email}</p>
        </div>

        <button
          type="button"
          onClick={handleSignOut}
          disabled={isSigningOut}
          className="w-full min-h-[44px] px-4 rounded-[14px] glass-subcard hover:border-app-accent/50 text-sm font-bold text-app-text hover:text-app-accent flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
        >
          <LogOut className="w-4 h-4" />
          <span>Sign out</span>
        </button>
      </div>
    </AuthBackdropWrapper>
  );
};
