import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchGenius, isGeniusPage, isGeniusToken, pickGeniusHit } from './genius.js';
import { trackVariants } from './titleClean.js';

const TOKEN = 'a'.repeat(40);
const hit = (title: string, artist: string, url = 'https://genius.com/some-song-lyrics') => ({ type: 'song', result: { url, title, primary_artist: { name: artist } } });
const searchBody = (...hits: ReturnType<typeof hit>[]) => JSON.stringify({ response: { hits } });
const LYRICS_PAGE = `<html><div data-lyrics-container="true">First made-up line<br/>Second made-up line<br/>Third made-up line for the test</div></html>`;

/** Fake fetch: api.genius.com answers `api`, genius.com pages answer `page`. */
function mockFetch(api: () => Response, page: () => Response = () => new Response(LYRICS_PAGE)) {
  const fn = vi.fn(async (url: string | URL) => (String(url).startsWith('https://api.genius.com') ? api() : page()));
  vi.stubGlobal('fetch', fn);
  return fn;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Genius is per user', () => {
  it('does nothing without the caller\'s own token, even if the server has one in its environment', async () => {
    vi.stubEnv('GENIUS_TOKEN', TOKEN);
    const fetchSpy = mockFetch(() => new Response(searchBody(hit('Song', 'Artist'))));
    expect(await fetchGenius('Artist', ['Song'], undefined)).toEqual({ ok: false, reason: 'no-token' });
    expect(await fetchGenius('Artist', ['Song'], '')).toEqual({ ok: false, reason: 'no-token' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends the caller\'s token to Genius and to nobody else', async () => {
    const fetchSpy = mockFetch(() => new Response(searchBody(hit('Song', 'Artist'))));
    const r = await fetchGenius('Artist', ['Song'], TOKEN);
    expect(r.ok).toBe(true);
    for (const [url, init] of fetchSpy.mock.calls as [string, RequestInit?][]) {
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
      if (String(url).startsWith('https://api.genius.com')) expect(auth).toBe(`Bearer ${TOKEN}`);
      else expect(auth).toBeUndefined(); // the lyrics page request carries no token
    }
  });

  it('validates the token format', () => {
    expect(isGeniusToken(TOKEN)).toBe(true);
    expect(isGeniusToken('short')).toBe(false);
    expect(isGeniusToken(`${TOKEN} extra`)).toBe(false);
    expect(isGeniusToken('x'.repeat(300))).toBe(false);
  });
});

describe('fetchGenius outcomes', () => {
  it('returns the lyrics text when the song matches', async () => {
    mockFetch(() => new Response(searchBody(hit('Song', 'Artist'))));
    const r = await fetchGenius('Artist', ['Song'], TOKEN);
    expect(r).toEqual({ ok: true, text: expect.stringContaining('Second made-up line') });
  });

  it('says so when the token is rejected', async () => {
    mockFetch(() => new Response('{}', { status: 401 }));
    expect(await fetchGenius('Artist', ['Song'], TOKEN)).toEqual({ ok: false, reason: 'bad-token' });
  });

  it('says so when nothing matches, and does not take a different song', async () => {
    mockFetch(() => new Response(searchBody(hit('Completely Different Tune', 'Someone Else'))));
    expect(await fetchGenius('Artist', ['Song'], TOKEN)).toEqual({ ok: false, reason: 'no-match' });
  });

  it('reports when Genius refuses to serve the lyrics page (bot blocking)', async () => {
    mockFetch(() => new Response(searchBody(hit('Song', 'Artist'))), () => new Response('blocked', { status: 403 }));
    expect(await fetchGenius('Artist', ['Song'], TOKEN)).toEqual({ ok: false, reason: 'blocked' });
    mockFetch(() => new Response(searchBody(hit('Song', 'Artist'))), () => new Response('<html>just a check page</html>'));
    expect(await fetchGenius('Artist', ['Song'], TOKEN)).toEqual({ ok: false, reason: 'blocked' });
  });

  it('tries the cleaned title when the first one finds nothing', async () => {
    const fetchSpy = mockFetch(() => new Response(searchBody()));
    await fetchGenius('Artist', ['Song in the Live Lounge', 'Song'], TOKEN);
    const queries = fetchSpy.mock.calls.map(([u]) => decodeURIComponent(String(u))).filter((u) => u.includes('/search'));
    expect(queries).toHaveLength(2);
    expect(queries[1]).toContain('Artist Song');
  });

  it('never fetches a page outside genius.com, whatever the search says', async () => {
    const fetchSpy = mockFetch(() => new Response(searchBody(hit('Song', 'Artist', 'https://evil.example/lyrics'))));
    const r = await fetchGenius('Artist', ['Song'], TOKEN);
    expect(r.ok).toBe(false);
    expect(fetchSpy.mock.calls.every(([u]) => String(u).startsWith('https://api.genius.com'))).toBe(true);
    expect(isGeniusPage('https://genius.com/x')).toBe(true);
    expect(isGeniusPage('https://www.genius.com/x')).toBe(true);
    expect(isGeniusPage('http://genius.com/x')).toBe(false);
    expect(isGeniusPage('https://genius.com.evil.example/x')).toBe(false);
    expect(isGeniusPage('file:///etc/passwd')).toBe(false);
  });
});

describe('pickGeniusHit', () => {
  it('prefers the right artist and title, and skips non-songs', () => {
    const hits = [
      { type: 'album', result: { url: 'https://genius.com/a', title: 'Song', primary_artist: { name: 'Artist' } } },
      hit('Song (Remix)', 'Other Person'),
      hit('Song', 'Artist', 'https://genius.com/right'),
    ];
    expect(pickGeniusHit(hits, 'Artist', 'Song')?.result.url).toBe('https://genius.com/right');
  });
  it('returns null rather than a wrong song', () => {
    expect(pickGeniusHit([hit('Unrelated', 'Nobody')], 'Artist', 'Song')).toBeNull();
    expect(pickGeniusHit([hit('Song', 'Nobody')], 'Artist', 'Song')).toBeNull();
  });
});

describe('trackVariants', () => {
  it.each([
    ['Love Me Not in the Live Lounge', 'Love Me Not'],
    ['Some Song (Live at Wembley)', 'Some Song'],
    ['Some Song - Acoustic Version', 'Some Song'],
    ['Some Song [Remastered 2011]', 'Some Song'],
    ['Some Song (feat. Someone Else)', 'Some Song'],
    ['Some Song - Radio Edit', 'Some Song'],
    ['Some Song Live', 'Some Song'],
  ])('%s -> %s', (input, expected) => {
    const v = trackVariants(input);
    expect(v[0]).toBe(input);
    expect(v[1]).toBe(expected);
  });

  it('leaves a clean title alone', () => {
    expect(trackVariants('Hello')).toEqual(['Hello']);
    expect(trackVariants('Alive')).toEqual(['Alive']);
    expect(trackVariants('Lovely Day')).toEqual(['Lovely Day']);
  });
});
