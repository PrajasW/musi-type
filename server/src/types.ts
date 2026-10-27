export interface TimedWord {
  text: string;
  start: number; // seconds
  end: number;
}

export interface LyricLine {
  text: string;
  start: number;
  end: number;
}

export type LyricsSource =
  | 'yt-manual'
  | 'yt-auto'
  | 'lrclib-synced'
  | 'lrclib-aligned'
  | 'genius-aligned'
  | 'paste-aligned'
  | 'none';

export interface SongData {
  videoId: string;
  title: string;
  artist: string;
  duration: number;
  lines: LyricLine[];
  source: LyricsSource;
  /** 0..1, how much of the lyrics were anchored to real caption timings */
  confidence: number;
  lowConfidence: boolean;
  needsLyrics: boolean;
  /** word timings from the audio (Whisper) were available for this video */
  audioSynced: boolean;
  warnings: string[];
}

export interface SourceOptions {
  ytManual: boolean;
  lrclib: boolean;
  genius: boolean;
  geniusToken?: string;
}

export const DEFAULT_SOURCES: SourceOptions = { ytManual: true, lrclib: true, genius: true };
