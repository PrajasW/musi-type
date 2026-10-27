import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { parseCaptions, type ParsedCaptions } from './captions.js';

const exec = promisify(execFile);

interface CaptionFormat { ext: string; url: string }
export interface VideoMeta {
  id: string;
  title: string;
  duration: number;
  uploader?: string;
  channel?: string;
  track?: string;
  artist?: string;
  artists?: string[];
  language?: string;
  subtitles?: Record<string, CaptionFormat[]>;
  automatic_captions?: Record<string, CaptionFormat[]>;
}

let cmd: Promise<{ file: string; pre: string[] }> | undefined;

/** `yt-dlp` on PATH, else `python -m yt_dlp` (what `pip install yt-dlp` always gives you). */
function resolveCmd() {
  cmd ??= (async () => {
    if (process.env.YTDLP_BIN) return { file: process.env.YTDLP_BIN, pre: [] };
    try {
      await exec('yt-dlp', ['--version']);
      return { file: 'yt-dlp', pre: [] };
    } catch {
      return { file: process.env.PYTHON_BIN ?? (process.platform === 'win32' ? 'python' : 'python3'), pre: ['-W', 'ignore', '-m', 'yt_dlp'] };
    }
  })();
  return cmd;
}

async function run(args: string[], timeout = 90_000): Promise<string> {
  const { file, pre } = await resolveCmd();
  try {
    const { stdout } = await exec(file, [...pre, '--no-warnings', '--no-playlist', ...args], {
      maxBuffer: 64 * 1024 * 1024,
      timeout,
      env: { ...process.env, PYTHONWARNINGS: 'ignore', PYTHONIOENCODING: 'utf-8' },
    });
    return stdout;
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    throw new Error(`yt-dlp failed: ${(err.stderr || err.message).trim().split('\n').pop()}`);
  }
}

/** Official YouTube Data API v3. Used when YOUTUBE_API_KEY is set, so cloud hosts (Render etc.) aren't bot-blocked. */
async function getMetadataFromApi(videoId: string, key: string): Promise<VideoMeta> {
  const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${encodeURIComponent(videoId)}`;
  const res = await fetch(url, { headers: { 'X-goog-api-key': key } });
  if (!res.ok) throw new Error(`YouTube API failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { items?: any[] };
  const item = data.items?.[0];
  if (!item) throw new Error('Video not found');
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(item.contentDetails?.duration ?? '') ?? [];
  const [d, h, min, s] = [m[1], m[2], m[3], m[4]].map((v) => Number(v ?? 0));
  return {
    id: videoId,
    title: item.snippet?.title ?? '',
    duration: d * 86400 + h * 3600 + min * 60 + s,
    channel: item.snippet?.channelTitle,
    uploader: item.snippet?.channelTitle,
    language: item.snippet?.defaultAudioLanguage ?? item.snippet?.defaultLanguage,
  };
}

export async function getMetadata(videoId: string): Promise<VideoMeta> {
  const key = process.env.YOUTUBE_API_KEY;
  if (key) return getMetadataFromApi(videoId, key);
  const out = await run(['-J', '--skip-download', `https://www.youtube.com/watch?v=${videoId}`]);
  return JSON.parse(out) as VideoMeta;
}

export interface CaptionTracks {
  manual?: ParsedCaptions & { lang: string };
  auto?: ParsedCaptions & { lang: string };
}

function pickManualLang(meta: VideoMeta): string | undefined {
  const keys = Object.keys(meta.subtitles ?? {}).filter((k) => k !== 'live_chat');
  if (!keys.length) return undefined;
  const orig = meta.language?.split('-')[0];
  return (
    keys.find((k) => orig && k.startsWith(orig)) ??
    keys.find((k) => k.startsWith('en')) ??
    keys[0]
  );
}

function pickAutoLang(meta: VideoMeta): string | undefined {
  const keys = Object.keys(meta.automatic_captions ?? {});
  if (!keys.length) return undefined;
  return (
    keys.find((k) => k.endsWith('-orig')) ??
    keys.find((k) => meta.language && k === meta.language.split('-')[0]) ??
    keys.find((k) => k === 'en') ??
    undefined
  );
}

async function downloadTrack(videoId: string, lang: string, auto: boolean): Promise<(ParsedCaptions & { lang: string }) | undefined> {
  const dir = await mkdtemp(join(tmpdir(), 'musi-subs-'));
  try {
    await run([
      '--skip-download',
      auto ? '--write-auto-subs' : '--write-subs',
      '--sub-langs', lang,
      // json3 has word-level timing; vtt/srv fallbacks are line-level
      '--sub-format', 'json3/vtt/best',
      '-o', join(dir, '%(id)s.%(ext)s'),
      `https://www.youtube.com/watch?v=${videoId}`,
    ]);
    const files = await readdir(dir);
    const file = files.find((f) => f.endsWith('.json3')) ?? files[0];
    if (!file) return undefined;
    const ext = file.split('.').pop()!;
    const parsed = parseCaptions(ext, await readFile(join(dir, file), 'utf8'));
    return parsed.words.length ? { ...parsed, lang } : undefined;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function getCaptions(videoId: string, meta: VideoMeta): Promise<CaptionTracks> {
  const manualLang = pickManualLang(meta);
  const autoLang = pickAutoLang(meta);
  const [manual, auto] = await Promise.all([
    manualLang ? downloadTrack(videoId, manualLang, false).catch(() => undefined) : undefined,
    autoLang ? downloadTrack(videoId, autoLang, true).catch(() => undefined) : undefined,
  ]);
  return { manual, auto };
}

/** Best audio-only stream into `dir`; returns the file path. */
export async function downloadAudio(videoId: string, dir: string): Promise<string> {
  await run(
    ['-f', 'bestaudio[ext=m4a]/bestaudio', '-o', join(dir, 'audio.%(ext)s'), `https://www.youtube.com/watch?v=${videoId}`],
    10 * 60_000,
  );
  const file = (await readdir(dir)).find((f) => f.startsWith('audio.'));
  if (!file) throw new Error('Could not download the audio');
  return join(dir, file);
}
