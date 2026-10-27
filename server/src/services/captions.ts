import type { LyricLine, TimedWord } from '../types.js';

export interface ParsedCaptions {
  /** line-level cues (what the captioner grouped together) */
  cues: LyricLine[];
  /** word-level timings; exact for json3 auto-captions, interpolated otherwise */
  words: TimedWord[];
}

const NOISE_CUE = /^[\s♪♫♬]*$|^\[[^\]]*\]$|^\([^)]*\)$/;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function tidy(s: string): string {
  return decodeEntities(s).replace(/[♪♫♬]/g, '').replace(/\s+/g, ' ').trim();
}

/** Spread a cue's words evenly over [start,end] when no per-word timing exists. */
function spreadWords(text: string, start: number, end: number): TimedWord[] {
  const parts = text.split(/\s+/).filter(Boolean);
  if (!parts.length) return [];
  const total = parts.reduce((s, p) => s + p.length + 1, 0);
  const span = Math.max(0.1, end - start);
  let acc = 0;
  return parts.map((p) => {
    const ws = start + (span * acc) / total;
    acc += p.length + 1;
    return { text: p, start: ws, end: start + (span * acc) / total };
  });
}

function dedupeWords(words: TimedWord[]): TimedWord[] {
  const sorted = [...words].sort((a, b) => a.start - b.start);
  const seen = new Set<string>();
  const out: TimedWord[] = [];
  for (const w of sorted) {
    const key = `${w.text.toLowerCase()}@${Math.round(w.start * 20)}`; // 50 ms buckets
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  // tighten each word's end to the next word's start (rolling captions overlap)
  for (let i = 0; i < out.length - 1; i++) {
    out[i].end = Math.min(out[i].end, Math.max(out[i].start + 0.05, out[i + 1].start));
  }
  return out;
}

interface Json3Seg { utf8?: string; tOffsetMs?: number }
interface Json3Event { tStartMs?: number; dDurationMs?: number; segs?: Json3Seg[] }

export function parseJson3(content: string): ParsedCaptions {
  const data = JSON.parse(content.replace(/^﻿/, '')) as { events?: Json3Event[] };
  const cues: LyricLine[] = [];
  const words: TimedWord[] = [];

  for (const ev of data.events ?? []) {
    if (!ev.segs || ev.tStartMs === undefined) continue;
    const start = ev.tStartMs / 1000;
    const end = start + (ev.dDurationMs ?? 0) / 1000;
    const text = tidy(ev.segs.map((s) => s.utf8 ?? '').join(''));
    if (!text || NOISE_CUE.test(text)) continue;
    cues.push({ text, start, end });

    const wordLevel = ev.segs.length > 1 && ev.segs.some((s) => s.tOffsetMs !== undefined);
    if (wordLevel) {
      const segs = ev.segs.filter((s) => (s.utf8 ?? '').trim() && !NOISE_CUE.test(tidy(s.utf8 ?? '')));
      segs.forEach((s, i) => {
        const ws = start + (s.tOffsetMs ?? 0) / 1000;
        const next = segs[i + 1];
        const we = next ? start + (next.tOffsetMs ?? 0) / 1000 : Math.max(end, ws + 0.3);
        for (const w of spreadWords(tidy(s.utf8!), ws, Math.max(we, ws + 0.1))) words.push(w);
      });
    } else {
      for (const w of spreadWords(text, start, end)) words.push(w);
    }
  }
  return { cues, words: dedupeWords(words) };
}

function parseTimestamp(s: string): number {
  const m = s.trim().match(/^(?:(\d+):)?(\d+):(\d+)[.,](\d+)$/);
  if (!m) return NaN;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(`0.${m[4]}`);
}

export function parseVtt(content: string): ParsedCaptions {
  const cues: LyricLine[] = [];
  const words: TimedWord[] = [];
  const blocks = content.replace(/^﻿/, '').split(/\r?\n\r?\n/);
  let prevLast = '';

  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) continue;
    const [a, b] = lines[ti].split('-->');
    const start = parseTimestamp(a);
    const end = parseTimestamp(b.trim().split(/\s+/)[0]);
    if (Number.isNaN(start) || Number.isNaN(end) || end - start < 0.1) continue; // rolling-caption stubs

    let body = lines.slice(ti + 1);
    const plain = body.map((l) => tidy(l.replace(/<[^>]+>/g, '')));
    if (plain.length > 1 && plain[0] && plain[0] === prevLast) body = body.slice(1);
    prevLast = plain.filter(Boolean).at(-1) ?? prevLast;

    const raw = body.join(' ');
    const text = tidy(raw.replace(/<[^>]+>/g, ''));
    if (!text || NOISE_CUE.test(text)) continue;
    cues.push({ text, start, end });

    // YouTube VTT can carry inline word timestamps: "<00:00:01.240><c> word</c>"
    if (/<\d+:\d+:\d+\.\d+>/.test(raw)) {
      const re = /(?:<(\d+:\d+:\d+\.\d+)>)?<c[^>]*>([^<]*)<\/c>|^([^<]+)/g;
      const found: { t: number; w: string }[] = [];
      let cur = start;
      let m: RegExpExecArray | null;
      while ((m = re.exec(raw))) {
        if (m[1]) cur = parseTimestamp(m[1]);
        const w = tidy(m[2] ?? m[3] ?? '');
        if (w) found.push({ t: cur, w });
      }
      found.forEach((f, i) => {
        const we = found[i + 1]?.t ?? end;
        for (const w of spreadWords(f.w, f.t, Math.max(we, f.t + 0.1))) words.push(w);
      });
    } else {
      for (const w of spreadWords(text, start, end)) words.push(w);
    }
  }
  return { cues, words: dedupeWords(words) };
}

export function parseCaptions(ext: string, content: string): ParsedCaptions {
  return ext === 'json3' ? parseJson3(content) : parseVtt(content);
}
