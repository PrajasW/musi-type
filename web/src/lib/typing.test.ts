import { describe, expect, it } from 'vitest';
import { accuracy, consistency, countChars, initialState, toTypeable, typingReducer, wpm, type TypingAction } from './typing';

const texts = ['hi you', 'ok'];

function run(actions: TypingAction[], t = texts) {
  const reduce = typingReducer(t);
  return actions.reduce(reduce, initialState(t));
}
const chars = (s: string): TypingAction[] => [...s].map((ch) => ({ type: 'char', ch }));

describe('toTypeable', () => {
  it('normalises quotes and strips punctuation', () => {
    expect(toTypeable('I’m “fine”, really!', { lowercase: true, stripPunct: true })).toBe("i'm fine real" + 'ly');
  });
  it('keeps punctuation and case when asked', () => {
    expect(toTypeable('Hello, World!', { lowercase: false, stripPunct: false })).toBe('Hello, World!');
  });
  it('drops dangling apostrophes', () => {
    expect(toTypeable("'cause goin' home", { lowercase: true, stripPunct: true })).toBe('cause goin home');
  });
});

describe('typingReducer', () => {
  it('auto-advances when a line is fully typed', () => {
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

  it('finishes the session after the last line', () => {
    const s = run(chars('hi youok'));
    expect(s.done).toBe(true);
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

  it('backspace returns to a finished line only if it had errors', () => {
    const bad = run([...chars('hi yoX'), { type: 'backspace' }]);
    expect(bad.cur).toBe(0);
    expect(bad.typed[0]).toBe('hi yo');
    const good = run([...chars('hi you'), { type: 'backspace' }]);
    expect(good.cur).toBe(1);
  });

  it('seek reopens lines from the target onwards', () => {
    const reduce = typingReducer(texts);
    let s = run(chars('hi you'));
    s = reduce(s, { type: 'seek', idx: 0 });
    expect(s.cur).toBe(0);
    expect(s.typed).toEqual(['', '']);
    expect(s.done).toBe(false);
  });

  it('deleteWord removes the last word', () => {
    const s = run([...chars('hi yo'), { type: 'deleteWord' }]);
    expect(s.typed[0]).toBe('hi ');
  });
});

describe('hard mode', () => {
  const hard = (actions: TypingAction[], t = texts) => {
    const reduce = typingReducer(t, { hard: true });
    return actions.reduce(reduce, initialState(t));
  };

  it('does not advance a full line that has a mistake', () => {
    const s = hard(chars('hi yox'));
    expect(s.cur).toBe(0);
    expect(s.typed[0]).toBe('hi yox');
    expect(s.status[0]).toBe('open');
  });

  it('stops accepting characters on a full wrong line, and advances once it is fixed', () => {
    const reduce = typingReducer(texts, { hard: true });
    let s = hard(chars('hi yox'));
    s = reduce(s, { type: 'char', ch: 'z' });
    expect(s.typed[0]).toBe('hi yox');           // ignored: the line is full
    s = reduce(s, { type: 'backspace' });
    s = reduce(s, { type: 'char', ch: 'u' });
    expect(s.cur).toBe(1);
    expect(s.status[0]).toBe('done');
  });

  it("enter can't skip a line", () => {
    const s = hard([...chars('hi'), { type: 'enter' }]);
    expect(s.cur).toBe(0);
  });

  it('an exact line still advances, and the normal mode still lets mistakes through', () => {
    expect(hard(chars('hi you')).cur).toBe(1);
    expect(run(chars('hi yox')).cur).toBe(1);
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
