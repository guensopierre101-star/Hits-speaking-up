import React from 'react';
import {
  Trophy,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RotateCcw,
  PlusCircle,
  BookOpen,
  Volume2,
  ChevronRight,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import { CachedVideoSession, EvaluationResult, Segment, VocabItem } from '../types';

interface SummaryScreenProps {
  session: CachedVideoSession;
  answers: Record<string, EvaluationResult>;
  onPracticeMissed: (missedSegments: Segment[]) => void;
  onRestartFull: () => void;
  onNewVideo: () => void;
}

export const SummaryScreen: React.FC<SummaryScreenProps> = ({
  session,
  answers,
  onPracticeMissed,
  onRestartFull,
  onNewVideo,
}) => {
  const segments = session.segments;

  let correctCount = 0;
  let partialCount = 0;
  let missedCount = 0;

  const missedSegments: Segment[] = [];
  const missedVocabMap = new Map<string, string>();

  segments.forEach((seg) => {
    const ans = answers[seg.id];
    if (ans && ans.verdict === 'correct') {
      correctCount++;
    } else if (ans && ans.verdict === 'partial') {
      partialCount++;
      missedSegments.push(seg);
      seg.vocab.forEach((v) => missedVocabMap.set(v.w, v.kr));
    } else {
      missedCount++;
      missedSegments.push(seg);
      seg.vocab.forEach((v) => missedVocabMap.set(v.w, v.kr));
    }
  });

  const total = segments.length;
  const scorePercent = Math.round(((correctCount + partialCount * 0.5) / Math.max(1, total)) * 100);

  return (
    <div className="w-full max-w-xl lg:max-w-5xl mx-auto px-4 py-4 sm:py-6 pb-safe">
      <div className="glass-panel rounded-3xl p-4 sm:p-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left Column: Trophy Score & Actions */}
          <div className="lg:col-span-5 text-center space-y-3.5 glass-subcard rounded-2xl p-5">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-app-primary/25 to-app-gold/25 border border-app-gold/40 flex items-center justify-center text-app-gold mx-auto">
              <Trophy className="w-8 h-8" />
            </div>
            <div className="space-y-1">
              <h1 className="text-xl sm:text-2xl font-bold text-app-text text-balance">Sesyon an fini!</h1>
              <p className="text-xs text-app-muted max-w-xs mx-auto truncate">
                {session.title || 'Practice Lesson'}
              </p>
            </div>

            {/* Score Metric */}
            <div className="pt-1">
              <div className="inline-block text-4xl font-extrabold text-app-gold tabular-nums">
                {scorePercent}%
              </div>
              <div className="text-[11px] text-app-muted font-medium">Rezilta global</div>
            </div>

            {/* 3 Stats: Correct / Almost / Missed */}
            <div className="grid grid-cols-3 gap-2 pt-3 border-t border-app-border">
              <div className="p-2.5 rounded-[14px] bg-[#22C55E]/12 border border-[#22C55E]/30 text-center">
                <div className="text-base font-bold text-[#22C55E] tabular-nums">{correctCount}</div>
                <div className="text-[11px] text-[#22C55E] font-semibold">Kòrèk</div>
              </div>
              <div className="p-2.5 rounded-[14px] bg-[#F59E0B]/12 border border-[#F59E0B]/30 text-center">
                <div className="text-base font-bold text-[#F59E0B] tabular-nums">{partialCount}</div>
                <div className="text-[11px] text-[#F59E0B] font-semibold">Prèske</div>
              </div>
              <div className="p-2.5 rounded-[14px] bg-app-accent/12 border border-app-accent/30 text-center">
                <div className="text-base font-bold text-app-accent tabular-nums">{missedCount}</div>
                <div className="text-[11px] text-app-accent font-semibold">Rate</div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="space-y-2 pt-2">
              {missedSegments.length > 0 && (
                <button
                  onClick={() => onPracticeMissed(missedSegments)}
                  className="w-full h-12 rounded-[14px] bg-gradient-to-r from-app-primary to-app-cta-end hover:brightness-110 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-md shadow-app-primary/30 active:scale-[0.98] transition-all cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Pratike fraz ou te rate yo ({missedSegments.length})</span>
                </button>
              )}

              <div className="flex gap-2">
                <button
                  onClick={onRestartFull}
                  className="flex-1 min-h-[44px] rounded-[14px] glass-subcard hover:border-app-primary/50 text-app-text font-semibold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-app-gold" />
                  <span>Rekòmanse tout</span>
                </button>
                <button
                  onClick={onNewVideo}
                  className="flex-1 min-h-[44px] rounded-[14px] glass-subcard hover:border-app-primary/50 text-app-gold font-semibold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>Chwazi lòt videyo</span>
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: Vocabulary & Sentences Review */}
          <div className="lg:col-span-7 space-y-5">
            {missedVocabMap.size > 0 && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between px-1">
                  <h2 className="text-xs font-bold tracking-wide text-app-text flex items-center gap-1.5">
                    <BookOpen className="w-3.5 h-3.5 text-app-gold" />
                    <span>Mo pou w kenbe</span>
                  </h2>
                  <span className="text-[11px] text-app-muted font-medium tabular-nums">{missedVocabMap.size} mo</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {Array.from(missedVocabMap.entries()).map(([w, kr], idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-[14px] glass-subcard flex items-center justify-between gap-2"
                    >
                      <div>
                        <div className="text-sm font-semibold text-app-text">{w}</div>
                        <div className="text-xs text-app-gold font-medium">{kr}</div>
                      </div>
                      <Sparkles className="w-4 h-4 text-app-gold/50 shrink-0" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Sentences Review List */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between px-1">
                <h2 className="text-xs font-bold tracking-wide text-app-text">
                  Lis tout fraz yo
                </h2>
                <span className="text-[11px] font-semibold text-app-gold">Revizyon konplè</span>
              </div>

              <div className="space-y-2.5">
                {segments.map((seg) => {
                  const ans = answers[seg.id];
                  const verdict = ans?.verdict || 'wrong';

                  return (
                    <div
                      key={seg.id}
                      className="p-3.5 rounded-2xl glass-subcard space-y-2 text-xs"
                    >
                      <div className="flex items-center justify-between pb-1.5 border-b border-app-border">
                        <span className="text-app-muted font-mono text-[11px] tabular-nums">
                          {seg.start}s - {seg.end}s
                        </span>
                        <div>
                          {verdict === 'correct' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#22C55E]/15 text-[#22C55E] text-[11px] font-bold">
                              <CheckCircle2 className="w-3 h-3" />
                              <span>Kòrèk</span>
                            </span>
                          )}
                          {verdict === 'partial' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#F59E0B]/15 text-[#F59E0B] text-[11px] font-bold">
                              <AlertTriangle className="w-3 h-3" />
                              <span>Prèske</span>
                            </span>
                          )}
                          {verdict === 'wrong' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-app-accent/15 text-app-accent text-[11px] font-bold">
                              <XCircle className="w-3 h-3" />
                              <span>Rate</span>
                            </span>
                          )}
                          {verdict === 'unclear' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-app-primary/15 text-app-gold text-[11px] font-bold">
                              <span>Pa klè</span>
                            </span>
                          )}
                        </div>
                      </div>

                      <div>
                        <div className="text-app-text font-semibold text-sm">"{seg.en}"</div>
                        <div className="text-app-gold font-medium mt-0.5">"{seg.kr}"</div>
                      </div>

                      {ans?.heard && (
                        <div className="text-[11px] text-app-muted glass-subcard p-2.5 rounded-xl">
                          <span className="font-semibold">Sa w te di: </span>
                          <span className="text-app-text italic">"{ans.heard}"</span>
                        </div>
                      )}

                      {ans?.feedback && (
                        <div className="text-[11px] text-app-text leading-relaxed">
                          <span className="text-app-gold font-semibold">Konsèy: </span>
                          {ans.feedback}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
