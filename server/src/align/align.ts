import type { LyricLine, TimedWord } from '../types.js';
import { cleanLyricLine, normWord, similarity, splitWords } from './normalize.js';

interface Token {
  line: number;
  raw: string;
  norm: string;
  time?: number; // anchored start
  dur: number; // estimated spoken duration
  anchored: boolean;
}

export interface AlignResult {
  lines: LyricLine[];
  /** share of real lyric words that were matched to caption words (0..1) */
  confidence: number;
  lowConfidence: boolean;
  /** per line: was its first matchable word anchored to a caption word */
  lineAnchored: boolean[];
}

const MATCH_THRESHOLD = 0.6;
const GAP = -0.4;
const MISMATCH = -1;
const LOW_CONFIDENCE = 0.25;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const naturalDur = (norm: string) => clamp(0.15 + norm.length * 0.07, 0.2, 0.9);

function tokenize(lyrics: string): { lines: string[]; tokens: Token[] } {
  const lines = lyrics
    .split(/\r?\n/)
    .map(cleanLyricLine)
    .filter(Boolean);
  const tokens: Token[] = [];
  lines.forEach((text, line) => {
    for (const raw of splitWords(text)) {
      const norm = normWord(raw);
      tokens.push({ line, raw, norm, dur: naturalDur(norm), anchored: false });
    }
  });
  return { lines, tokens };
}

/**
 * Semi-global Needleman-Wunsch: free leading/trailing gaps (captions often have
 * an intro/outro the lyrics don't, and vice versa), cheap interior gaps.
 */
function matchTokens(tokens: Token[], asr: TimedWord[], asrNorm: string[]): void {
  const real = tokens.map((t, i) => (t.norm ? i : -1)).filter((i) => i >= 0);
  const n = real.length;
  const m = asr.length;
  if (!n || !m) return;
  const W = m + 1;
  const score = new Float32Array((n + 1) * W);
  const dir = new Uint8Array((n + 1) * W); // 1 diag, 2 up (skip lyric), 3 left (skip asr)

  for (let i = 1; i <= n; i++) {
    const a = tokens[real[i - 1]].norm;
    for (let j = 1; j <= m; j++) {
      const sim = similarity(a, asrNorm[j - 1]);
      const diagScore = sim >= MATCH_THRESHOLD ? 3 * sim - 1 : MISMATCH;
      const diag = score[(i - 1) * W + (j - 1)] + diagScore;
      const up = score[(i - 1) * W + j] + GAP;
      const left = score[i * W + (j - 1)] + GAP;
      let best = diag;
      let d = 1;
      if (up > best) { best = up; d = 2; }
      if (left > best) { best = left; d = 3; }
      score[i * W + j] = best;
      dir[i * W + j] = d;
    }
  }

  // best end cell on the last row or column (free trailing gaps)
  let bi = n, bj = m, best = -Infinity;
  for (let j = 0; j <= m; j++) if (score[n * W + j] > best) { best = score[n * W + j]; bi = n; bj = j; }
  for (let i = 0; i <= n; i++) if (score[i * W + m] > best) { best = score[i * W + m]; bi = i; bj = m; }

  let i = bi, j = bj;
  while (i > 0 && j > 0) {
    const d = dir[i * W + j];
    if (d === 1) {
      const tok = tokens[real[i - 1]];
      const sim = similarity(tok.norm, asrNorm[j - 1]);
      if (sim >= MATCH_THRESHOLD) {
        tok.time = asr[j - 1].start;
        tok.dur = clamp(asr[j - 1].end - asr[j - 1].start, 0.15, 1.0);
        tok.anchored = true;
      }
      i--; j--;
    } else if (d === 2) i--;
    else j--;
  }
}

/** Drop anchors that go backwards in time (bad dedupe / odd captions). */
function enforceMonotonic(tokens: Token[]): void {
  let last = -Infinity;
  for (const t of tokens) {
    if (!t.anchored) continue;
    if (t.time! < last) { t.anchored = false; t.time = undefined; }
    else last = t.time!;
  }
}

function fillGaps(tokens: Token[], duration: number): void {
  const anchors = tokens.map((t, i) => (t.anchored ? i : -1)).filter((i) => i >= 0);
  if (!anchors.length) return;

  // average seconds per word across the anchored span (clamped), used for the edges
  const first = anchors[0], last = anchors[anchors.length - 1];
  const spanWords = Math.max(1, last - first);
  const avg = clamp((tokens[last].time! - tokens[first].time!) / spanWords, 0.2, 0.8);

  // before the first anchor: pack backwards
  let t = tokens[first].time!;
  for (let k = first - 1; k >= 0; k--) {
    t = Math.max(0, t - Math.min(avg, tokens[k].dur));
    tokens[k].time = t;
  }
  // after the last anchor: pack forwards
  t = tokens[last].time! + tokens[last].dur;
  for (let k = last + 1; k < tokens.length; k++) {
    tokens[k].time = Math.min(t, duration || t);
    t += Math.min(avg, tokens[k].dur);
  }

  // interior runs between consecutive anchors
  for (let a = 0; a < anchors.length - 1; a++) {
    const ia = anchors[a], ib = anchors[a + 1];
    if (ib - ia <= 1) continue;
    const run = tokens.slice(ia + 1, ib);
    const ta = tokens[ia].time! + tokens[ia].dur;
    const tb = tokens[ib].time!;
    const span = Math.max(0, tb - ta);
    const total = run.reduce((s, r) => s + r.dur, 0);
    const scale = total > span && total > 0 ? span / total : 1;

    // words continuing a's line flow right after it; words leading into b's line
    // end right at b; the slack (an instrumental gap, say) falls between them
    const lineA = tokens[ia].line, lineB = tokens[ib].line;
    const head = run.filter((r) => r.line === lineA || (lineA === lineB));
    const tail = lineA === lineB ? [] : run.filter((r) => r.line === lineB);
    const mid = run.filter((r) => !head.includes(r) && !tail.includes(r));
    const headLen = [...head, ...mid].reduce((s, r) => s + r.dur * scale, 0);
    const tailLen = tail.reduce((s, r) => s + r.dur * scale, 0);

    let cur = ta;
    for (const r of [...head, ...mid]) { r.time = cur; cur += r.dur * scale; }
    cur = Math.max(ta + headLen, tb - tailLen);
    for (const r of tail) { r.time = cur; cur += r.dur * scale; }
  }
}

function spreadEvenly(tokens: Token[], start: number, end: number): void {
  const total = tokens.reduce((s, t) => s + Math.max(1, t.raw.length), 0) || 1;
  let acc = 0;
  for (const t of tokens) {
    t.time = start + ((end - start) * acc) / total;
    acc += Math.max(1, t.raw.length);
  }
}

export function alignLyrics(lyrics: string, asr: TimedWord[], duration: number): AlignResult {
  const { lines, tokens } = tokenize(lyrics);
  if (!lines.length) return { lines: [], confidence: 0, lowConfidence: true, lineAnchored: [] };

  const cleanAsr = asr.filter((w) => normWord(w.text));
  const asrNorm = cleanAsr.map((w) => normWord(w.text));
  matchTokens(tokens, cleanAsr, asrNorm);
  enforceMonotonic(tokens);

  const realTokens = tokens.filter((t) => t.norm);
  const anchored = realTokens.filter((t) => t.anchored).length;
  const confidence = realTokens.length ? anchored / realTokens.length : 0;
  const lowConfidence = confidence < LOW_CONFIDENCE;

  if (lowConfidence) {
    const start = cleanAsr.length ? cleanAsr[0].start : 0;
    const end = cleanAsr.length ? cleanAsr[cleanAsr.length - 1].end : duration;
    spreadEvenly(tokens, start, Math.max(end, start + 1));
  } else {
    fillGaps(tokens, duration);
  }

  const out: LyricLine[] = [];
  const lineAnchored: boolean[] = [];
  let prevStart = 0;
  lines.forEach((text, li) => {
    const lt = tokens.filter((t) => t.line === li);
    const times = lt.map((t) => t.time ?? prevStart);
    const start = Math.max(prevStart, Math.min(...times));
    prevStart = start;
    out.push({ text, start, end: start });
    lineAnchored.push(lt.find((t) => t.norm)?.anchored ?? false);
  });
  out.forEach((l, i) => {
    const next = out[i + 1]?.start;
    const lastTok = tokens.filter((t) => t.line === i).at(-1)!;
    const natural = (lastTok.time ?? l.start) + lastTok.dur;
    l.end = Math.max(l.start, next ?? (duration ? Math.min(natural, duration) : natural));
  });

  return { lines: out, confidence, lowConfidence, lineAnchored };
}

/**
 * LRCLIB synced lyrics are timed for the studio track; a video may have an intro
 * or a different edit. Compare against caption anchors and shift if clearly off.
 */
export function estimateOffset(lrc: LyricLine[], asr: TimedWord[], duration: number): number {
  if (!lrc.length || !asr.length) return 0;
  const res = alignLyrics(lrc.map((l) => l.text).join('\n'), asr, duration);
  if (res.lowConfidence || res.confidence < 0.4) return 0;
  const deltas: number[] = [];
  res.lines.forEach((l, i) => {
    if (res.lineAnchored[i]) deltas.push(l.start - lrc[i].start);
  });
  if (deltas.length < 4) return 0;
  deltas.sort((a, b) => a - b);
  const median = deltas[Math.floor(deltas.length / 2)];
  return Math.abs(median) >= 0.8 ? median : 0;
}
