import { Router, type Request, type RequestHandler, type Response } from 'express';
import type { Config } from '../config.js';
import { BusyError } from '../limits.js';
import { redact } from '../redact.js';
import type { makeLimiters } from '../security.js';
import { audioJob, readAudioWords, startAudioSync, whisperAvailable } from '../services/audio.js';
import { isGeniusToken } from '../services/genius.js';
import { alignPasted, getSong, knownLyrics, songDuration } from '../services/song.js';
import { DEFAULT_SOURCES, type SourceOptions } from '../types.js';

const VIDEO_ID = /^[\w-]{11}$/;
const flag = (v: unknown, def: boolean) => (v === undefined ? def : v === '1' || v === 'true' || v === true);

class BadRequest extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** Source switches, plus the caller's own Genius token. The token only ever comes from this request's header. */
function sourceOptions(req: Request): SourceOptions {
  const src = (req.method === 'POST' ? req.body?.sources : req.query) ?? {};
  const raw = req.header('x-genius-token')?.trim();
  if (raw && !isGeniusToken(raw)) throw new BadRequest('That does not look like a Genius API token.');
  return {
    ytManual: flag(src.ytManual, DEFAULT_SOURCES.ytManual),
    lrclib: flag(src.lrclib, DEFAULT_SOURCES.lrclib),
    genius: flag(src.genius, DEFAULT_SOURCES.genius),
    geniusToken: raw || undefined,
  };
}

function videoIdOf(v: unknown): string {
  const id = String(v ?? '');
  if (!VIDEO_ID.test(id)) throw new BadRequest('Invalid YouTube video id');
  return id;
}

function lyricsOf(v: unknown, cfg: Config): string {
  if (typeof v !== 'string' || v.trim().length < 3) throw new BadRequest('No lyrics provided');
  if (v.length > cfg.maxLyricsChars || v.split(/\s+/).length > cfg.maxLyricsWords) {
    throw new BadRequest('Those lyrics are too long.', 413);
  }
  return v;
}

/** Turn an error into a response. Details stay in the server log; callers get a short, safe message. */
function fail(res: Response, e: unknown, cfg: Config) {
  if (e instanceof BadRequest) return void res.status(e.status).json({ error: e.message });
  if (e instanceof BusyError) return void res.status(503).json({ error: e.message });
  const message = (e as Error)?.message ?? 'unknown error';
  console.error('[api]', redact(message));
  const upstream = /^(yt-dlp failed|YouTube API failed|Video not found)/.test(message);
  res.status(upstream ? 502 : 500).json({
    error: upstream ? "Couldn't read this video right now. Try again in a bit." : 'Something went wrong on the server.',
    ...(cfg.production ? {} : { detail: message }),
  });
}

const handle =
  (cfg: Config, fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      fail(res, e, cfg);
    }
  };

export function songRouter(cfg: Config, limiters: ReturnType<typeof makeLimiters>) {
  const router = Router();

  router.get(
    '/song',
    limiters.heavyGlobal,
    limiters.heavy,
    handle(cfg, async (req, res) => {
      const v = videoIdOf(req.query.v);
      res.json(await getSong(v, sourceOptions(req), req.query.refresh === '1'));
    }),
  );

  router.post(
    '/align',
    limiters.heavyGlobal,
    limiters.heavy,
    handle(cfg, async (req, res) => {
      const videoId = videoIdOf(req.body?.videoId);
      const lyrics = lyricsOf(req.body?.lyrics, cfg);
      res.json(await alignPasted(videoId, lyrics, sourceOptions(req)));
    }),
  );

  const audioStatus = async (videoId: string) => {
    const job = audioJob(videoId);
    return {
      available: cfg.audioSyncEnabled && (await whisperAvailable()),
      done: Boolean(await readAudioWords(videoId)),
      state: job?.state ?? 'idle',
      stage: job?.stage,
      progress: job?.progress ?? 0,
      error: job?.error,
    };
  };

  router.get(
    '/audio-sync',
    handle(cfg, async (req, res) => {
      res.json(await audioStatus(videoIdOf(req.query.v)));
    }),
  );

  router.post(
    '/audio-sync',
    limiters.audio,
    handle(cfg, async (req, res) => {
      const videoId = videoIdOf(req.body?.videoId);
      if (!cfg.audioSyncEnabled) throw new BadRequest('Audio sync is turned off on this server.', 403);
      if (!(await whisperAvailable())) throw new BadRequest('Audio sync needs faster-whisper: pip install faster-whisper', 501);
      if ((await songDuration(videoId)) > cfg.maxAudioSeconds) {
        throw new BadRequest(`Audio sync only works on videos shorter than ${Math.round(cfg.maxAudioSeconds / 60)} minutes.`);
      }
      const given = typeof req.body?.lyrics === 'string' ? req.body.lyrics.slice(0, cfg.maxLyricsChars) : '';
      const hint = given.trim() ? given : await knownLyrics(videoId).catch(() => undefined);
      try {
        startAudioSync(videoId, hint);
      } catch (e) {
        throw new BadRequest((e as Error).message, 409);
      }
      res.json(await audioStatus(videoId));
    }),
  );

  return router;
}
