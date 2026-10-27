/** Everything tunable from the environment, in one place. Defaults suit local use; set NODE_ENV=production when deploying. */

const env = process.env;
const flag = (v: string | undefined, fallback: boolean) => (v === undefined ? fallback : /^(1|true|yes)$/i.test(v));
const int = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) && n >= 0 ? n : fallback;
};

export interface Config {
  production: boolean;
  port: number;
  /** how many reverse-proxy hops to trust for the client IP (rate limits key on it); 1 on a host like Render */
  trustProxy: number;
  /** browser origins allowed to call the API cross-origin. Empty = same-origin only (in production). */
  allowedOrigins: string[];
  /** requests per minute per IP: everything under /api, the costly endpoints, and audio-sync starts per hour */
  rateApiPerMin: number;
  rateHeavyPerMin: number;
  rateAudioPerHour: number;
  /** yt-dlp processes running at once; extra requests wait briefly, then get a 503 */
  maxConcurrentYtdlp: number;
  /** Whisper audio sync is CPU heavy: on by default locally, off by default in production */
  audioSyncEnabled: boolean;
  maxAudioSeconds: number;
  maxLyricsChars: number;
  maxLyricsWords: number;
  maxCacheFiles: number;
}

export function loadConfig(e: NodeJS.ProcessEnv = env): Config {
  const production = e.NODE_ENV === 'production';
  return {
    production,
    port: int(e.PORT, 8787),
    trustProxy: int(e.TRUST_PROXY, production ? 1 : 0),
    allowedOrigins: (e.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean),
    rateApiPerMin: int(e.RATE_API_PER_MIN, 120),
    rateHeavyPerMin: int(e.RATE_HEAVY_PER_MIN, 20),
    rateAudioPerHour: int(e.RATE_AUDIO_PER_HOUR, 3),
    maxConcurrentYtdlp: Math.max(1, int(e.MAX_CONCURRENT_YTDLP, 3)),
    audioSyncEnabled: flag(e.ENABLE_AUDIO_SYNC, !production),
    maxAudioSeconds: int(e.MAX_AUDIO_SECONDS, 15 * 60),
    maxLyricsChars: int(e.MAX_LYRICS_CHARS, 20_000),
    maxLyricsWords: int(e.MAX_LYRICS_WORDS, 3_000),
    maxCacheFiles: Math.max(10, int(e.MAX_CACHE_FILES, 3_000)),
  };
}

export const config = loadConfig();
