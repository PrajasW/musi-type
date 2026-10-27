import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { readCache, writeCache } from '../cache.js';
import type { TimedWord } from '../types.js';
import { downloadAudio } from './ytdlp.js';

const exec = promisify(execFile);
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'transcribe.py');
const python = () => process.env.PYTHON_BIN ?? (process.platform === 'win32' ? 'python' : 'python3');
const model = () => process.env.WHISPER_MODEL ?? 'base';

export interface AudioWords {
  words: TimedWord[];
  model: string;
  language?: string;
}

export const audioKey = (id: string) => `audio-${id}`;
export const readAudioWords = (id: string) => readCache<AudioWords>(audioKey(id));

let available: Promise<boolean> | undefined;
/** Is faster-whisper importable? (It is an optional install.) */
export function whisperAvailable(): Promise<boolean> {
  available ??= exec(python(), ['-W', 'ignore', '-c', 'import faster_whisper'], { timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  return available;
}

export interface AudioJob {
  state: 'running' | 'done' | 'error';
  stage: 'downloading' | 'transcribing';
  progress: number; // 0..1
  error?: string;
}

const jobs = new Map<string, AudioJob>();
let busy: string | null = null;

export function audioJob(id: string): AudioJob | undefined {
  return jobs.get(id);
}

function transcribe(audioPath: string, hintFile: string | null, onProgress: (p: number) => void): Promise<AudioWords> {
  return new Promise((resolve, reject) => {
    const args = ['-W', 'ignore', SCRIPT, audioPath, '--model', model()];
    if (hintFile) args.push('--prompt-file', hintFile);
    const child = spawn(python(), args, { env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill(), 20 * 60_000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => {
      const text = String(d);
      err += text;
      for (const m of text.matchAll(/PROGRESS ([\d.]+)/g)) onProgress(Number(m[1]));
    });
    child.on('error', (e) => reject(e));
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const last = err.trim().split('\n').filter((l) => !l.startsWith('PROGRESS')).pop();
        return reject(
          new Error(code === 3 ? 'faster-whisper is not installed (pip install faster-whisper)' : `Audio recognition failed: ${last ?? `exit ${code}`}`),
        );
      }
      try {
        const j = JSON.parse(out) as { words: TimedWord[]; language?: string };
        resolve({ words: j.words, model: model(), language: j.language });
      } catch {
        reject(new Error('Audio recognition returned nothing usable'));
      }
    });
  });
}

/**
 * Download the audio and get word timings from Whisper. Runs in the background;
 * poll `audioJob`. One job at a time: it keeps every CPU core busy.
 * `lyricsHint` (if known) is used as Whisper's prompt so it favours the real words.
 */
export function startAudioSync(videoId: string, lyricsHint?: string): AudioJob {
  const existing = jobs.get(videoId);
  if (existing?.state === 'running') return existing;
  if (busy) throw new Error('Another song is being synced right now. Try again in a minute.');

  const job: AudioJob = { state: 'running', stage: 'downloading', progress: 0 };
  jobs.set(videoId, job);
  busy = videoId;

  void (async () => {
    const dir = await mkdtemp(join(tmpdir(), 'musi-audio-'));
    try {
      const file = await downloadAudio(videoId, dir);
      job.stage = 'transcribing';
      job.progress = 0.02;
      let hint: string | null = null;
      if (lyricsHint?.trim()) {
        hint = join(dir, 'lyrics.txt');
        await writeFile(hint, lyricsHint, 'utf8');
      }
      const result = await transcribe(file, hint, (p) => (job.progress = p));
      if (!result.words.length) throw new Error('No singing could be recognised in this audio');
      await writeCache(audioKey(videoId), result);
      job.state = 'done';
      job.progress = 1;
    } catch (e) {
      job.state = 'error';
      job.error = (e as Error).message;
    } finally {
      busy = null;
      await rm(dir, { recursive: true, force: true });
    }
  })();

  return job;
}
