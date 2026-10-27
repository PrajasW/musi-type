import { createApp } from './app.js';
import { pruneCache } from './cache.js';
import { config } from './config.js';

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`musi-type server on http://localhost:${config.port}${config.production ? ' (production)' : ''}`);
  if (config.production && !config.allowedOrigins.length) console.log('CORS: same-origin only (set ALLOWED_ORIGINS to allow another site)');
  if (!config.audioSyncEnabled) console.log('audio sync: off (set ENABLE_AUDIO_SYNC=1 to allow it)');
});

// slow-client protection: don't let half-open connections hold the server
server.headersTimeout = 20_000;
server.requestTimeout = 60_000;

void pruneCache().then((n) => n && console.log(`cache: removed ${n} old files`));
