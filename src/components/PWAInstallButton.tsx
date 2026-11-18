import React, { useState } from 'react';
import { Download, X, Share } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        onClick={install}
        className="flex items-center gap-1.5 px-3 min-h-[40px] rounded-[12px] bg-app-primary hover:bg-app-primary-hover text-white text-xs font-bold shadow-sm shadow-app-primary/25 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        title="Enstale HITS SpeakUp sou aparèy ou an"
      >
        <Download className="w-3.5 h-3.5" />
        <span>Enstale App</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          onClick={() => setShowIOSGuide(true)}
          className="flex items-center gap-1.5 px-3 min-h-[40px] rounded-[12px] glass-subcard hover:border-app-primary/50 text-app-text text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          title="Kijan pou enstale sou iPhone oswa iPad"
        >
          <Download className="w-3.5 h-3.5 text-app-primary" />
          <span>Enstale</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center glass-backdrop p-4">
            <div className="w-full max-w-sm glass-modal rounded-3xl p-5 space-y-3">
              <div className="flex items-center justify-between pb-2.5 border-b border-app-border">
                <div className="flex items-center gap-2.5">
                  <span className="h-8 px-1.5 rounded-[10px] bg-white/95 flex items-center justify-center shrink-0">
                    <img
                      src="/hits-logo.png"
                      alt="HITS SpeakUp"
                      className="h-6 w-auto object-contain shrink-0"
                    />
                  </span>
                  <h3 className="text-sm font-bold text-app-text">Enstale HITS SpeakUp</h3>
                </div>
                <button
                  onClick={() => setShowIOSGuide(false)}
                  className="p-2 rounded-[14px] hover:bg-app-inner text-app-muted hover:text-app-text cursor-pointer"
                  aria-label="Fèmen"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <ol className="text-xs text-app-muted space-y-2 leading-relaxed list-decimal list-inside">
                <li>
                  Tape bouton <strong className="text-app-text inline-flex items-center gap-1"><Share className="w-3 h-3 text-app-primary" /> Share</strong> anba ekran Safari a.
                </li>
                <li>
                  Desann epi chwazi <strong className="text-app-text">Add to Home Screen</strong>.
                </li>
                <li>
                  Tape <strong className="text-app-text">Add</strong> — logo HITS la ap parèt sou ekran telefòn ou an!
                </li>
              </ol>
              <button
                onClick={() => setShowIOSGuide(false)}
                className="w-full min-h-[44px] rounded-[14px] bg-app-primary hover:bg-app-primary-hover text-white text-xs font-bold cursor-pointer"
              >
                Konprann
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
