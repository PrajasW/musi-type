import { readCache, writeCache } from '../cache.js';
import { alignLyrics, estimateOffset, type AlignResult } from '../align/align.js';
import type { LyricLine, SongData, SourceOptions, TimedWord } from '../types.js';
import type { ParsedCaptions } from './captions.js';
import { readAudioWords } from './audio.js';
import { createHash } from 'node:crypto';
import { fetchGenius, GENIUS_MESSAGES, type GeniusResult } from './genius.js';
import { fetchLrclib, type LrclibResult } from './lrclib.js';
import { guessTrack, trackVariants } from './titleClean.js';
import { getCaptions, getMetadata } from './ytdlp.js';

/** Everything fetched from the network for a video; source options are applied on top. */
interface RawSong {
  videoId: string;
  title: string;
  artist: string;
  track: string;
  duration: number;
  manual?: ParsedCaptions;
  auto?: ParsedCaptions;
  lrclib: LrclibResult | null;
  /** word timings recognised from the audio (optional, cached separately) */
  audio?: TimedWord[];
}

const rawKey = (id: string) => `raw-${id}`;

/**
 * Genius lyrics are fetched with the requesting user's own token, so they are never written to the
 * shared disk cache (that would hand one user's lookup to everyone). They are kept in memory for a
 * short while, per token, so retries and reloads by the same user don't hit Genius again.
 */
const GENIUS_TTL_MS = 60 * 60_000;
const GENIUS_MAX_ENTRIES = 200;
const geniusMemo = new Map<string, { at: number; result: GeniusResult }>();
const tokenId = (token: string) => createHash('sha256').update(token).digest('hex').slice(0, 16);

async function geniusFor(raw: RawSong, token: string | undefined): Promise<GeniusResult> {
  if (!token) return { ok: false, reason: 'no-token' };
  const key = `${tokenId(token)}:${raw.videoId}`;
  const hit = geniusMemo.get(key);
  if (hit && Date.now() - hit.at < GENIUS_TTL_MS) return hit.result;
  const result = await fetchGenius(raw.artist, trackVariants(raw.track), token);
  // remember successes and definite misses, but not transient failures
  if (result.ok || result.reason === 'no-match') {
    if (geniusMemo.size >= GENIUS_MAX_ENTRIES) geniusMemo.delete(geniusMemo.keys().next().value!);
    geniusMemo.set(key, { at: Date.now(), result });
  }
  return result;
}
const DURATION_TOLERANCE = 5; // seconds between LRCLIB's studio length and the video's

async function loadRaw(videoId: string, refresh: boolean): Promise<RawSong> {
  const raw = await fetchRaw(videoId, refresh);
  raw.audio = (await readAudioWords(videoId))?.words; // kept apart so a refresh doesn't drop it
  return raw;
}

async function fetchRaw(videoId: string, refresh: boolean): Promise<RawSong> {
  if (!refresh) {
    const hit = await readCache<RawSong>(rawKey(videoId));
    if (hit) return hit;
  }
  const meta = await getMetadata(videoId);
  const { artist, track } = guessTrack(meta);
  const [captions, lrclib] = await Promise.all([
    getCaptions(videoId, meta),
    fetchLrclib(artist, track, meta.duration).catch(() => null),
  ]);
  const raw: RawSong = {
    videoId,
    title: meta.title,
    artist,
    track,
    duration: meta.duration,
    manual: captions.manual,
    auto: captions.auto,
    lrclib,
  };
  await writeCache(rawKey(videoId), raw);
  return raw;
}

function timingSources(raw: RawSong, opts: SourceOptions): { name: string; words: TimedWord[] }[] {
  const out: { name: string; words: TimedWord[] }[] = [];
  if (opts.ytManual && raw.manual?.words.length) out.push({ name: 'manual', words: raw.manual.words });
  if (raw.auto?.words.length) out.push({ name: 'auto', words: raw.auto.words });
  if (raw.audio?.length) out.push({ name: 'audio', words: raw.audio });
  return out;
}

/** Align against every caption track and keep the best-anchored result. */
function bestAlign(text: string, raw: RawSong, opts: SourceOptions): AlignResult {
  let best: AlignResult | undefined;
  for (const src of timingSources(raw, opts)) {
    const r = alignLyrics(text, src.words, raw.duration);
    if (!best || r.confidence > best.confidence) best = r;
  }
  return best ?? alignLyrics(text, [], raw.duration);
}

function build(raw: RawSong, partial: Pick<SongData, 'lines' | 'source' | 'confidence'> & Partial<SongData>): SongData {
  return {
    videoId: raw.videoId,
    title: raw.track || raw.title,
    artist: raw.artist,
    duration: raw.duration,
    lowConfidence: false,
    needsLyrics: false,
    audioSynced: Boolean(raw.audio?.length),
    warnings: [],
    ...partial,
  };
}

function fromAligned(raw: RawSong, r: AlignResult, source: SongData['source']): SongData {
  const warnings: string[] = [];
  if (r.lowConfidence) {
    warnings.push(
      "Couldn't line the lyrics up with the video's captions, so timings are approximate. Use the offset buttons, or paste different lyrics.",
    );
  }
  return build(raw, { lines: r.lines, source, confidence: r.confidence, lowConfidence: r.lowConfidence, warnings });
}

/** Caption cues overlap (rolling captions); make each line last until the next starts. */
export function normalizeCues(cues: LyricLine[]): LyricLine[] {
  const sorted = [...cues].sort((a, b) => a.start - b.start);
  const out: LyricLine[] = [];
  for (const c of sorted) {
    if (out.at(-1)?.text === c.text) continue;
    out.push({ ...c });
  }
  out.forEach((l, i) => {
    const next = out[i + 1]?.start;
    l.end = next !== undefined ? Math.max(l.start, next) : Math.max(l.start, l.end);
  });
  return out;
}

function shift(lines: LyricLine[], by: number, duration: number): LyricLine[] {
  return lines.map((l) => ({
    ...l,
    start: Math.max(0, l.start + by),
    end: Math.min(duration || Infinity, Math.max(0, l.end + by)),
  }));
}

function resolve(raw: RawSong, opts: SourceOptions, genius?: GeniusResult): SongData {
  const sources = timingSources(raw, opts);
  const lr = opts.lrclib ? raw.lrclib : null;

  if (lr?.synced) {
    const durationOk = !raw.duration || Math.abs(lr.duration - raw.duration) <= DURATION_TOLERANCE;
    if (durationOk) {
      const warnings: string[] = [];
      let lines = lr.synced;
      // first caption track (manual before auto) that confidently disagrees with LRCLIB's timing wins
      const offset = sources.map((s) => estimateOffset(lr.synced!, s.words, raw.duration)).find((v) => v !== 0) ?? 0;
      if (offset) {
        lines = shift(lines, offset, raw.duration);
        warnings.push(`Lyrics timing shifted by ${offset.toFixed(1)}s to match this video.`);
      }
      return build(raw, { lines, source: 'lrclib-synced', confidence: 1, warnings });
    }
  }

  const lrText = lr ? lr.plain ?? lr.synced?.map((l) => l.text).join('\n') : undefined;
  if (lrText) return fromAligned(raw, bestAlign(lrText, raw, opts), 'lrclib-aligned');

  if (genius?.ok) return fromAligned(raw, bestAlign(genius.text, raw, opts), 'genius-aligned');

  if (opts.ytManual && raw.manual?.cues.length) {
    return build(raw, {
      lines: normalizeCues(raw.manual.cues),
      source: 'yt-manual',
      confidence: 1,
      warnings: [
        "No lyrics found online, so the video's own captions are used as the lyrics. Their wording and timing can be rough: paste the lyrics for a better match.",
        ...(opts.genius && genius && !genius.ok ? [GENIUS_MESSAGES[genius.reason]] : []),
      ],
    });
  }

  const warnings = [
    'No lyrics found online for this video. Paste the lyrics and they will be lined up with the video.',
  ];
  // say why Genius didn't help, so a failure is visible instead of silently falling back to captions
  if (opts.genius && genius && !genius.ok) warnings.push(GENIUS_MESSAGES[genius.reason]);
  if (raw.auto?.cues.length) {
    return build(raw, {
      lines: normalizeCues(raw.auto.cues),
      source: 'yt-auto',
      confidence: 0.3,
      lowConfidence: true,
      needsLyrics: true,
      warnings: [...warnings, 'Showing YouTube auto-captions meanwhile; they are often wrong.'],
    });
  }
  return build(raw, { lines: [], source: 'none', confidence: 0, lowConfidence: true, needsLyrics: true, warnings });
}

export async function getSong(videoId: string, opts: SourceOptions, refresh = false): Promise<SongData> {
  const raw = await loadRaw(videoId, refresh);
  // Genius is only worth a (slow, scraped) request when nothing better exists, and only with the user's own token
  const lrUsable = opts.lrclib && raw.lrclib;
  const genius = opts.genius && !lrUsable ? await geniusFor(raw, opts.geniusToken) : undefined;
  return resolve(raw, opts, genius);
}

export async function alignPasted(videoId: string, lyrics: string, opts: SourceOptions): Promise<SongData> {
  const raw = await loadRaw(videoId, false);
  return fromAligned(raw, bestAlign(lyrics, raw, opts), 'paste-aligned');
}

/** Best known lyrics text for a video (used to prompt Whisper), or undefined. */
export async function knownLyrics(videoId: string): Promise<string | undefined> {
  const raw = await loadRaw(videoId, false);
  return raw.lrclib?.plain ?? raw.lrclib?.synced?.map((l) => l.text).join('\n') ?? undefined;
}

/** Length of the video in seconds (used to refuse audio sync on very long videos). */
export async function songDuration(videoId: string): Promise<number> {
  return (await loadRaw(videoId, false)).duration;
}
