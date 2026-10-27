import { describe, expect, it } from 'vitest';
import { alignLyrics, estimateOffset } from './align.js';
import { normWord, phoneticKey, similarity } from './normalize.js';
import type { TimedWord } from '../types.js';

// original text, made up for the tests
const LYRICS = `Paper boats drift home
Over the sleeping town below
Carry me where lanterns glow
[Chorus]
We sail through the silver night again
Singing till the stars come down tonight
(Instrumental)
We sail through the silver night again
Singing till the stars come down tonight`;

/** Build fake ASR from lyrics: words every `step` seconds starting at `t0`, with a corrupter. */
function fakeAsr(
  text: string,
  t0: number,
  step: number,
  corrupt: (w: string, i: number) => string | null = (w) => w,
): TimedWord[] {
  const out: TimedWord[] = [];
  let t = t0;
  let i = 0;
  for (const line of text.split('\n')) {
    if (/^[[(]/.test(line)) { t += 4; continue; }
    for (const w of line.split(/\s+/).filter(Boolean)) {
      const c = corrupt(w, i++);
      if (c !== null) out.push({ text: c, start: t, end: t + step * 0.8 });
      t += step;
    }
  }
  return out;
}

describe('normalize', () => {
  it('strips punctuation and accents', () => {
    expect(normWord("I'm,")).toBe("i'm");
    expect(normWord('Café!')).toBe('cafe');
    expect(normWord('♪')).toBe('');
  });
  it('scores near-misses highly', () => {
    expect(similarity('lights', 'lites')).toBeGreaterThanOrEqual(0.7);
    expect(similarity('love', 'cat')).toBeLessThan(0.5);
    expect(phoneticKey('tryna')).toBe(phoneticKey('trina'));
  });
});

describe('alignLyrics', () => {
  it('recovers timings from a clean caption copy', () => {
    const asr = fakeAsr(LYRICS, 10, 0.5);
    const r = alignLyrics(LYRICS, asr, 60);
    expect(r.lowConfidence).toBe(false);
    expect(r.confidence).toBeGreaterThan(0.95);
    expect(r.lines).toHaveLength(8); // markers removed
    expect(r.lines[0].start).toBeCloseTo(10, 1);
    expect(r.lines[1].start).toBeCloseTo(10 + 4 * 0.5, 1);
  });

  it('survives mangled and missing ASR words', () => {
    const asr = fakeAsr(LYRICS, 5, 0.5, (w, i) => {
      if (i % 7 === 3) return null; // dropped
      if (i % 5 === 2) return w.slice(0, -1) + 'x'; // mis-heard
      if (i % 11 === 4) return 'blah'; // garbage
      return w;
    });
    const r = alignLyrics(LYRICS, asr, 60);
    expect(r.lowConfidence).toBe(false);
    expect(r.confidence).toBeGreaterThan(0.6);
    // monotonic line starts
    for (let i = 1; i < r.lines.length; i++) {
      expect(r.lines[i].start).toBeGreaterThanOrEqual(r.lines[i - 1].start);
    }
    // each repeated chorus line maps to its own occurrence, not the first one
    expect(r.lines[6].start).toBeGreaterThan(r.lines[5].start + 1);
    expect(r.lines[6].start).toBeGreaterThan(r.lines[4].start + 3);
  });

  it('keeps repeated choruses apart', () => {
    const asr = fakeAsr(LYRICS, 0, 0.5);
    const r = alignLyrics(LYRICS, asr, 60);
    expect(r.lines[6].start - r.lines[4].start).toBeGreaterThan(5);
  });

  it('handles captions that start late and end early', () => {
    const asr = fakeAsr(LYRICS, 30, 0.5).slice(8, -6);
    const r = alignLyrics(LYRICS, asr, 90);
    expect(r.lowConfidence).toBe(false);
    for (let i = 1; i < r.lines.length; i++) {
      expect(r.lines[i].start).toBeGreaterThanOrEqual(r.lines[i - 1].start);
    }
    // line 0 had its words dropped from captions: it must land before line 2
    expect(r.lines[0].start).toBeLessThan(r.lines[2].start);
  });

  it('falls back to an even spread when captions are garbage', () => {
    const asr: TimedWord[] = [
      { text: 'zzz', start: 5, end: 6 },
      { text: 'qqq', start: 6, end: 7 },
      { text: 'xxx', start: 80, end: 81 },
    ];
    const r = alignLyrics(LYRICS, asr, 90);
    expect(r.lowConfidence).toBe(true);
    expect(r.lines[0].start).toBeGreaterThanOrEqual(5);
    expect(r.lines.at(-1)!.start).toBeLessThan(81);
  });

  it('works with no captions at all', () => {
    const r = alignLyrics(LYRICS, [], 120);
    expect(r.lowConfidence).toBe(true);
    expect(r.lines).toHaveLength(8);
    expect(r.lines[0].start).toBe(0);
  });
});

describe('estimateOffset', () => {
  const lrc = LYRICS.split('\n')
    .filter((l) => !/^[[(]/.test(l))
    .map((text, i) => ({ text, start: i * 3, end: i * 3 + 3 }));

  it('detects a video intro shifting LRC timings', () => {
    // captions say line i starts at 12 + i*3 while LRC says i*3
    const asr: TimedWord[] = [];
    lrc.forEach((l, i) => {
      l.text.split(/\s+/).forEach((w, k) => asr.push({ text: w, start: 12 + i * 3 + k * 0.3, end: 12 + i * 3 + k * 0.3 + 0.25 }));
    });
    expect(estimateOffset(lrc, asr, 60)).toBeCloseTo(12, 0);
  });

  it('returns 0 when timings already agree', () => {
    const asr: TimedWord[] = [];
    lrc.forEach((l, i) => {
      l.text.split(/\s+/).forEach((w, k) => asr.push({ text: w, start: i * 3 + k * 0.3, end: i * 3 + k * 0.3 + 0.25 }));
    });
    expect(estimateOffset(lrc, asr, 60)).toBe(0);
  });
});
