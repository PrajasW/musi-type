const NOISE = [
  /\(?\[?\s*official\s*(music\s*)?(video|audio|lyric\s*video|visualizer|mv)\s*\]?\)?/gi,
  /[([]\s*(lyrics?|lyric video|audio|hd|hq|4k|remaster(ed)?(\s*\d{4})?|visualizer|mv|m\/v|full\s*song|with lyrics)\s*[)\]]/gi,
  /\b(lyrics?|lyric video)\b\s*$/gi,
  /\s*\|.*$/g,
];

export function stripNoise(s: string): string {
  let out = s;
  for (const re of NOISE) out = out.replace(re, ' ');
  return out.replace(/\s+/g, ' ').replace(/[-–—\s]+$/, '').trim();
}

export interface TrackGuess {
  artist: string;
  track: string;
}

/** Best guess of artist/track from yt-dlp metadata. */
export function guessTrack(meta: {
  title?: string;
  track?: string;
  artist?: string;
  artists?: string[];
  uploader?: string;
  channel?: string;
}): TrackGuess {
  if (meta.track && (meta.artist || meta.artists?.length)) {
    return { track: stripNoise(meta.track), artist: (meta.artists?.[0] ?? meta.artist ?? '').split(/,|&/)[0].trim() };
  }
  const title = stripNoise(meta.title ?? '');
  const m = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (m) {
    return {
      artist: m[1].replace(/\s+(ft\.?|feat\.?|featuring)\s+.*$/i, '').trim(),
      track: m[2].replace(/\s*[([]?\s*(ft\.?|feat\.?|featuring)\s+[^)\]]*[)\]]?/i, '').trim(),
    };
  }
  const channel = (meta.channel ?? meta.uploader ?? '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
  return { artist: channel, track: title };
}

/** Live / session / version qualifiers that studio-lyric databases don't have in their titles. */
const QUALIFIERS: RegExp[] = [
  // "Song - Live at Wembley", "Song - Acoustic Version", "Song - Radio Edit"
  /\s+[-–—]\s+(live|acoustic|unplugged|session|sessions|remix|radio edit|extended|instrumental|demo|slowed|sped up|\d{4}\b|(?:\w+\s+){0,3}(?:version|edit|mix|remaster(?:ed)?)\b).*$/i,
  // "Song (Live at Wembley)", "Song [Acoustic]", "Song (2011 Remaster)"
  /\s*[([][^)\]]*\b(live|acoustic|unplugged|session|sessions|lounge|remix|version|edit|mix|remaster(?:ed)?|demo|from\b)[^)\]]*[)\]]/gi,
  // "Song in the Live Lounge", "Song at Abbey Road", "Song on KEXP"
  /\s+(?:in|at|on|for|from)\s+(?:the\s+)?(?:live lounge|bbc|studio|session|sessions|tiny desk|kexp|npr|colors|abbey road|sofar|jools|late show|tonight show|today show)\b.*$/i,
  // "Song Live ...", "Song Acoustic"
  /\s+(?:live|acoustic|unplugged)\b.*$/i,
  // featured artists
  /\s*[([]?\s*(?:feat\.?|ft\.?|featuring)\s+[^)\]]*[)\]]?\s*$/i,
];

/** The track as written, then with live/session/version tags removed: tried in that order for lyric lookups. */
export function trackVariants(track: string): string[] {
  const out = [track.trim()];
  let stripped = track;
  for (const re of QUALIFIERS) stripped = stripped.replace(re, ' ');
  stripped = stripped.replace(/\s+/g, ' ').replace(/[-–—\s]+$/, '').trim();
  if (stripped && stripped.toLowerCase() !== out[0].toLowerCase()) out.push(stripped);
  return out.filter(Boolean);
}
