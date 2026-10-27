import { readCache, writeCache } from '../cache.js';
import { alignLyrics, estimateOffset, type AlignResult } from '../align/align.js';
import type { LyricLine, SongData, SourceOptions, TimedWord } from '../types.js';
import type { ParsedCaptions } from './captions.js';
import { readAudioWords } from './audio.js';
import { fetchGenius } from './genius.js';
import { fetchLrclib, type LrclibResult } from './lrclib.js';
import { guessTrack } from './titleClean.js';
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
  genius?: string | null;
  /** word timings recognised from the audio (optional, cached separately) */
  audio?: TimedWord[];
}

const rawKey = (id: string) => `raw-${id}`;
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

function resolve(raw: RawSong, opts: SourceOptions): SongData {
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

  if (opts.genius && raw.genius) return fromAligned(raw, bestAlign(raw.genius, raw, opts), 'genius-aligned');

  if (opts.ytManual && raw.manual?.cues.length) {
    return build(raw, { lines: normalizeCues(raw.manual.cues), source: 'yt-manual', confidence: 1 });
  }

  const warnings = [
    'No lyrics found online for this video. Paste the lyrics and they will be lined up with the video.',
  ];
  if (opts.genius && raw.genius === undefined && !opts.geniusToken && !process.env.GENIUS_TOKEN) {
    warnings.push('Add a Genius API token in Settings to search Genius as well.');
  }
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

  // Genius is only worth a (slow, scraped) request when nothing better exists
  const lrUsable = opts.lrclib && raw.lrclib;
  const token = opts.geniusToken || process.env.GENIUS_TOKEN;
  if (opts.genius && token && !lrUsable && raw.genius === undefined) {
    raw.genius = await fetchGenius(raw.artist, raw.track, token);
    if (raw.genius) await writeCache(rawKey(videoId), raw);
    else raw.genius = null; // not persisted: a later try (or a new token) may succeed
  }
  return resolve(raw, opts);
}

export async function alignPasted(videoId: string, lyrics: string, opts: SourceOptions): Promise<SongData> {
  const raw = await loadRaw(videoId, false);
  return fromAligned(raw, bestAlign(lyrics, raw, opts), 'paste-aligned');
}

/** Best known lyrics text for a video (used to prompt Whisper), or undefined. */
export async function knownLyrics(videoId: string): Promise<string | undefined> {
  const raw = await loadRaw(videoId, false);
  return raw.lrclib?.plain ?? raw.lrclib?.synced?.map((l) => l.text).join('\n') ?? raw.genius ?? undefined;
}
