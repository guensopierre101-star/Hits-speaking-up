import React, { useState } from 'react';
import { SlidersHorizontal, Scissors, RotateCcw, X, Check } from 'lucide-react';
import { Segment } from '../types';

interface SyncControlsProps {
  globalOffset: number;
  onUpdateGlobalOffset: (newOffset: number) => void;
  currentSegment: Segment;
  onUpdateSegmentCut: (cutStart?: number, cutEnd?: number) => void;
  onReplay: () => void;
  disabled?: boolean;
}

export const SyncControls: React.FC<SyncControlsProps> = ({
  globalOffset,
  onUpdateGlobalOffset,
  currentSegment,
  onUpdateSegmentCut,
  onReplay,
  disabled = false,
}) => {
  const [showCutModal, setShowCutModal] = useState(false);
  const [showSyncBar, setShowSyncBar] = useState(false);

  const curCutStart = currentSegment.cutOffsetStart || 0;
  const curCutEnd = currentSegment.cutOffsetEnd || 0;

  const handleAdjustStart = (delta: number) => {
    const updated = Number((curCutStart + delta).toFixed(1));
    onUpdateSegmentCut(updated, undefined);
    setTimeout(onReplay, 100);
  };

  const handleAdjustEnd = (delta: number) => {
    const updated = Number((curCutEnd + delta).toFixed(1));
    onUpdateSegmentCut(undefined, updated);
    setTimeout(onReplay, 100);
  };

  const handleResetCut = () => {
    onUpdateSegmentCut(0, 0);
    setTimeout(onReplay, 100);
  };

  return (
    <>
      {/* Top Sync & Cut Bar (Always accessible during session) */}
      <div className="w-full flex items-center justify-between gap-2 py-0.5 text-xs">
        <button
          onClick={() => setShowSyncBar(!showSyncBar)}
          className={`flex items-center gap-1.5 px-3 min-h-[40px] rounded-[14px] border font-medium transition-all cursor-pointer ${
            showSyncBar || Math.abs(globalOffset) > 0.1
              ? 'bg-app-primary/15 border-app-primary/60 text-app-gold'
              : 'glass-subcard text-app-muted hover:text-app-text hover:border-app-primary/40'
          }`}
          title="Adjust global video pause timing"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          <span>Sync {globalOffset !== 0 ? `(${globalOffset > 0 ? '+' : ''}${globalOffset}s)` : ''}</span>
        </button>

        <button
          onClick={() => setShowCutModal(true)}
          disabled={disabled}
          className={`flex items-center gap-1.5 px-3 min-h-[40px] rounded-[14px] border font-medium transition-all cursor-pointer disabled:opacity-50 ${
            curCutStart !== 0 || curCutEnd !== 0
              ? 'bg-app-gold/15 border-app-gold/55 text-app-gold'
              : 'glass-subcard text-app-muted hover:text-app-text hover:border-app-primary/40'
          }`}
          title="Adjust where this specific sentence starts or ends"
        >
          <Scissors className="w-3.5 h-3.5" />
          <span>Wrong cut</span>
        </button>
      </div>

      {/* Global Sync Slider / Quick Adjust Drawer */}
      {showSyncBar && (
        <div className="w-full p-3 glass-panel rounded-2xl animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-app-text">
              Global Pause Shift: <span className="text-app-gold tabular-nums">{globalOffset > 0 ? `+${globalOffset}` : globalOffset}s</span>
            </span>
            <span className="text-[11px] text-app-muted">Shifts all sentence pauses</span>
          </div>

          <div className="grid grid-cols-4 gap-1.5">
            {[-2.0, -0.5, 0.5, 2.0].map((shift) => (
              <button
                key={shift}
                onClick={() => onUpdateGlobalOffset(Number((globalOffset + shift).toFixed(1)))}
                className="min-h-[40px] px-2 text-xs font-semibold rounded-[14px] glass-subcard hover:border-app-primary/50 text-app-text active:scale-95 transition-all text-center cursor-pointer tabular-nums"
              >
                {shift > 0 ? `+${shift}s` : `${shift}s`}
              </button>
            ))}
          </div>

          {globalOffset !== 0 && (
            <button
              onClick={() => onUpdateGlobalOffset(0)}
              className="mt-2 w-full min-h-[36px] text-xs font-medium text-app-gold hover:text-app-primary text-center cursor-pointer"
            >
              Reset to 0s
            </button>
          )}
        </div>
      )}

      {/* "Wrong cut" Modal */}
      {showCutModal && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center glass-backdrop p-3"
          onClick={() => setShowCutModal(false)}
        >
          <div
            className="w-full max-w-sm glass-modal rounded-3xl p-4 animate-in fade-in slide-in-from-bottom-3 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-app-border">
              <div className="flex items-center gap-2">
                <Scissors className="w-4 h-4 text-app-gold" />
                <h3 className="text-sm font-bold text-app-text">Adjust Sentence Cut</h3>
              </div>
              <button
                onClick={() => setShowCutModal(false)}
                className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-xl hover:bg-app-inner text-app-muted hover:text-app-text cursor-pointer"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-app-muted mt-2.5 mb-3 leading-relaxed">
              If the video cut off too early or included extra words from another sentence, adjust start or end and it will replay immediately.
            </p>

            {/* Start time adjuster */}
            <div className="space-y-2 mb-3 p-3 rounded-[14px] glass-subcard">
              <div className="flex justify-between text-xs">
                <span className="text-app-muted font-medium">Sentence Start:</span>
                <span className="font-mono font-semibold text-app-gold tabular-nums">
                  {currentSegment.start + curCutStart > 0
                    ? `${(currentSegment.start + curCutStart).toFixed(1)}s (${curCutStart >= 0 ? '+' : ''}${curCutStart}s)`
                    : '0s'}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {[-1.0, -0.5, 0.5, 1.0].map((delta) => (
                  <button
                    key={`start_${delta}`}
                    onClick={() => handleAdjustStart(delta)}
                    className="min-h-[38px] text-xs font-semibold rounded-[12px] glass-subcard hover:border-app-primary/50 text-app-text active:scale-95 cursor-pointer tabular-nums"
                  >
                    {delta > 0 ? `+${delta}s` : `${delta}s`}
                  </button>
                ))}
              </div>
            </div>

            {/* End time adjuster */}
            <div className="space-y-2 mb-4 p-3 rounded-[14px] glass-subcard">
              <div className="flex justify-between text-xs">
                <span className="text-app-muted font-medium">Sentence End / Pause:</span>
                <span className="font-mono font-semibold text-app-gold tabular-nums">
                  {(currentSegment.end + curCutEnd).toFixed(1)}s ({curCutEnd >= 0 ? '+' : ''}{curCutEnd}s)
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {[-1.0, -0.5, 0.5, 1.0].map((delta) => (
                  <button
                    key={`end_${delta}`}
                    onClick={() => handleAdjustEnd(delta)}
                    className="min-h-[38px] text-xs font-semibold rounded-[12px] glass-subcard hover:border-app-primary/50 text-app-text active:scale-95 cursor-pointer tabular-nums"
                  >
                    {delta > 0 ? `+${delta}s` : `${delta}s`}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              {(curCutStart !== 0 || curCutEnd !== 0) && (
                <button
                  onClick={handleResetCut}
                  className="flex-1 min-h-[44px] px-3 text-xs font-semibold rounded-[14px] glass-subcard hover:border-app-primary/50 text-app-text flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset Cut</span>
                </button>
              )}
              <button
                onClick={() => {
                  setShowCutModal(false);
                  onReplay();
                }}
                className="flex-1 min-h-[44px] px-3 text-xs font-bold rounded-[14px] bg-gradient-to-r from-app-primary to-app-cta-end hover:brightness-110 text-white flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Save & Replay</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
