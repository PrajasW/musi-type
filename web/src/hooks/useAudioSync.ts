import { useCallback, useEffect, useRef, useState } from 'react';
import { getAudioStatus, startAudioSync, type AudioStatus } from '../lib/api';

/**
 * Optional audio sync (Whisper on the server). Polls while a job runs and calls
 * `onDone` once new word timings exist, so the caller can re-align the lyrics.
 */
export function useAudioSync(videoId: string, onDone: () => void) {
  const [status, setStatus] = useState<AudioStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    let cancelled = false;
    setStatus(null);
    setError(null);
    getAudioStatus(videoId)
      .then((s) => !cancelled && setStatus(s))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  const running = status?.state === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      getAudioStatus(videoId)
        .then((s) => {
          setStatus(s);
          if (s.state === 'done') onDoneRef.current();
          if (s.state === 'error') setError(s.error ?? 'Audio sync failed');
        })
        .catch(() => {});
    }, 1500);
    return () => clearInterval(timer);
  }, [running, videoId]);

  const start = useCallback(
    async (lyrics?: string) => {
      setError(null);
      try {
        setStatus(await startAudioSync(videoId, lyrics));
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [videoId],
  );

  return { status, error, start };
}
