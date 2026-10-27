import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type MutableRefObject } from 'react';
import { accuracy, consistency, countChars, initialState, typingReducer, wpm, type Counts, type TypingState } from '../lib/typing';

export interface Sample {
  sec: number;
  /** net wpm so far (what the big number shows) */
  wpm: number;
  /** raw wpm over just this second (all keystrokes, right or wrong) */
  raw: number;
  /** cumulative wrong keystrokes */
  errors: number;
}

export interface TypingStats {
  wpm: number;
  /** raw wpm over the whole run: counts wrong characters too */
  raw: number;
  accuracy: number;
  /** 0..100, how steady the speed was, or null with too little data */
  consistency: number | null;
  counts: Counts;
  activeMs: number;
  samples: Sample[];
}

const TICK_MS = 200;

/**
 * Typing session over fixed `texts`, scored the way Monkeytype does:
 *  - the clock starts at the first keystroke and then runs continuously, so the live
 *    WPM keeps updating (and drops while you're idle) instead of only changing when you type;
 *  - wpm = correct characters / 5 per minute, raw = every typed character / 5 per minute;
 *  - accuracy = correct keystrokes / all keystrokes (fixed mistakes still count);
 *  - one sample per second feeds the graph and the consistency score.
 *
 * `clockOn` is read on every tick. It should be false only when there is nothing the
 * typist could be typing (the next lyric isn't out yet, or the song is paused by them).
 * `texts` must be stable for the life of the hook: remount (via `key`) for new lines.
 */
export function useTyping(texts: string[], clockOn: MutableRefObject<boolean>, hard = false) {
  const reducer = useMemo(() => typingReducer(texts, { hard }), [texts, hard]);
  const [state, dispatch] = useReducer(reducer, texts, initialState);
  const [started, setStarted] = useState(false);
  const [activeMs, setActiveMs] = useState(0);
  const [samples, setSamples] = useState<Sample[]>([]);
  const latest = useRef({ state, texts, ms: 0, lastKeys: 0, samples: [] as Sample[] });
  latest.current.state = state;
  latest.current.texts = texts;

  const restart = useCallback(() => {
    dispatch({ type: 'reset' });
    setStarted(false);
    setActiveMs(0);
    setSamples([]);
    latest.current.ms = 0;
    latest.current.lastKeys = 0;
    latest.current.samples = [];
  }, []);

  const markStarted = useCallback(() => setStarted(true), []);

  useEffect(() => {
    if (!started || state.done) return;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      const cur = latest.current;
      if (clockOn.current) cur.ms += dt;
      setActiveMs(cur.ms);

      // one sample per full second of clock time. Done here, not inside a setState
      // updater: React may run updaters twice, which would double-count the keystrokes.
      const sec = Math.floor(cur.ms / 1000);
      if (sec > 0 && cur.samples.length < sec) {
        const c = countChars(cur.texts, cur.state);
        const burst = cur.state.keys.total - cur.lastKeys;
        cur.lastKeys = cur.state.keys.total;
        cur.samples = [
          ...cur.samples,
          { sec, wpm: wpm(c.correct, cur.ms), raw: Math.round((burst / 5) * 60), errors: cur.state.keys.total - cur.state.keys.correct },
        ];
        setSamples(cur.samples);
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [started, state.done, clockOn]);

  const stats: TypingStats = useMemo(() => {
    const counts = countChars(texts, state);
    return {
      wpm: wpm(counts.correct, activeMs),
      raw: wpm(counts.correct + counts.incorrect, activeMs),
      accuracy: accuracy(state.keys),
      consistency: consistency(samples.map((s) => s.raw)),
      counts,
      activeMs,
      samples,
    };
  }, [texts, state, activeMs, samples]);

  return { state: state as TypingState, dispatch, stats, started, markStarted, restart };
}
