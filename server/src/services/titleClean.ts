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
