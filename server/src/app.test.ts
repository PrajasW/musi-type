import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadConfig, type Config } from './config.js';
import { BusyError, Semaphore } from './limits.js';

const open: Server[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function serve(overrides: Partial<Config> = {}) {
  const app = createApp(overrides);
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  open.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const host = new URL(base).host;
  return { base, host };
}

const GOOD_ID = 'aaaaaaaaaaa';
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

describe('security headers and basics', () => {
  it('sends hardening headers, hides Express, and tells caches not to store API responses', async () => {
    const { base } = await serve();
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-powered-by')).toBeNull();
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('answers unknown API paths with a JSON 404', async () => {
    const { base } = await serve();
    const res = await fetch(`${base}/api/nope`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });
});

describe('input validation', () => {
  it('rejects bad video ids before doing any work', async () => {
    const { base } = await serve();
    for (const v of ['', 'short', 'has spaces!!', '../../etc/passwd', 'a'.repeat(40), '--version;;;;']) {
      const res = await fetch(`${base}/api/song?v=${encodeURIComponent(v)}`);
      expect(res.status, v).toBe(400);
    }
  });

  it('rejects a malformed Genius token header', async () => {
    const { base } = await serve();
    const res = await fetch(`${base}/api/song?v=${GOOD_ID}`, { headers: { 'x-genius-token': 'not a token!' } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Genius API token/);
  });

  it('caps pasted lyrics by size and by word count', async () => {
    const { base } = await serve({ maxLyricsChars: 100, maxLyricsWords: 5 });
    expect((await post(`${base}/api/align`, { videoId: GOOD_ID, lyrics: 'x'.repeat(500) })).status).toBe(413);
    expect((await post(`${base}/api/align`, { videoId: GOOD_ID, lyrics: 'a b c d e f g h' })).status).toBe(413);
    expect((await post(`${base}/api/align`, { videoId: GOOD_ID, lyrics: '' })).status).toBe(400);
  });

  it('refuses request bodies over 100 KB and malformed JSON', async () => {
    const { base } = await serve();
    const big = await post(`${base}/api/align`, { videoId: GOOD_ID, lyrics: 'word '.repeat(30_000) });
    expect(big.status).toBe(413);
    const bad = await fetch(`${base}/api/align`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' });
    expect(bad.status).toBe(400);
  });
});

describe('rate limiting', () => {
  it('limits the costly endpoints per client and says how long to wait', async () => {
    const { base } = await serve({ rateHeavyPerMin: 2 });
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await fetch(`${base}/api/song?v=bad`)).status);
    expect(codes).toEqual([400, 400, 429, 429]);
    const res = await fetch(`${base}/api/song?v=bad`);
    expect(res.headers.get('ratelimit-policy') ?? res.headers.get('ratelimit')).toBeTruthy();
    expect((await res.json()).error).toMatch(/Too many/);
  });

  it('has a general limit across the whole API', async () => {
    const { base } = await serve({ rateApiPerMin: 3 });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await fetch(`${base}/api/health`)).status);
    expect(codes).toEqual([200, 200, 200, 429, 429]);
  });

  it('keeps audio sync starts to a few per hour', async () => {
    const { base } = await serve({ rateAudioPerHour: 1, audioSyncEnabled: false });
    expect((await post(`${base}/api/audio-sync`, { videoId: GOOD_ID })).status).toBe(403);
    expect((await post(`${base}/api/audio-sync`, { videoId: GOOD_ID })).status).toBe(429);
  });
});

describe('origin guard', () => {
  const prod = { production: true, allowedOrigins: ['https://app.example'] };

  it('lets the allowed site, and the API serving its own pages, through; refuses everyone else', async () => {
    const { base, host } = await serve(prod);
    const get = (origin: string) => fetch(`${base}/api/health`, { headers: { origin } });
    expect((await get('https://app.example')).status).toBe(200);
    expect((await get(`http://${host}`)).status).toBe(200); // same origin
    expect((await get('https://evil.example')).status).toBe(403);
    expect((await get('null')).status).toBe(403);
  });

  it('adds CORS headers only for an allowed origin', async () => {
    const { base } = await serve(prod);
    const ok = await fetch(`${base}/api/health`, { headers: { origin: 'https://app.example' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://app.example');
  });

  it('is relaxed outside production (so a deploy that has not set NODE_ENV yet still works) and strict in production', async () => {
    const dev = await serve({ production: false });
    expect((await fetch(`${dev.base}/api/health`, { headers: { origin: 'http://localhost:5173' } })).status).toBe(200);
    expect((await fetch(`${dev.base}/api/health`, { headers: { origin: 'https://site.example' } })).status).toBe(200);
    const live = await serve({ production: true, allowedOrigins: [] });
    expect((await fetch(`${live.base}/api/health`, { headers: { origin: 'http://localhost:5173' } })).status).toBe(403);
    expect((await fetch(`${live.base}/api/health`, { headers: { origin: 'https://site.example' } })).status).toBe(403);
  });
});

describe('config', () => {
  it('is conservative in production and relaxed locally', () => {
    const prod = loadConfig({ NODE_ENV: 'production' });
    expect(prod.audioSyncEnabled).toBe(false);
    expect(prod.trustProxy).toBe(1);
    expect(prod.allowedOrigins).toEqual([]);
    const local = loadConfig({});
    expect(local.audioSyncEnabled).toBe(true);
    expect(local.trustProxy).toBe(0);
  });

  it('reads overrides and ignores nonsense', () => {
    const c = loadConfig({ NODE_ENV: 'production', ENABLE_AUDIO_SYNC: '1', ALLOWED_ORIGINS: 'https://a.example/, https://b.example', RATE_HEAVY_PER_MIN: 'lots', MAX_CONCURRENT_YTDLP: '0' });
    expect(c.audioSyncEnabled).toBe(true);
    expect(c.allowedOrigins).toEqual(['https://a.example', 'https://b.example']);
    expect(c.rateHeavyPerMin).toBe(20);
    expect(c.maxConcurrentYtdlp).toBe(1);
  });
});

describe('Semaphore', () => {
  it('runs at most `max` jobs at once and queues the rest', async () => {
    const sem = new Semaphore(2);
    let running = 0, peak = 0;
    const job = () => sem.run(async () => { running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 20)); running--; });
    await Promise.all([job(), job(), job(), job(), job()]);
    expect(peak).toBe(2);
    expect(sem.inFlight).toBe(0);
  });

  it('gives up with BusyError when nothing frees up in time', async () => {
    const sem = new Semaphore(1);
    const hold = sem.run(() => new Promise((r) => setTimeout(r, 150)));
    await expect(sem.run(async () => 1, 30)).rejects.toBeInstanceOf(BusyError);
    await hold;
    await expect(sem.run(async () => 'ok')).resolves.toBe('ok');
  });
});
