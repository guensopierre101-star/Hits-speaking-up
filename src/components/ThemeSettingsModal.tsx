import React from 'react';
import { Check, Palette, X } from 'lucide-react';
import { APP_THEMES, ThemeId } from '../services/theme';

interface ThemeSettingsModalProps {
  isOpen: boolean;
  currentTheme: ThemeId;
  onSelectTheme: (themeId: ThemeId) => void;
  onClose: () => void;
}

export const ThemeSettingsModal: React.FC<ThemeSettingsModalProps> = ({
  isOpen,
  currentTheme,
  onSelectTheme,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center glass-backdrop p-3"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm glass-modal rounded-3xl p-5 space-y-3.5 animate-in fade-in slide-in-from-bottom-3 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-2.5 border-b border-app-border">
          <div className="flex items-center gap-2">
            <Palette className="w-4 h-4 text-app-primary" />
            <h3 className="text-sm font-bold text-app-text">Paramèt Koulè Entèfas</h3>
          </div>
          <button
            onClick={onClose}
            className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-xl hover:bg-app-inner text-app-muted hover:text-app-text cursor-pointer"
            aria-label="Fèmen"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-app-muted leading-relaxed">
          Chwazi koulè ou pito pou entèfas HITS SpeakUp la.
        </p>

        <div className="space-y-2 max-h-[58vh] overflow-y-auto pr-0.5">
          {APP_THEMES.map((theme) => {
            const isSelected = currentTheme === theme.id;
            return (
              <button
                key={theme.id}
                type="button"
                onClick={() => onSelectTheme(theme.id)}
                className={`w-full text-left p-3 rounded-[14px] border transition-all flex items-center justify-between gap-3 cursor-pointer ${
                  isSelected
                    ? 'bg-app-primary/15 border-app-primary'
                    : 'glass-subcard hover:border-app-primary/50'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="w-10 h-10 rounded-xl border border-white/20 shrink-0 overflow-hidden flex flex-col shadow-xs"
                    style={{ backgroundColor: theme.swatches.bg }}
                  >
                    <div
                      className="h-1.5 w-full"
                      style={{ backgroundColor: theme.swatches.accent }}
                    />
                    <div className="flex-1 flex items-center justify-center p-1">
                      <span
                        className="w-5 h-2.5 rounded-sm"
                        style={{ backgroundColor: theme.swatches.primary }}
                      />
                    </div>
                  </div>

                  <div className="min-w-0">
                    <div className="text-sm font-bold text-app-text truncate">
                      {theme.name}
                    </div>
                    <div className="text-[11px] text-app-muted truncate">
                      {theme.description}
                    </div>
                  </div>
                </div>

                {isSelected && (
                  <div className="w-6 h-6 rounded-full bg-app-primary text-white flex items-center justify-center shrink-0">
                    <Check className="w-3.5 h-3.5" />
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-full min-h-[44px] rounded-[14px] bg-app-primary hover:bg-app-primary-hover text-white text-xs font-bold shadow-md shadow-app-primary/25 cursor-pointer"
        >
          Fèmen
        </button>
      </div>
    </div>
  );
};
