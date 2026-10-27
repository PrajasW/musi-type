import { describe, expect, it } from 'vitest';
import {
  accuracy,
  consistency,
  countChars,
  initialState,
  layoutLine,
  MAX_EXTRA,
  nextExpected,
  toTypeable,
  typingReducer,
  wpm,
  type TypingAction,
} from './typing';

const texts = ['hi you', 'ok'];

function run(actions: TypingAction[], t = texts, hard = false) {
  const reduce = typingReducer(t, { hard });
  return actions.reduce(reduce, initialState(t));
}
const chars = (s: string): TypingAction[] => [...s].map((ch) => ({ type: 'char', ch }));
const cells = (target: string, typed: string, closed = false) =>
  layoutLine(target, typed, closed)
    .cells.filter((c) => c.state !== 'end')
    .map((c) => `${c.ch}${c.state}`)
    .join('');

describe('toTypeable', () => {
  it('normalises quotes and strips punctuation', () => {
    expect(toTypeable('I’m “fine”, really!', { lowercase: true, stripPunct: true })).toBe("i'm fine really");
  });
  it('keeps punctuation and case when asked', () => {
    expect(toTypeable('Hello, World!', { lowercase: false, stripPunct: false })).toBe('Hello, World!');
  });
  it('drops dangling apostrophes', () => {
    expect(toTypeable("'cause goin' home", { lowercase: true, stripPunct: true })).toBe('cause goin home');
  });
});

describe('typing a line, word by word', () => {
  it('finishes a line when its last word is typed exactly', () => {
    const s = run(chars('hi you'));
    expect(s.cur).toBe(1);
    expect(s.status[0]).toBe('done');
  });

  it('counts keystroke accuracy including corrected mistakes', () => {
    const s = run([...chars('hx'), { type: 'backspace' }, ...chars('i')]);
    expect(s.typed[0]).toBe('hi');
    expect(s.keys).toEqual({ total: 3, correct: 2 });
    expect(accuracy(s.keys)).toBeCloseTo(66.7, 1);
  });

  it('finishes the whole session after the last line', () => {
    expect(run(chars('hi you ok')).done).toBe(true);
  });

  it('a space moves to the next word even if this one is unfinished', () => {
    const s = run(chars('h '));
    expect(s.typed[0]).toBe('h ');
    // finishing the line leaves the skipped 'i' of 'hi' counted as missed
    expect(countChars(texts, run([...chars('h '), ...chars('you')])).missed).toBe(1);
  });

  it('ignores a space at the start of a word', () => {
    expect(run(chars(' ')).typed[0]).toBe('');
    expect(run(chars('hi  ')).typed[0]).toBe('hi ');
    expect(run(chars('hi  ')).keys.total).toBe(3); // the second space wasn't a keystroke
  });

  it('a wrong full-length last word does not finish the line; space does', () => {
    let s = run(chars('hi yox'));
    expect(s.cur).toBe(0);
    s = typingReducer(texts)(s, { type: 'char', ch: ' ' });
    expect(s.cur).toBe(1);
    expect(s.status[0]).toBe('done');
    expect(s.typed[0]).toBe('hi yox');
  });

  it('enter ends a line early and the rest counts as missed', () => {
    const s = run([...chars('hi'), { type: 'enter' }]);
    expect(s.cur).toBe(1);
    expect(countChars(texts, s)).toEqual({ correct: 2, incorrect: 0, missed: 4 });
  });

  it('advanceTo locks lines whose deadline passed, and ignores going backwards', () => {
    let s = run([...chars('hi'), { type: 'advanceTo', idx: 1 }]);
    expect(s.status).toEqual(['locked', 'open']);
    expect(s.cur).toBe(1);
    s = typingReducer(texts)(s, { type: 'advanceTo', idx: 0 });
    expect(s.cur).toBe(1);
    // a locked line cannot be re-entered with backspace
    s = typingReducer(texts)(s, { type: 'backspace' });
    expect(s.cur).toBe(1);
  });

  it('seek reopens lines from the target onwards', () => {
    const reduce = typingReducer(texts);
    let s = run(chars('hi you'));
    s = reduce(s, { type: 'seek', idx: 0 });
    expect(s.cur).toBe(0);
    expect(s.typed).toEqual(['', '']);
    expect(s.done).toBe(false);
  });
});

describe('extra letters (Monkeytype style)', () => {
  it('keeps letters typed past the end of a word and shows them after it', () => {
    // target word "the", typed "thsaaa": t h right, e is wrong, then three extras
    const layout = layoutLine('the end', 'thsaaa', false).cells;
    expect(layout.slice(0, 3).map((c) => c.state)).toEqual(['c', 'c', 'x']);
    expect(layout.slice(3, 6).map((c) => `${c.ch}:${c.state}`)).toEqual(['a:e', 'a:e', 'a:e']); // the extras, in their own state
  });

  it('puts extras before the space that follows the word, and the caret after them', () => {
    const { cells: c, caret } = layoutLine('the end', 'theaa', false);
    expect(c.slice(0, 5).map((x) => `${x.ch}${x.state}`)).toEqual(['tc', 'hc', 'ec', 'ae', 'ae']);
    expect(c[5]).toEqual({ ch: ' ', state: 's' });
    expect(caret).toBe(5); // right after the extras, before the space
  });

  it('stores extras in the typed text and lets backspace remove them', () => {
    let s = run(chars('hi youuu'.replace('youuu', 'x'))); // last word wrong, not finished
    expect(s.typed[0]).toBe('hi x');
    s = run(chars('hiaaa'));
    expect(s.typed[0]).toBe('hiaaa');
    s = typingReducer(texts)(s, { type: 'backspace' });
    expect(s.typed[0]).toBe('hiaa');
  });

  it('counts extras as incorrect characters and the space after a wrong word as incorrect', () => {
    const s = run([...chars('hiaa '), ...chars('you')]);
    expect(s.cur).toBe(1);
    const c = countChars(texts, s);
    expect(c.correct).toBe(2 + 3); // h i, y o u
    expect(c.incorrect).toBe(2 + 1); // aa, and the space after the wrong word
  });

  it(`accepts at most ${MAX_EXTRA} extra letters per word`, () => {
    const s = run(chars('h' + 'z'.repeat(MAX_EXTRA + 5)));
    expect(s.typed[0].length).toBe(2 + MAX_EXTRA); // 'hi' is 2 letters long, plus the cap
  });
});

describe('backspace between words', () => {
  it('goes back into a previous word only if it was wrong', () => {
    const reduce = typingReducer(texts);
    let s = run(chars('hx '));
    s = reduce(s, { type: 'backspace' });
    expect(s.typed[0]).toBe('hx'); // wrong word: you may go back
    s = run(chars('hi '));
    s = reduce(s, { type: 'backspace' });
    expect(s.typed[0]).toBe('hi '); // right word stays
  });

  it('returns to the previous line only if it finished with a mistake', () => {
    const reduce = typingReducer(texts);
    let s = run([...chars('hi yox'), ...chars(' ')]); // line 0 finished with a wrong last word
    expect(s.cur).toBe(1);
    s = reduce(s, { type: 'backspace' });
    expect(s.cur).toBe(0);
    expect(s.typed[0]).toBe('hi yox');
    s = run(chars('hi you'));
    s = reduce(s, { type: 'backspace' });
    expect(s.cur).toBe(1); // it was perfect: stay
  });

  it('deleteWord removes the word being typed, and a wrong previous word at a word start', () => {
    const reduce = typingReducer(texts);
    expect(run([...chars('hi yo'), { type: 'deleteWord' }]).typed[0]).toBe('hi ');
    expect(run([...chars('hx '), { type: 'deleteWord' }]).typed[0]).toBe('');
    expect(run([...chars('hi '), { type: 'deleteWord' }]).typed[0]).toBe('hi '); // correct word stays
    expect(reduce(run(chars('')), { type: 'deleteWord' }).typed[0]).toBe('');
  });
});

describe('nextExpected', () => {
  it('points at the next letter, then the space, then nothing at the end of the line', () => {
    expect(nextExpected('hi you', '')).toBe('h');
    expect(nextExpected('hi you', 'h')).toBe('i');
    expect(nextExpected('hi you', 'hi')).toBe(' ');
    expect(nextExpected('hi you', 'hi y')).toBe('o');
    expect(nextExpected('hi you', 'hi you')).toBeNull();
  });
  it('points at backspace when the word has a mistake or extras', () => {
    expect(nextExpected('hi you', 'hx')).toBe('backspace');
    expect(nextExpected('hi you', 'hiaa')).toBe('backspace');
  });
});

describe('layoutLine', () => {
  it('marks typed, wrong, untyped and skipped letters', () => {
    // "hi you": typed "hx " then nothing yet on the second word
    expect(cells('hi you', 'hx ')).toBe('hcix syuouuu');
  });
  it('shows the letters of skipped words as missed once the line is closed', () => {
    expect(cells('hi you', 'hi', true)).toBe('hcic symomum');
  });
  it('always ends with a zero-width cell so the caret has a place to sit', () => {
    expect(layoutLine('hi', 'hi', false).cells.at(-1)?.state).toBe('end');
    expect(layoutLine('hi', 'hi', false).caret).toBe(2);
  });
});

describe('hard mode', () => {
  const hard = (actions: TypingAction[], t = texts) => run(actions, t, true);

  it('does not let you leave a wrong word with space', () => {
    const s = hard(chars('hx '));
    expect(s.typed[0]).toBe('hx');
  });

  it('does not finish a line whose last word is wrong, even with space', () => {
    const s = hard(chars('hi yox '));
    expect(s.cur).toBe(0);
    expect(s.typed[0]).toBe('hi yox');
  });

  it('lets you fix the word and carry on', () => {
    let s = hard(chars('hx'));
    s = typingReducer(texts, { hard: true })(s, { type: 'backspace' });
    s = typingReducer(texts, { hard: true })(s, { type: 'char', ch: 'i' });
    expect(s.typed[0]).toBe('hi');
    const done = hard(chars('hi you'));
    expect(done.cur).toBe(1);
  });

  it("enter can't skip a line", () => {
    const s = hard([...chars('hi'), { type: 'enter' }]);
    expect(s.cur).toBe(0);
  });

  it('normal mode lets the same mistakes through', () => {
    expect(run(chars('hx ')).typed[0]).toBe('hx ');
    expect(run(chars('hi yox ')).cur).toBe(1);
  });
});

describe('wpm', () => {
  it('uses 5 chars per word', () => {
    expect(wpm(100, 60_000)).toBe(20);
    expect(wpm(100, 100)).toBe(0);
  });
  it('keeps falling while you are idle (the clock runs, the characters do not)', () => {
    expect(wpm(50, 10_000)).toBe(60);
    expect(wpm(50, 20_000)).toBe(30);
  });
});

describe('consistency', () => {
  it('is 100 for perfectly steady speed and lower for erratic speed', () => {
    expect(consistency([60, 60, 60, 60])).toBe(100);
    const erratic = consistency([0, 120, 0, 120, 0, 120])!;
    const steady = consistency([55, 65, 60, 62, 58])!;
    expect(erratic).toBeLessThan(steady);
    expect(steady).toBeGreaterThan(90);
  });
  it('needs a few seconds of data', () => {
    expect(consistency([60, 60])).toBeNull();
  });
});
