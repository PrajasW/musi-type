import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'cache');

const safe = (s: string) => s.replace(/[^\w-]/g, '_');

export async function readCache<T>(key: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(join(DIR, `${safe(key)}.json`), 'utf8')) as T;
  } catch {
    return undefined;
  }
}

export async function writeCache(key: string, value: unknown): Promise<void> {
  await mkdir(DIR, { recursive: true });
  await writeFile(join(DIR, `${safe(key)}.json`), JSON.stringify(value));
}
