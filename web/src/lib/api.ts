import type { Settings } from './settings';
import type { SongData } from './types';

function sourceParams(s: Settings): URLSearchParams {
  return new URLSearchParams({
    ytManual: s.sources.ytManual ? '1' : '0',
    lrclib: s.sources.lrclib ? '1' : '0',
    genius: s.sources.genius ? '1' : '0',
  });
}

const headers = (s: Settings): Record<string, string> => (s.geniusToken ? { 'x-genius-token': s.geniusToken } : {});

async function parse(res: Response): Promise<SongData> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as SongData;
}

export async function fetchSong(videoId: string, settings: Settings, refresh = false): Promise<SongData> {
  const q = sourceParams(settings);
  q.set('v', videoId);
  if (refresh) q.set('refresh', '1');
  return parse(await fetch(`/api/song?${q}`, { headers: headers(settings) }));
}

export async function alignLyrics(videoId: string, lyrics: string, settings: Settings): Promise<SongData> {
  const res = await fetch('/api/align', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers(settings) },
    body: JSON.stringify({ videoId, lyrics, sources: settings.sources }),
  });
  return parse(res);
}

/** Pull the 11-char video id out of any YouTube URL (or a bare id). */
export function parseVideoId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(/^https?:\/\//.test(s) ? s : `https://${s}`);
    const host = u.hostname.replace(/^(www|m|music)\./, '');
    if (host === 'youtu.be') return u.pathname.slice(1, 12) || null;
    if (host.endsWith('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v && /^[\w-]{11}$/.test(v)) return v;
      const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/);
      if (m) return m[1];
    }
  } catch {
    /* not a URL */
  }
  return null;
}

export interface AudioStatus {
  available: boolean;
  /** word timings from the audio are cached for this video */
  done: boolean;
  state: 'idle' | 'running' | 'done' | 'error';
  stage?: 'downloading' | 'transcribing';
  progress: number;
  error?: string;
}

export async function getAudioStatus(videoId: string): Promise<AudioStatus> {
  const res = await fetch(`/api/audio-sync?v=${encodeURIComponent(videoId)}`);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as AudioStatus;
}

export async function startAudioSync(videoId: string, lyrics?: string): Promise<AudioStatus> {
  const res = await fetch('/api/audio-sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ videoId, lyrics }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as AudioStatus;
}
