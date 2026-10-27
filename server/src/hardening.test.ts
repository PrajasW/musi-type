import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import type { Config } from './config.js';

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
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('method allow-list', () => {
  it('refuses methods the API never uses', async () => {
    const base = await serve();
    // (Node's fetch won't send TRACE, so PROPFIND stands in for the exotic methods)
    for (const method of ['PUT', 'DELETE', 'PATCH', 'PROPFIND']) {
      const res = await fetch(`${base}/api/health`, { method });
      expect(res.status, method).toBe(405);
      expect(res.headers.get('allow')).toBe('GET, HEAD, POST, OPTIONS');
    }
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
  });
});

describe('global cap on costly requests', () => {
  it('answers 503 once everyone together has used up the budget, even if no single client did', async () => {
    // a generous per-client limit, a tiny shared one
    const base = await serve({ rateHeavyPerMin: 100, rateGlobalHeavyPerMin: 3 });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await fetch(`${base}/api/song?v=bad`)).status);
    expect(codes).toEqual([400, 400, 400, 503, 503]);
    expect((await fetch(`${base}/api/health`)).status).toBe(200); // cheap endpoints are unaffected
  });
});

describe('errors do not leak internals', () => {
  it('returns short JSON errors for bad input, with no stack traces or file paths', async () => {
    const base = await serve({ production: true });
    const res = await fetch(`${base}/api/align`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' });
    const text = await res.text();
    expect(res.status).toBe(400);
    expect(text).not.toMatch(/at \S+ \(|node_modules|\.ts:|C:\\|\/home\//);
  });

  it('never echoes a Genius token back, even when it is rejected', async () => {
    const base = await serve();
    const token = 'x'.repeat(10) + ' not valid!';
    const res = await fetch(`${base}/api/song?v=aaaaaaaaaaa`, { headers: { 'x-genius-token': token } });
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain(token);
  });
});
