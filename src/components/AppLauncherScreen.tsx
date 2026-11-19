import React from 'react';
import { ChevronRight, Mic, Youtube } from 'lucide-react';

interface AppLauncherScreenProps {
  onOpenYouTubeApp: () => void;
  onOpenTopicSpeakingApp: () => void;
}

export const AppLauncherScreen: React.FC<AppLauncherScreenProps> = ({
  onOpenYouTubeApp,
  onOpenTopicSpeakingApp,
}) => {
  return (
    <div className="w-full max-w-md mx-auto px-4 py-8 sm:py-16">
      <div className="flex flex-col gap-3">
        {/* App 1: English translate */}
        <button
          type="button"
          onClick={onOpenYouTubeApp}
          className="w-full text-left glass-panel rounded-2xl px-3.5 py-3 hover:border-app-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-primary active:scale-[0.99] transition-[transform,border-color] duration-150 flex items-center gap-3.5 group cursor-pointer min-h-[64px]"
        >
          <span
            className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#DC2626] to-[#EA580C] text-white flex items-center justify-center shrink-0 shadow-sm shadow-[#DC2626]/25 transition-transform duration-150 group-hover:scale-[1.03]"
            aria-hidden="true"
          >
            <Youtube className="w-5 h-5" />
          </span>

          <span className="flex-1 min-w-0 text-sm sm:text-base font-bold tracking-tight text-app-text group-hover:text-app-primary transition-colors truncate">
            English translate
          </span>

          <ChevronRight
            className="w-4 h-4 text-app-muted group-hover:text-app-primary shrink-0 transition-transform duration-150 group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </button>

        {/* App 2: Topic Speaking */}
        <button
          type="button"
          onClick={onOpenTopicSpeakingApp}
          className="w-full text-left glass-panel rounded-2xl px-3.5 py-3 hover:border-app-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-primary active:scale-[0.99] transition-[transform,border-color] duration-150 flex items-center gap-3.5 group cursor-pointer min-h-[64px]"
        >
          <span
            className="w-11 h-11 rounded-xl bg-gradient-to-br from-app-primary to-app-cta-end text-white flex items-center justify-center shrink-0 shadow-sm shadow-app-primary/25 transition-transform duration-150 group-hover:scale-[1.03]"
            aria-hidden="true"
          >
            <Mic className="w-5 h-5" />
          </span>

          <span className="flex-1 min-w-0 text-sm sm:text-base font-bold tracking-tight text-app-text group-hover:text-app-primary transition-colors truncate">
            Topic Speaking
          </span>

          <ChevronRight
            className="w-4 h-4 text-app-muted group-hover:text-app-primary shrink-0 transition-transform duration-150 group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </button>
      </div>
    </div>
  );
};
