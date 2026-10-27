/** Lowercase, strip accents/punctuation so ASR text and lyrics are comparable. */
export function normWord(w: string): string {
  return w
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’‘`´]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, '')
    .replace(/^'+|'+$/g, '');
}

/** Remove [Chorus]-style section markers and music symbols from raw lyric text. */
export function cleanLyricLine(line: string): string {
  return line
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[♪♫♬]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function splitWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/** Cheap phonetic key: ASR mishears vowels/endings far more than leading consonants. */
export function phoneticKey(w: string): string {
  const s = normWord(w);
  if (!s) return '';
  const head = s[0];
  const rest = s
    .slice(1)
    .replace(/gh/g, '')
    .replace(/[aeiouyhw']/g, '')
    .replace(/(.)\1+/g, '$1')
    .replace(/ph/g, 'f')
    .replace(/[ckq]/g, 'k')
    .replace(/[sz]/g, 's')
    .replace(/[dt]/g, 't');
  return head + rest;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 0..1 similarity between two already-normalised words. */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  let sim = 1 - levenshtein(a, b) / maxLen;
  if (phoneticKey(a) === phoneticKey(b)) sim = Math.max(sim, 0.7);
  return sim;
}
