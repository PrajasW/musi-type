const UA = 'Mozilla/5.0 (compatible; musi-type/0.1)';

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
    let i = m.index + m[0].length;
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

/** Best-effort: Genius' API only returns metadata, so the lyrics page is scraped. */
export async function fetchGenius(artist: string, track: string, token?: string): Promise<string | null> {
  const key = token || process.env.GENIUS_TOKEN;
  if (!key) return null;
  try {
    const res = await fetch(`https://api.genius.com/search?q=${encodeURIComponent(`${artist} ${track}`)}`, {
      headers: { Authorization: `Bearer ${key}`, 'User-Agent': UA },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { response?: { hits?: { type: string; result: { url: string; primary_artist?: { name: string }; title: string } }[] } };
    const hits = json.response?.hits?.filter((h) => h.type === 'song') ?? [];
    const wantArtist = artist.toLowerCase();
    const hit = hits.find((h) => h.result.primary_artist?.name.toLowerCase().includes(wantArtist)) ?? hits[0];
    if (!hit) return null;
    const page = await fetch(hit.result.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000) });
    if (!page.ok) return null;
    const lyrics = extractLyrics(await page.text());
    return lyrics.length > 40 ? lyrics : null;
  } catch {
    return null;
  }
}
