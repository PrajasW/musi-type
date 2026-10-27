import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A tripwire: if anything that looks like a credential ends up in the source, this fails the build before it
 * can be committed or deployed. (GitHub's secret scanning is the second net; keep this as the first.)
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'cache', 'coverage']);
const SKIP_EXT = new Set(['.png', '.gif', '.jpg', '.jpeg', '.mp4', '.webm', '.mp3', '.woff', '.woff2', '.ico', '.lock']);

const SECRET_SHAPES: [string, RegExp][] = [
  ['Google API key', /AIza[0-9A-Za-z_-]{35}/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ['GitHub fine-grained token', /github_pat_[A-Za-z0-9_]{30,}/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['AWS access key id', /\bAKIA[0-9A-Z]{16}\b/],
  ['OpenAI-style key', /\bsk-[A-Za-z0-9]{32,}/],
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['key or token assigned to a literal', /\b(?:api[_-]?key|token|secret|password)\b\s*[:=]\s*['"][A-Za-z0-9_\-]{20,}['"]/i],
];

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(name)) yield* walk(full);
    } else if (!SKIP_EXT.has(extname(name).toLowerCase()) && name !== 'package-lock.json' && statSync(full).size < 2_000_000) {
      yield full;
    }
  }
}

describe('repository hygiene', () => {
  it('contains nothing that looks like a leaked credential', () => {
    const found: string[] = [];
    for (const file of walk(ROOT)) {
      const text = readFileSync(file, 'utf8');
      for (const [what, re] of SECRET_SHAPES) {
        if (re.test(text)) found.push(`${relative(ROOT, file)}: ${what}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('has no environment files or cookie jars lying around', () => {
    const risky: string[] = [];
    for (const file of walk(ROOT)) {
      const rel = relative(ROOT, file).replace(/\\/g, '/');
      if (/(^|\/)\.env(\.|$)/.test(rel) && !rel.endsWith('.example')) risky.push(rel);
      if (/cookies?\.(txt|json)$/i.test(rel) || /\.(pem|p12|pfx)$/i.test(rel)) risky.push(rel);
    }
    expect(risky).toEqual([]);
  });

  it('keeps secrets and runtime data out of git', () => {
    const ignore = readFileSync(join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim());
    for (const entry of ['.env', 'node_modules/', 'server/cache/']) expect(ignore, entry).toContain(entry);
  });

  it('does not read the shared Genius key from the environment any more', () => {
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, 'server', 'src'))) {
      if (file.endsWith('.test.ts')) continue;
      if (/process\.env\.GENIUS/.test(readFileSync(file, 'utf8'))) offenders.push(relative(ROOT, file));
    }
    expect(offenders).toEqual([]);
  });

  it('never puts a secret environment variable into the browser bundle source', () => {
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, 'web', 'src'))) {
      if (/YOUTUBE_API_KEY|GENIUS_TOKEN|YTDLP_COOKIES|import\.meta\.env\.VITE_.*(KEY|SECRET|TOKEN)/.test(readFileSync(file, 'utf8'))) {
        offenders.push(relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
