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

/** Extra letters allowed past the end of a word, like Monkeytype. */
export const MAX_EXTRA = 20;

const wordsOf = (line: string) => line.split(' ');

/** Where you are in a line: the index of the word being typed and what you've typed of it. */
export function position(typed: string): { k: number; cur: string } {
  const i = typed.lastIndexOf(' ');
  return { k: typed.split(' ').length - 1, cur: typed.slice(i + 1) };
}

/** A line has an error unless every word was typed exactly. */
export function lineHasError(typed: string, target: string): boolean {
  return typed !== target;
}

/** What to type next: a character, 'backspace' when the current word has a mistake, or null at the very end. */
export function nextExpected(target: string, typed: string): string | 'backspace' | null {
  const T = wordsOf(target);
  const { k, cur } = position(typed);
  const word = T[k] ?? '';
  if (cur.length > word.length || word.slice(0, cur.length) !== cur) return 'backspace';
  if (cur.length < word.length) return word[cur.length];
  return k < T.length - 1 ? ' ' : null;
}

export type CellState = 'c' | 'x' | 'u' | 'm' | 'e' | 's' | 'end';
export interface Cell {
  ch: string;
  state: CellState;
}

/**
 * How a line is drawn, Monkeytype style: every letter of every word (typed right, typed wrong,
 * not typed yet, or skipped), then any EXTRA letters typed past a word's end in their own colour,
 * then a space. `caret` is the cell the next letter goes before. A zero-width 'end' cell closes
 * the line so the caret always has somewhere to sit.
 */
export function layoutLine(target: string, typed: string, closed: boolean): { cells: Cell[]; caret: number } {
  const T = wordsOf(target);
  const typedWords = typed.split(' ');
  const cells: Cell[] = [];
  let caret = 0;
  T.forEach((word, k) => {
    const tw = typedWords[k] ?? '';
    const left = k < typedWords.length - 1 || closed; // moved on from this word (or the line is over)
    const start = cells.length;
    for (let i = 0; i < word.length; i++) {
      cells.push({ ch: word[i], state: i < tw.length ? (tw[i] === word[i] ? 'c' : 'x') : left ? 'm' : 'u' });
    }
    for (let i = word.length; i < tw.length; i++) cells.push({ ch: tw[i], state: 'e' });
    if (k === typedWords.length - 1) caret = start + tw.length;
    if (k < T.length - 1) cells.push({ ch: ' ', state: 's' });
  });
  cells.push({ ch: '', state: 'end' });
  return { cells, caret: Math.min(caret, cells.length - 1) };
}

/**
 * Typing works on words, like Monkeytype:
 *  - a space moves to the next word, even if this one is unfinished (the missing letters count as missed);
 *    a space at the start of a word does nothing;
 *  - letters typed past the end of a word are kept as extras, shown after the word, up to MAX_EXTRA;
 *  - the last word of a line finishes the line when it is exactly right, or when you press space;
 *  - backspace can go back into a previous word only if that word was wrong.
 *
 * `hard`: a line only counts once it is typed exactly right. You can't leave a wrong word (space does
 * nothing until it is fixed), and Enter can't skip a line.
 */
export function typingReducer(texts: string[], opts: { hard?: boolean } = {}) {
  const n = texts.length;
  const hard = opts.hard ?? false;

  const closeCur = (s: TypingState, how: LineStatus): TypingState => {
    const status = [...s.status];
    status[s.cur] = how;
    const cur = s.cur + 1;
    return { ...s, status, cur, done: cur >= n };
  };
  const withTyped = (s: TypingState, line: number, value: string): TypingState => {
    const typed = [...s.typed];
    typed[line] = value;
    return { ...s, typed };
  };

  return (s: TypingState, a: TypingAction): TypingState => {
    switch (a.type) {
      case 'char': {
        if (s.done) return s;
        const T = wordsOf(texts[s.cur]);
        const before = s.typed[s.cur];
        const { k, cur } = position(before);
        const word = T[k] ?? '';
        const last = k >= T.length - 1;
        let value = before;
        let ok: boolean;
        let finish = false;

        if (a.ch === ' ') {
          if (cur === '') return s; // a space at the start of a word does nothing
          ok = cur === word;
          if (hard && !ok) return s; // hard mode: fix the word before leaving it
          if (last) finish = true;
          else value = before + ' ';
        } else {
          if (cur.length >= word.length + MAX_EXTRA) return s;
          ok = cur.length < word.length && word[cur.length] === a.ch;
          value = before + a.ch;
          if (last && cur + a.ch === word) finish = true;
        }
        const next: TypingState = {
          ...withTyped(s, s.cur, value),
          keys: { total: s.keys.total + 1, correct: s.keys.correct + (ok ? 1 : 0) },
        };
        return finish ? closeCur(next, 'done') : next;
      }
      case 'backspace': {
        if (s.done) return s;
        const before = s.typed[s.cur];
        if (before.length > 0) {
          if (before.endsWith(' ')) {
            // back into the previous word: only allowed when it was wrong
            const k = before.split(' ').length - 2;
            if (before.slice(0, -1).split(' ')[k] === wordsOf(texts[s.cur])[k]) return s;
          }
          return withTyped(s, s.cur, before.slice(0, -1));
        }
        const prev = s.cur - 1;
        if (prev >= 0 && s.status[prev] === 'done' && lineHasError(s.typed[prev], texts[prev])) {
          const status = [...s.status];
          status[prev] = 'open';
          return { ...withTyped(s, prev, s.typed[prev]), cur: prev, status };
        }
        return s;
      }
      case 'deleteWord': {
        if (s.done) return s;
        const before = s.typed[s.cur];
        const { cur } = position(before);
        if (cur) return withTyped(s, s.cur, before.slice(0, before.length - cur.length));
        if (!before.endsWith(' ')) return s;
        const typedWords = before.slice(0, -1).split(' ');
        const prev = typedWords.pop()!;
        if (prev === wordsOf(texts[s.cur])[typedWords.length]) return s; // a correct word stays
        return withTyped(s, s.cur, typedWords.length ? `${typedWords.join(' ')} ` : '');
      }
      case 'enter':
        return hard || s.done || s.typed[s.cur].length === 0 ? s : closeCur(s, 'done');
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

/**
 * Characters by outcome. Letters typed right are correct; wrong letters and extras are incorrect;
 * letters never typed in a line you moved past are missed. A space you typed counts as correct when the
 * word before it was right, and as incorrect otherwise; one you never typed counts as missed.
 */
export function countChars(texts: string[], s: TypingState): Counts {
  const c: Counts = { correct: 0, incorrect: 0, missed: 0 };
  texts.forEach((target, li) => {
    const closed = s.status[li] !== 'open';
    const T = wordsOf(target);
    const tw = s.typed[li].split(' ');
    T.forEach((word, k) => {
      const typedWord = tw[k] ?? '';
      for (let i = 0; i < word.length; i++) {
        if (i < typedWord.length) typedWord[i] === word[i] ? c.correct++ : c.incorrect++;
        else if (closed) c.missed++;
      }
      c.incorrect += Math.max(0, typedWord.length - word.length);
      if (k < T.length - 1) {
        if (k < tw.length - 1) typedWord === word ? c.correct++ : c.incorrect++;
        else if (closed) c.missed++;
      }
    });
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
