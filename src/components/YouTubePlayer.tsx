import React, { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Segment } from '../types';
import { AlertCircle, Loader2, Play, Volume2 } from 'lucide-react';

declare global {
  interface Window {
    YT: {
      Player: new (
        elementId: string | HTMLElement,
        options: {
          videoId: string;
          playerVars?: Record<string, unknown>;
          events?: {
            onReady?: (event: { target: YTPlayerInstance }) => void;
            onStateChange?: (event: { data: number }) => void;
            onError?: (event: { data: number }) => void;
          };
        }
      ) => YTPlayerInstance;
      PlayerState: {
        PLAYING: number;
        PAUSED: number;
        ENDED: number;
        BUFFERING: number;
        CUED: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

export interface YTPlayerInstance {
  playVideo: () => void;
  pauseVideo: () => void;
  stopVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  setPlaybackRate: (rate: number) => void;
  getPlaybackRate: () => number;
  getPlayerState: () => number;
  destroy: () => void;
}

export interface YouTubePlayerHandle {
  playSegment: (segment: Segment, globalOffset: number) => void;
  replayCurrentSegment: () => void;
  pause: () => void;
  setSpeed: (rate: number) => void;
  getDuration: () => number;
}

interface YouTubePlayerProps {
  videoId: string;
  onSegmentComplete: () => void;
  playbackSpeed: number;
  onPlayerReady?: (duration: number) => void;
  isPlayingSegment: boolean;
}

export const YouTubePlayer = forwardRef<YouTubePlayerHandle, YouTubePlayerProps>(
  ({ videoId, onSegmentComplete, playbackSpeed, onPlayerReady, isPlayingSegment }, ref) => {
    const playerRef = useRef<YTPlayerInstance | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const intervalRef = useRef<number | null>(null);
    const safetyTimeoutRef = useRef<number | null>(null);
    const currentSegmentRef = useRef<{ segment: Segment; globalOffset: number } | null>(null);
    const pendingSegmentRef = useRef<{ segment: Segment; globalOffset: number } | null>(null);

    const [isApiLoaded, setIsApiLoaded] = useState(false);
    const [isPlayerReady, setIsPlayerReady] = useState(false);
    const [isActuallyPlaying, setIsActuallyPlaying] = useState(false);
    const [hasError, setHasError] = useState<string | null>(null);
    const [needsUserTap, setNeedsUserTap] = useState(false);

    const playbackSpeedRef = useRef(playbackSpeed);
    playbackSpeedRef.current = playbackSpeed;

    const onSegmentCompleteRef = useRef(onSegmentComplete);
    onSegmentCompleteRef.current = onSegmentComplete;

    const onPlayerReadyRef = useRef(onPlayerReady);
    onPlayerReadyRef.current = onPlayerReady;

    // Load YouTube IFrame API script once
    useEffect(() => {
      if (window.YT && window.YT.Player) {
        setIsApiLoaded(true);
        return;
      }

      const existingScript = document.getElementById('youtube-iframe-api-script');
      if (!existingScript) {
        const tag = document.createElement('script');
        tag.id = 'youtube-iframe-api-script';
        tag.src = 'https://www.youtube.com/iframe_api';
        const firstScriptTag = document.getElementsByTagName('script')[0];
        firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
      }

      const prevCallback = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (prevCallback) prevCallback();
        setIsApiLoaded(true);
      };
    }, []);

    // Clear polling timers
    const clearTimers = useCallback(() => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (safetyTimeoutRef.current) {
        window.clearTimeout(safetyTimeoutRef.current);
        safetyTimeoutRef.current = null;
      }
    }, []);

    useEffect(() => {
      return () => {
        clearTimers();
      };
    }, [clearTimers]);

    // Core Segment Playback Loop
    const playSegmentInternal = useCallback(
      (segment: Segment, globalOffset: number) => {
        currentSegmentRef.current = { segment, globalOffset };

        if (!playerRef.current || !isPlayerReady) {
          // Store in pending queue so it executes the instant player is ready!
          pendingSegmentRef.current = { segment, globalOffset };
          return;
        }

        clearTimers();
        setNeedsUserTap(false);

        const cutStart = segment.cutOffsetStart || 0;
        const cutEnd = segment.cutOffsetEnd || 0;
        const seekTarget = Math.max(0, segment.start + cutStart + globalOffset - 0.15);
        const stopTarget = Math.max(seekTarget + 0.4, segment.end + cutEnd + globalOffset + 0.15);
        const speed = playbackSpeedRef.current || 1.0;

        try {
          playerRef.current.seekTo(seekTarget, true);
          playerRef.current.setPlaybackRate(speed);
          playerRef.current.playVideo();
        } catch (err) {
          console.error('Seek/Play failed:', err);
        }

        const seekStartedAt = Date.now();
        let hasEnteredWindow = false;

        // Safety timeout
        const segmentDuration = Math.max(1, stopTarget - seekTarget);
        const safetyMs = (segmentDuration / speed + 8) * 1000;

        safetyTimeoutRef.current = window.setTimeout(() => {
          if (playerRef.current) {
            playerRef.current.pauseVideo();
          }
          clearTimers();
          setIsActuallyPlaying(false);
          onSegmentCompleteRef.current();
        }, safetyMs);

        // Check every 80ms with post-seek guard so stale pre-seek time never aborts replay
        intervalRef.current = window.setInterval(() => {
          if (!playerRef.current) return;
          try {
            const curTime = playerRef.current.getCurrentTime();
            const elapsed = Date.now() - seekStartedAt;

            if (curTime < stopTarget - 0.1 && curTime >= seekTarget - 0.8) {
              hasEnteredWindow = true;
            }

            if ((hasEnteredWindow || elapsed > 1200) && curTime >= stopTarget) {
              playerRef.current.pauseVideo();
              clearTimers();
              setIsActuallyPlaying(false);
              onSegmentCompleteRef.current();
            }
          } catch {
            // ignore
          }
        }, 80);

        // If browser blocks autoplay, detect it after 600ms and show Tap to play
        setTimeout(() => {
          if (playerRef.current) {
            try {
              const state = playerRef.current.getPlayerState();
              if (state !== 1 && state !== 3) {
                setNeedsUserTap(true);
              }
            } catch {
              // ignore
            }
          }
        }, 600);
      },
      [isPlayerReady, clearTimers]
    );

    const playSegmentInternalRef = useRef(playSegmentInternal);
    playSegmentInternalRef.current = playSegmentInternal;

    // Initialize player ONLY when API is ready or videoId changes
    useEffect(() => {
      if (!isApiLoaded || !videoId || !containerRef.current) return;

      let isMounted = true;
      setIsPlayerReady(false);

      const initPlayer = () => {
        if (!isMounted || !containerRef.current) return;
        try {
          if (playerRef.current) {
            try {
              playerRef.current.destroy();
            } catch {
              // ignore
            }
            playerRef.current = null;
          }

          playerRef.current = new window.YT.Player(containerRef.current, {
            videoId,
            playerVars: {
              autoplay: 0,
              controls: 0,
              enablejsapi: 1,
              playsinline: 1,
              rel: 0,
              fs: 0,
              disablekb: 1,
              modestbranding: 1,
              iv_load_policy: 3,
            },
            events: {
              onReady: (event) => {
                if (!isMounted) return;
                setIsPlayerReady(true);
                setHasError(null);
                event.target.setPlaybackRate(playbackSpeedRef.current || 1.0);
                const duration = event.target.getDuration();
                if (onPlayerReadyRef.current && duration > 0) {
                  onPlayerReadyRef.current(duration);
                }

                // Wait one tick for state update, then start any queued segment
                if (pendingSegmentRef.current) {
                  const pending = pendingSegmentRef.current;
                  pendingSegmentRef.current = null;
                  setTimeout(() => {
                    if (isMounted) {
                      playSegmentInternalRef.current(pending.segment, pending.globalOffset);
                    }
                  }, 50);
                }
              },
              onStateChange: (event) => {
                if (!isMounted) return;
                // 1 = PLAYING, 2 = PAUSED, 3 = BUFFERING
                if (event.data === 1) {
                  setIsActuallyPlaying(true);
                  setNeedsUserTap(false);
                } else if (event.data === 2) {
                  setIsActuallyPlaying(false);
                }
              },
              onError: (event) => {
                if (!isMounted) return;
                console.error('YouTube player error code:', event.data);
                if (event.data === 101 || event.data === 150) {
                  setHasError('Mèt videyo sa a pa pèmèt li jwe deyò YouTube (Embedding disabled by owner).');
                } else if (event.data === 100) {
                  setHasError('Videyo sa a pa egziste oswa li prive (Video private or removed).');
                } else {
                  setHasError('Erè nan chaje videyo YouTube la.');
                }
              },
            },
          });
        } catch (err) {
          console.error('Error initializing YouTube player:', err);
          setHasError('Pa ka inisyalize jwè YouTube la.');
        }
      };

      const timer = setTimeout(initPlayer, 100);

      return () => {
        isMounted = false;
        clearTimeout(timer);
        clearTimers();
        if (playerRef.current) {
          try {
            playerRef.current.destroy();
          } catch {
            // ignore
          }
          playerRef.current = null;
        }
      };
    }, [isApiLoaded, videoId, clearTimers]);

    // Handle user tap on video overlay (satisfies browser user gesture requirement)
    const handleUserGesturePlay = () => {
      setNeedsUserTap(false);
      if (currentSegmentRef.current) {
        playSegmentInternal(
          currentSegmentRef.current.segment,
          currentSegmentRef.current.globalOffset
        );
      } else if (playerRef.current) {
        try {
          playerRef.current.playVideo();
        } catch {
          // ignore
        }
      }
    };

    // Expose imperative API for parent controller
    useImperativeHandle(
      ref,
      () => ({
        playSegment: (segment, globalOffset) => {
          playSegmentInternal(segment, globalOffset);
        },
        replayCurrentSegment: () => {
          if (currentSegmentRef.current) {
            playSegmentInternal(
              currentSegmentRef.current.segment,
              currentSegmentRef.current.globalOffset
            );
          }
        },
        pause: () => {
          clearTimers();
          setIsActuallyPlaying(false);
          if (playerRef.current) {
            playerRef.current.pauseVideo();
          }
        },
        setSpeed: (rate: number) => {
          playbackSpeedRef.current = rate;
          if (playerRef.current && isPlayerReady) {
            playerRef.current.setPlaybackRate(rate);
          }
        },
        getDuration: () => {
          if (playerRef.current && isPlayerReady) {
            return playerRef.current.getDuration();
          }
          return 0;
        },
      }),
      [playSegmentInternal, clearTimers, isPlayerReady]
    );

    return (
      <div className="relative w-full aspect-video bg-black/75 rounded-2xl overflow-hidden glass-panel select-none">
        {/* The YouTube iframe mount container */}
        <div ref={containerRef} className="w-full h-full pointer-events-none" />

        {/* Shield overlay preventing direct scrub, with tap-to-play support */}
        <div
          onClick={handleUserGesturePlay}
          className="absolute inset-0 z-20 cursor-pointer select-none bg-transparent"
          aria-hidden="true"
          title="Tape pou jwe"
        />

        {/* Loading Spinner */}
        {(!isPlayerReady || !isApiLoaded) && !hasError && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-app-bg/85 backdrop-blur-md gap-2 text-app-muted">
            <Loader2 className="w-7 h-7 text-app-primary animate-spin" />
            <span className="text-xs font-medium text-app-text">Chaje videyo a...</span>
          </div>
        )}

        {/* Playing Indicator */}
        {isActuallyPlaying && isPlayerReady && (
          <div className="absolute top-2.5 left-2.5 z-30 flex items-center gap-1.5 px-3 py-1 rounded-full glass-modal text-app-text text-xs font-semibold">
            <span className="w-2 h-2 rounded-full bg-app-gold animate-pulse" />
            <Volume2 className="w-3.5 h-3.5 text-app-gold" />
            <span>Koute byen</span>
          </div>
        )}

        {/* Tap to Play prompt if browser blocked autoplay */}
        {isPlayerReady && !isActuallyPlaying && isPlayingSegment && (
          <button
            onClick={handleUserGesturePlay}
            className="absolute inset-0 z-30 flex flex-col items-center justify-center glass-backdrop transition-all group cursor-pointer"
          >
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-app-primary to-app-cta-end text-white flex items-center justify-center shadow-xl shadow-app-primary/35 group-active:scale-95 transition-transform mb-2">
              <Play className="w-8 h-8 fill-white ml-1" />
            </div>
            <span className="px-3.5 py-1.5 rounded-full glass-modal text-app-text text-xs font-semibold">
              Tape pou kòmanse koute
            </span>
          </button>
        )}

        {/* Error overlay */}
        {hasError && (
          <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-app-bg/92 backdrop-blur-md p-4 text-center">
            <AlertCircle className="w-8 h-8 text-app-accent mb-2" />
            <p className="text-sm text-app-text font-semibold mb-1">{hasError}</p>
            <p className="text-xs text-app-muted">
              Ou ka chwazi yon lòt videyo oswa kopye transkripsyon an dirèkteman.
            </p>
          </div>
        )}
      </div>
    );
  }
);

YouTubePlayer.displayName = 'YouTubePlayer';
