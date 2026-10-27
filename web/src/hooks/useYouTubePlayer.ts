import { useCallback, useEffect, useRef, useState } from 'react';

/* Minimal typings for the bits of the IFrame API we use. */
interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  setPlaybackRate(rate: number): void;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  destroy(): void;
}
interface YTNamespace {
  Player: new (el: HTMLElement, opts: unknown) => YTPlayer;
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export const PlayerState = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const;

let apiPromise: Promise<YTNamespace> | undefined;
function loadApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiPromise ??= new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT!);
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => {
      apiPromise = undefined;
      reject(new Error('Could not load the YouTube player'));
    };
    document.head.appendChild(s);
  });
  return apiPromise;
}

export interface PlayerControls {
  play(): void;
  pause(): void;
  toggle(): void;
  seek(seconds: number): void;
  setRate(rate: number): void;
  toggleMute(): void;
}

export function useYouTubePlayer(videoId: string) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const [state, setState] = useState<number>(PlayerState.UNSTARTED);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [rate, setRateState] = useState(1);
  const [ready, setReady] = useState(false);
  const everStarted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError(null);
    setState(PlayerState.UNSTARTED);
    setTime(0);
    everStarted.current = false;

    loadApi()
      .then((YT) => {
        if (cancelled || !mountRef.current) return;
        // YT replaces the target node with an iframe, so give it a throwaway child
        const target = document.createElement('div');
        mountRef.current.replaceChildren(target);
        playerRef.current = new YT.Player(target, {
          videoId,
          width: '100%',
          height: '100%',
          playerVars: { controls: 0, disablekb: 1, rel: 0, modestbranding: 1, playsinline: 1, iv_load_policy: 3, fs: 0, origin: location.origin },
          events: {
            onReady: () => {
              if (cancelled) return;
              setReady(true);
              setDuration(playerRef.current?.getDuration() ?? 0);
            },
            onStateChange: (e: { data: number }) => {
              if (e.data === PlayerState.PLAYING) everStarted.current = true;
              setState(e.data);
              setDuration(playerRef.current?.getDuration() ?? 0);
            },
            onError: (e: { data: number }) => {
              setError(
                e.data === 101 || e.data === 150
                  ? "The uploader doesn't allow this video to be played outside YouTube."
                  : e.data === 100
                    ? 'This video is unavailable.'
                    : 'The video failed to load.',
              );
            },
          },
        });
      })
      .catch((e: Error) => !cancelled && setError(e.message));

    return () => {
      cancelled = true;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [videoId]);

  // the API has no timeupdate event, so poll
  useEffect(() => {
    const id = setInterval(() => {
      const p = playerRef.current;
      if (p && typeof p.getCurrentTime === 'function') setTime(p.getCurrentTime());
    }, 100);
    return () => clearInterval(id);
  }, []);

  const controls: PlayerControls = {
    play: useCallback(() => playerRef.current?.playVideo(), []),
    pause: useCallback(() => playerRef.current?.pauseVideo(), []),
    toggle: useCallback(() => {
      const p = playerRef.current;
      if (!p) return;
      p.getPlayerState() === PlayerState.PLAYING ? p.pauseVideo() : p.playVideo();
    }, []),
    seek: useCallback((s: number) => {
      playerRef.current?.seekTo(Math.max(0, s), true);
      setTime(Math.max(0, s));
    }, []),
    setRate: useCallback((r: number) => {
      playerRef.current?.setPlaybackRate(r);
      setRateState(r);
    }, []),
    toggleMute: useCallback(() => {
      const p = playerRef.current;
      if (!p) return;
      if (p.isMuted()) { p.unMute(); setMuted(false); } else { p.mute(); setMuted(true); }
    }, []),
  };

  return { mountRef, state, time, duration, error, muted, rate, ready, hasStarted: () => everStarted.current, controls };
}
