import { readJson, writeJson } from './settings';

export interface RecentSong {
  id: string;
  title: string;
  artist: string;
}

const KEY = 'musi-type:recent';

export const getRecent = (): RecentSong[] => readJson<RecentSong[]>(KEY, []);

export function pushRecent(song: RecentSong): void {
  const rest = getRecent().filter((s) => s.id !== song.id);
  writeJson(KEY, [song, ...rest].slice(0, 12));
}
