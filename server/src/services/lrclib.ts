import type { LyricLine } from '../types.js';

const BASE = 'https://lrclib.net/api';
const UA = 'musi-type/0.1 (https://github.com/local/musi-type)';

interface LrcRecord {
  trackName: string;
  artistName: string;
  duration: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

export interface LrclibResult {
  plain?: string;
  synced?: LyricLine[];
  duration: number;
  trackName: string;
  artistName: string;
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function parseLrc(lrc: string, duration: number): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    if (!text || /^[♪♫♬\s]+$/.test(text)) continue;
    for (const s of stamps) {
      const t = Number(s[1]) * 60 + Number(s[2]);
      lines.push({ text, start: t, end: t });
    }
  }
  lines.sort((a, b) => a.start - b.start);
  lines.forEach((l, i) => {
    l.end = lines[i + 1]?.start ?? (duration ? Math.max(l.start, duration) : l.start + 4);
  });
  return lines;
}

function toResult(r: LrcRecord): LrclibResult | null {
  if (r.instrumental) return null;
  const synced = r.syncedLyrics ? parseLrc(r.syncedLyrics, r.duration) : undefined;
  const plain = r.plainLyrics?.trim() || undefined;
  if (!synced?.length && !plain) return null;
  return { plain, synced: synced?.length ? synced : undefined, duration: r.duration, trackName: r.trackName, artistName: r.artistName };
}

/** Prefer a record whose duration is close to the video's and that has synced lyrics. */
function pick(records: LrcRecord[], duration: number): LrcRecord | null {
  const scored = records
    .filter((r) => !r.instrumental && (r.syncedLyrics || r.plainLyrics))
    .map((r) => {
      const diff = duration ? Math.abs(r.duration - duration) : 0;
      return { r, score: (r.syncedLyrics ? 0 : 6) + Math.min(diff, 30) };
    })
    .sort((a, b) => a.score - b.score);
  return scored[0]?.r ?? null;
}

export async function fetchLrclib(artist: string, track: string, duration: number): Promise<LrclibResult | null> {
  const q = new URLSearchParams({ track_name: track, artist_name: artist });
  if (duration) q.set('duration', String(Math.round(duration)));
  const exact = await getJson<LrcRecord>(`${BASE}/get?${q}`);
  if (exact) {
    const r = toResult(exact);
    if (r) return r;
  }
  const s = new URLSearchParams({ track_name: track, artist_name: artist });
  let found = await getJson<LrcRecord[]>(`${BASE}/search?${s}`);
  if (!found?.length) found = await getJson<LrcRecord[]>(`${BASE}/search?${new URLSearchParams({ q: `${artist} ${track}` })}`);
  const best = found?.length ? pick(found, duration) : null;
  return best ? toResult(best) : null;
}
