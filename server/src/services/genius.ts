const UA = 'Mozilla/5.0 (compatible; musi-type/0.1)';
const MAX_PAGE_CHARS = 3_000_000;

function decodeHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

/** Pull the text out of every `data-lyrics-container` div (handles nested tags). */
export function extractLyrics(html: string): string {
  const out: string[] = [];
  const open = /<div[^>]*data-lyrics-container="true"[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = open.exec(html))) {
    let depth = 1;
    const i = m.index + m[0].length;
    const tag = /<(\/?)div\b[^>]*>/g;
    tag.lastIndex = i;
    let t: RegExpExecArray | null;
    while ((t = tag.exec(html))) {
      depth += t[1] ? -1 : 1;
      if (depth === 0) break;
    }
    out.push(decodeHtml(html.slice(i, t ? t.index : undefined)));
  }
  return out
    .join('\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^\d*\s*contributors?\b/i.test(l))
    .join('\n');
}

export type GeniusFailure = 'no-token' | 'bad-token' | 'no-match' | 'blocked' | 'unavailable';
export type GeniusResult = { ok: true; text: string } | { ok: false; reason: GeniusFailure };

export const GENIUS_MESSAGES: Record<GeniusFailure, string> = {
  'no-token': 'Add your own Genius API token in Settings to search Genius as well.',
  'bad-token': 'Genius rejected your API token. Check it in Settings.',
  'no-match': 'Genius had no matching song for this video.',
  blocked: 'Genius would not serve the lyrics page to this server, so its lyrics could not be used.',
  unavailable: 'Genius is not responding right now.',
};

/** A Genius API token is a long url-safe string. Anything else is rejected before it goes anywhere. */
export const isGeniusToken = (s: string) => /^[A-Za-z0-9_-]{20,200}$/.test(s);

const words = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

/** Share of `a`'s words that also appear in `b` (0..1). */
function overlap(a: string, b: string): number {
  const wa = words(a);
  if (!wa.length) return 0;
  const wb = new Set(words(b));
  return wa.filter((w) => wb.has(w)).length / wa.length;
}

interface Hit {
  type: string;
  result: { url: string; title: string; primary_artist?: { name: string } };
}

/**
 * Choose the search hit that really is this song. A wrong song's lyrics are worse than none, so
 * the title has to match and (when we know the artist) so does the artist.
 */
export function pickGeniusHit(hits: Hit[], artist: string, track: string): Hit | null {
  let best: { hit: Hit; score: number } | null = null;
  for (const hit of hits) {
    if (hit.type !== 'song') continue;
    const title = overlap(track, hit.result.title) * 0.6 + overlap(hit.result.title, track) * 0.4;
    const who = artist ? Math.max(overlap(artist, hit.result.primary_artist?.name ?? ''), overlap(hit.result.primary_artist?.name ?? '', artist)) : 1;
    if (title < 0.6 || who < 0.5) continue;
    const score = title + who;
    if (!best || score > best.score) best = { hit, score };
  }
  return best?.hit ?? null;
}

/** Only ever fetch lyrics pages on genius.com, whatever the API says. */
export function isGeniusPage(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'genius.com' || u.hostname.endsWith('.genius.com'));
  } catch {
    return false;
  }
}

/**
 * Best effort: the Genius API only returns metadata, so the lyrics page is scraped.
 * The token is the caller's own (sent with their request). There is deliberately no server-wide
 * fallback key: it would let everyone use one person's API quota.
 */
export async function fetchGenius(artist: string, variants: string[], token: string | undefined): Promise<GeniusResult> {
  if (!token) return { ok: false, reason: 'no-token' };
  let sawResponse = false;
  let blocked = false;
  for (const track of variants.slice(0, 2)) {
    let res: Response;
    try {
      res = await fetch(`https://api.genius.com/search?q=${encodeURIComponent(`${artist} ${track}`.trim())}`, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      continue;
    }
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'bad-token' };
    if (!res.ok) continue;
    sawResponse = true;
    const json = (await res.json().catch(() => ({}))) as { response?: { hits?: Hit[] } };
    const hit = pickGeniusHit(json.response?.hits ?? [], artist, track);
    if (!hit || !isGeniusPage(hit.result.url)) continue;

    let page: Response;
    try {
      page = await fetch(hit.result.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000) });
    } catch {
      continue;
    }
    if (!page.ok) { blocked = true; continue; }
    const html = (await page.text()).slice(0, MAX_PAGE_CHARS);
    const text = extractLyrics(html);
    if (text.length > 40) return { ok: true, text };
    blocked = true; // a page with no lyrics container is usually a bot-check page
  }
  if (blocked) return { ok: false, reason: 'blocked' };
  return { ok: false, reason: sawResponse ? 'no-match' : 'unavailable' };
}
