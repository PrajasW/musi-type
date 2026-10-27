import { Router, type Request } from 'express';
import { DEFAULT_SOURCES, type SourceOptions } from '../types.js';
import { audioJob, readAudioWords, startAudioSync, whisperAvailable } from '../services/audio.js';
import { alignPasted, getSong, knownLyrics } from '../services/song.js';

export const songRouter = Router();

const VIDEO_ID = /^[\w-]{11}$/;
const flag = (v: unknown, def: boolean) => (v === undefined ? def : v === '1' || v === 'true' || v === true);

function sourceOptions(req: Request): SourceOptions {
  const src = (req.method === 'POST' ? req.body?.sources : req.query) ?? {};
  const token = req.header('x-genius-token') || undefined;
  return {
    ytManual: flag(src.ytManual, DEFAULT_SOURCES.ytManual),
    lrclib: flag(src.lrclib, DEFAULT_SOURCES.lrclib),
    genius: flag(src.genius, DEFAULT_SOURCES.genius),
    geniusToken: token,
  };
}

songRouter.get('/song', async (req, res) => {
  const v = String(req.query.v ?? '');
  if (!VIDEO_ID.test(v)) return void res.status(400).json({ error: 'Invalid YouTube video id' });
  try {
    res.json(await getSong(v, sourceOptions(req), req.query.refresh === '1'));
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: (e as Error).message });
  }
});

songRouter.post('/align', async (req, res) => {
  const { videoId, lyrics } = req.body ?? {};
  if (!VIDEO_ID.test(String(videoId ?? ''))) return void res.status(400).json({ error: 'Invalid YouTube video id' });
  if (typeof lyrics !== 'string' || lyrics.trim().length < 3) return void res.status(400).json({ error: 'No lyrics provided' });
  try {
    res.json(await alignPasted(videoId, lyrics, sourceOptions(req)));
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: (e as Error).message });
  }
});

async function audioStatus(videoId: string) {
  const job = audioJob(videoId);
  return {
    available: await whisperAvailable(),
    done: Boolean(await readAudioWords(videoId)),
    state: job?.state ?? 'idle',
    stage: job?.stage,
    progress: job?.progress ?? 0,
    error: job?.error,
  };
}

songRouter.get('/audio-sync', async (req, res) => {
  const v = String(req.query.v ?? '');
  if (!VIDEO_ID.test(v)) return void res.status(400).json({ error: 'Invalid YouTube video id' });
  res.json(await audioStatus(v));
});

songRouter.post('/audio-sync', async (req, res) => {
  const { videoId, lyrics } = req.body ?? {};
  if (!VIDEO_ID.test(String(videoId ?? ''))) return void res.status(400).json({ error: 'Invalid YouTube video id' });
  if (!(await whisperAvailable())) {
    return void res.status(501).json({ error: 'Audio sync needs faster-whisper: pip install faster-whisper' });
  }
  try {
    const hint = typeof lyrics === 'string' && lyrics.trim() ? lyrics : await knownLyrics(videoId).catch(() => undefined);
    startAudioSync(videoId, hint);
    res.json(await audioStatus(videoId));
  } catch (e) {
    res.status(409).json({ error: (e as Error).message });
  }
});
