import cors from 'cors';
import type { Express, NextFunction, Request, Response } from 'express';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import type { Config } from './config.js';

const tooMany = (what: string) => ({ error: `Too many ${what}. Slow down and try again shortly.` });
const limiter = (windowMs: number, limit: number, what: string) =>
  rateLimit({ windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false, message: tooMany(what) });

/** Is this Origin allowed to call the API? Same-origin and ALLOWED_ORIGINS always; in production nobody else. */
export function originAllowed(origin: string, host: string | undefined, cfg: Config): boolean {
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    return false;
  }
  if (host && o.host === host) return true; // the site calling its own API
  if (cfg.allowedOrigins.includes(o.origin)) return true;
  // outside production (local dev, or a deploy that hasn't set NODE_ENV yet) any origin may call the API
  return !cfg.production;
}

const warned = new Set<string>();

export function applySecurity(app: Express, cfg: Config) {
  app.disable('x-powered-by');
  app.set('trust proxy', cfg.trustProxy); // so rate limits see the real client IP behind a proxy
  app.use(helmet());

  // browsers always send Origin on cross-origin requests: refuse the ones we don't know
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin && !originAllowed(origin, req.headers.host, cfg)) {
      if (!warned.has(origin) && warned.size < 50) {
        warned.add(origin);
        console.warn(`[security] refused a request from origin ${origin}. If that is your own site, add it to ALLOWED_ORIGINS.`);
      }
      return void res.status(403).json({ error: 'This origin is not allowed to use the API.' });
    }
    next();
  });
  app.use(cors({ origin: (origin, cb) => cb(null, Boolean(origin))  /* the guard above already rejected unknown origins */ }));

  app.use(express.json({ limit: '100kb' }));
  // never let a shared cache keep a response that was made with someone's Genius token
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
}

export function makeLimiters(cfg: Config) {
  return {
    api: limiter(60_000, cfg.rateApiPerMin, 'requests'),
    heavy: limiter(60_000, cfg.rateHeavyPerMin, 'song lookups'),
    audio: limiter(60 * 60_000, cfg.rateAudioPerHour, 'audio sync requests'),
  };
}
