import type { LyricLine } from './types';

export type LineStatus = 'open' | 'done' | 'locked';

export interface TypingState {
  cur: number;
  typed: string[];
  status: LineStatus[];
  done: boolean;
  keys: { total: number; correct: number };
}

export type TypingAction =
  | { type: 'char'; ch: string }
  | { type: 'backspace' }
  | { type: 'deleteWord' }
  | { type: 'enter' }
  | { type: 'advanceTo'; idx: number }
  | { type: 'seek'; idx: number }
  | { type: 'finish' }
  | { type: 'reset' };

export function initialState(texts: string[]): TypingState {
  return {
    cur: 0,
    typed: texts.map(() => ''),
    status: texts.map(() => 'open'),
    done: texts.length === 0,
    keys: { total: 0, correct: 0 },
  };
}

/** Make a lyric line typeable on a normal keyboard. */
export function toTypeable(text: string, opts: { lowercase: boolean; stripPunct: boolean }): string {
  let s = text
    .replace(/[‘’‛`´]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—―]/g, '-')
    .replace(/…/g, '...')
    .replace(/ /g, ' ');
  if (opts.lowercase) s = s.toLowerCase();
  if (opts.stripPunct) s = s.replace(/[^\p{L}\p{N}\s']/gu, ' ').replace(/(^|\s)'+|'+(?=\s|$)/g, '$1');
  return s.replace(/\s+/g, ' ').trim();
}

/** Typeable lines; lines that become empty are dropped (they carry no typing). */
export function buildLines(lines: LyricLine[], opts: { lowercase: boolean; stripPunct: boolean }): LyricLine[] {
  return lines
    .map((l) => ({ ...l, text: toTypeable(l.text, opts) }))
    .filter((l) => l.text.length > 0);
}

export function lineHasError(typed: string, target: string): boolean {
  for (let i = 0; i < typed.length; i++) if (typed[i] !== target[i]) return true;
  return typed.length < target.length;
}

export function typingReducer(texts: string[]) {
  const n = texts.length;

  const closeCur = (s: TypingState, how: LineStatus): TypingState => {
    const status = [...s.status];
    status[s.cur] = how;
    const cur = s.cur + 1;
    return { ...s, status, cur, done: cur >= n };
  };

  return (s: TypingState, a: TypingAction): TypingState => {
    switch (a.type) {
      case 'char': {
        if (s.done) return s;
        const target = texts[s.cur];
        const before = s.typed[s.cur];
        if (before.length >= target.length) return s;
        const ok = target[before.length] === a.ch;
        const typed = [...s.typed];
        typed[s.cur] = before + a.ch;
        const next: TypingState = {
          ...s,
          typed,
          keys: { total: s.keys.total + 1, correct: s.keys.correct + (ok ? 1 : 0) },
        };
        return typed[s.cur].length === target.length ? closeCur(next, 'done') : next;
      }
      case 'backspace': {
        if (s.done) return s;
        if (s.typed[s.cur].length > 0) {
          const typed = [...s.typed];
          typed[s.cur] = typed[s.cur].slice(0, -1);
          return { ...s, typed };
        }
        const prev = s.cur - 1;
        if (prev >= 0 && s.status[prev] === 'done' && lineHasError(s.typed[prev], texts[prev])) {
          const typed = [...s.typed];
          typed[prev] = typed[prev].slice(0, -1);
          const status = [...s.status];
          status[prev] = 'open';
          return { ...s, cur: prev, typed, status };
        }
        return s;
      }
      case 'deleteWord': {
        if (s.done) return s;
        const typed = [...s.typed];
        typed[s.cur] = typed[s.cur].replace(/\S*\s*$/, '');
        return { ...s, typed };
      }
      case 'enter':
        return s.done || s.typed[s.cur].length === 0 ? s : closeCur(s, 'done');
      case 'advanceTo': {
        const idx = Math.min(a.idx, n);
        if (s.done || idx <= s.cur) return s;
        const status = [...s.status];
        for (let i = s.cur; i < idx; i++) status[i] = 'locked';
        return { ...s, status, cur: idx, done: idx >= n };
      }
      case 'seek': {
        const idx = Math.max(0, Math.min(a.idx, n - 1));
        const typed = s.typed.map((t, i) => (i >= idx ? '' : t));
        const status = s.status.map((st, i) => (i >= idx ? 'open' : st));
        return { ...s, cur: idx, typed, status, done: false };
      }
      case 'finish': {
        if (s.done) return s;
        const status = s.status.map((st, i) => (i >= s.cur && st === 'open' ? 'locked' : st));
        return { ...s, status, done: true };
      }
      case 'reset':
        return initialState(texts);
    }
  };
}

export interface Counts {
  correct: number;
  incorrect: number;
  missed: number;
}

export function countChars(texts: string[], s: TypingState): Counts {
  const c: Counts = { correct: 0, incorrect: 0, missed: 0 };
  texts.forEach((target, i) => {
    const typed = s.typed[i];
    for (let k = 0; k < typed.length; k++) {
      if (typed[k] === target[k]) c.correct++;
      else c.incorrect++;
    }
    if (s.status[i] !== 'open' && typed.length < target.length) c.missed += target.length - typed.length;
  });
  return c;
}

/** Words per minute with the usual 5-characters-per-word convention. Blank for the first second. */
export function wpm(chars: number, activeMs: number): number {
  if (activeMs < 1000) return 0;
  return Math.round(chars / 5 / (activeMs / 60000));
}

/**
 * Monkeytype's consistency: 100 means perfectly steady raw speed. It maps the coefficient
 * of variation of the per-second raw wpm through 100 * (1 - tanh(c + c^3/3 + c^5/5)).
 */
export function consistency(rawPerSecond: number[]): number | null {
  if (rawPerSecond.length < 3) return null;
  const mean = rawPerSecond.reduce((a, b) => a + b, 0) / rawPerSecond.length;
  if (mean <= 0) return 0;
  const variance = rawPerSecond.reduce((a, b) => a + (b - mean) ** 2, 0) / rawPerSecond.length;
  const c = Math.sqrt(variance) / mean;
  return Math.round(100 * (1 - Math.tanh(c + c ** 3 / 3 + c ** 5 / 5)) * 100) / 100;
}

export function accuracy(keys: { total: number; correct: number }): number {
  return keys.total ? Math.round((keys.correct / keys.total) * 1000) / 10 : 100;
}
