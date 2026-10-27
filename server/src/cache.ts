import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'cache');

const safe = (s: string) => s.replace(/[^\w-]/g, '_');

export async function readCache<T>(key: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(join(DIR, `${safe(key)}.json`), 'utf8')) as T;
  } catch {
    return undefined;
  }
}

let writes = 0;

export async function writeCache(key: string, value: unknown): Promise<void> {
  await mkdir(DIR, { recursive: true });
  await writeFile(join(DIR, `${safe(key)}.json`), JSON.stringify(value));
  if (++writes % 50 === 0) void pruneCache().catch(() => {});
}

/** Keep the cache folder from growing without bound: drop the oldest files past the limit. */
export async function pruneCache(max = config.maxCacheFiles): Promise<number> {
  let names: string[];
  try {
    names = (await readdir(DIR)).filter((n) => n.endsWith('.json'));
  } catch {
    return 0;
  }
  if (names.length <= max) return 0;
  const files = await Promise.all(names.map(async (n) => ({ n, t: (await stat(join(DIR, n))).mtimeMs })));
  files.sort((a, b) => a.t - b.t);
  const drop = files.slice(0, files.length - max);
  await Promise.all(drop.map((f) => rm(join(DIR, f.n), { force: true })));
  return drop.length;
}