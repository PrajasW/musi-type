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
  confidence: number;
  lowConfidence: boolean;
  needsLyrics: boolean;
  /** word timings from the audio (Whisper) were available */
  audioSynced: boolean;
  warnings: string[];
}

export const SOURCE_LABEL: Record<LyricsSource, string> = {
  'yt-manual': 'YouTube captions',
  'yt-auto': 'YouTube auto-captions',
  'lrclib-synced': 'LRCLIB (synced)',
  'lrclib-aligned': 'LRCLIB + caption timing',
  'genius-aligned': 'Genius + caption timing',
  'paste-aligned': 'Your lyrics + caption timing',
  none: 'No lyrics',
};
