import { describe, expect, it } from 'vitest';
import { parseJson3, parseVtt } from './captions.js';
import { extractLyrics } from './genius.js';
import { parseLrc } from './lrclib.js';
import { normalizeCues } from './song.js';
import { guessTrack, stripNoise } from './titleClean.js';

describe('parseJson3', () => {
  it('reads word-level auto captions and skips noise cues', () => {
    const json = JSON.stringify({
      events: [
        { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: '♪♪♪' }] },
        {
          tStartMs: 1000,
          dDurationMs: 3000,
          segs: [{ utf8: 'Paper', tOffsetMs: 0 }, { utf8: ' boats', tOffsetMs: 500 }, { utf8: ' drift', tOffsetMs: 1000 }, { utf8: ' home', tOffsetMs: 1800 }],
        },
        { tStartMs: 4000, dDurationMs: 500, segs: [{ utf8: '\n' }] },
        { tStartMs: 5000, dDurationMs: 2000, segs: [{ utf8: 'over the town' }] },
      ],
    });
    const r = parseJson3(json);
    expect(r.cues.map((c) => c.text)).toEqual(['Paper boats drift home', 'over the town']);
    expect(r.words.slice(0, 4).map((w) => [w.text, w.start])).toEqual([['Paper', 1], ['boats', 1.5], ['drift', 2], ['home', 2.8]]);
    // cue without per-word timing is spread across its duration
    const own = r.words.filter((w) => w.start >= 5);
    expect(own.map((w) => w.text)).toEqual(['over', 'the', 'town']);
    expect(own[2].start).toBeLessThan(7);
  });

  it('drops duplicate words from rolling captions', () => {
    const ev = { tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: 'hello', tOffsetMs: 0 }, { utf8: ' world', tOffsetMs: 400 }] };
    const r = parseJson3(JSON.stringify({ events: [ev, { ...ev }] }));
    expect(r.words).toHaveLength(2);
  });
});

describe('parseVtt', () => {
  const vtt = `WEBVTT
Kind: captions

00:00:29.200 --> 00:00:49.166
♪♪♪

00:00:49.200 --> 00:00:50.633
♪ PAPER BOATS DRIFT HOME ♪

00:00:50.640 --> 00:00:50.650
♪ PAPER BOATS DRIFT HOME ♪

00:00:52.133 --> 00:00:54.633
♪ OVER THE SLEEPING
TOWN BELOW ♪
`;
  it('parses cues, ignores music-only and stub cues', () => {
    const r = parseVtt(vtt);
    expect(r.cues.map((c) => c.text)).toEqual(['PAPER BOATS DRIFT HOME', 'OVER THE SLEEPING TOWN BELOW']);
    expect(r.words[0].start).toBeCloseTo(49.2, 1);
    expect(r.words).toHaveLength(4 + 5);
  });

  it('uses inline word timestamps when present', () => {
    const r = parseVtt(`WEBVTT

00:00:01.000 --> 00:00:04.000
<c> hello</c><00:00:02.000><c> big</c><00:00:03.000><c> world</c>
`);
    expect(r.words.map((w) => [w.text, w.start])).toEqual([['hello', 1], ['big', 2], ['world', 3]]);
  });
});

describe('normalizeCues', () => {
  it('makes overlapping cues end where the next begins', () => {
    const out = normalizeCues([
      { text: 'a', start: 0, end: 5 },
      { text: 'b', start: 2, end: 6 },
      { text: 'b', start: 3, end: 7 },
      { text: 'c', start: 4, end: 9 },
    ]);
    expect(out.map((l) => [l.text, l.start, l.end])).toEqual([['a', 0, 2], ['b', 2, 4], ['c', 4, 9]]);
  });
});

describe('parseLrc', () => {
  it('handles multiple stamps per line and skips empty lines', () => {
    const lines = parseLrc('[00:01.50]hello\n[00:03.00][00:10.25]chorus\n[00:05.00]\n[00:06.00]♪', 20);
    expect(lines.map((l) => [l.text, l.start])).toEqual([['hello', 1.5], ['chorus', 3], ['chorus', 10.25]]);
    expect(lines[0].end).toBe(3);
    expect(lines.at(-1)!.end).toBe(20);
  });
});

describe('guessTrack', () => {
  it('uses YouTube Music metadata when present', () => {
    expect(guessTrack({ title: 'x', track: 'Song (Remastered)', artist: 'A, B' })).toEqual({ track: 'Song', artist: 'A' });
  });
  it('splits "Artist - Title (Official Video)"', () => {
    expect(guessTrack({ title: 'The Weeknd - Blinding Lights (Official Video)' })).toEqual({ artist: 'The Weeknd', track: 'Blinding Lights' });
    expect(guessTrack({ title: 'Ed Sheeran - Shape of You (Official Music Video)' })).toEqual({ artist: 'Ed Sheeran', track: 'Shape of You' });
  });
  it('falls back to the channel name', () => {
    expect(guessTrack({ title: 'Hello', channel: 'Adele - Topic' })).toEqual({ artist: 'Adele', track: 'Hello' });
  });
  it('strips noise tags', () => {
    expect(stripNoise('Song [Lyrics]')).toBe('Song');
  });
});

describe('extractLyrics (Genius html)', () => {
  it('collects text from lyric containers with nested tags', () => {
    const html = `<div class="x"><div data-lyrics-container="true" class="Lyrics">Line one<br/>Line <a href="#"><span>two</span></a><br/>[Chorus]<br/>Line three &amp; more<div class="inner">x</div></div></div><div>other</div>`;
    const text = extractLyrics(html);
    expect(text).toContain('Line one\nLine two\n[Chorus]\nLine three & more');
    expect(text).not.toContain('other');
  });
});
