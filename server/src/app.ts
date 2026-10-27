import express, { type ErrorRequestHandler } from 'express';
import { config, type Config } from './config.js';
import { redact } from './redact.js';
import { songRouter } from './routes/song.js';
import { applySecurity, makeLimiters } from './security.js';

/** Last stop for errors raised before a route runs (bad JSON, body too large, ...). */
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const status = err?.status ?? err?.statusCode;
  if (err?.type === 'entity.too.large') return void res.status(413).json({ error: 'That request is too large.' });
  if (status && status >= 400 && status < 500) return void res.status(status).json({ error: 'Bad request.' });
  console.error('[api]', redact(String(err?.message ?? err)));
  res.status(500).json({ error: 'Something went wrong on the server.' });
};

export function createApp(overrides: Partial<Config> = {}) {
  const cfg = { ...config, ...overrides };
  const app = express();
  applySecurity(app, cfg);
  const limiters = makeLimiters(cfg);

  app.use('/api', limiters.api);
  app.get('/api/health', (_req, res) => void res.json({ ok: true }));
  app.use('/api', songRouter(cfg, limiters));
  app.use('/api', (_req, res) => void res.status(404).json({ error: 'Not found' }));
  app.use(errorHandler);
  return app;
}
