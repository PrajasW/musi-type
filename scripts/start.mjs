#!/usr/bin/env node
/**
 * One command to get musi-type running: checks the prerequisites, installs what is missing,
 * then starts the API and the site and opens the browser.
 *
 *   node scripts/start.mjs            check, install, run
 *   node scripts/start.mjs --check    only report what is installed
 *   node scripts/start.mjs --audio    also install faster-whisper (optional audio sync)
 *   node scripts/start.mjs --no-open  don't open the browser
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const CHECK_ONLY = args.has('--check');
const WANT_AUDIO = args.has('--audio');
const NO_OPEN = args.has('--no-open');
const IS_WIN = process.platform === 'win32';
const API_PORT = Number(process.env.PORT ?? 8787);
const WEB_PORT = 5173;

const c = (code, s) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const ok = (s) => console.log(`  ${c(32, '✓')} ${s}`);
const bad = (s) => console.log(`  ${c(31, '✗')} ${s}`);
const warn = (s) => console.log(`  ${c(33, '!')} ${s}`);
const info = (s) => console.log(`    ${c(2, s)}`);
const step = (s) => console.log(`\n${c(1, s)}`);

/** run a command quietly; returns {ok, out} */
function probe(cmd, cmdArgs) {
  const r = spawnSync(cmd, cmdArgs, { encoding: 'utf8', shell: false, timeout: 60_000 });
  return { ok: r.status === 0 && !r.error, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}
/** run a command with its output visible */
function run(cmd, cmdArgs, opts = {}) {
  return spawnSync(cmd, cmdArgs, { stdio: 'inherit', cwd: ROOT, shell: IS_WIN && cmd === 'npm', ...opts }).status === 0;
}

const hints = {
  node: IS_WIN ? 'winget install OpenJS.NodeJS.LTS   (or https://nodejs.org)' : process.platform === 'darwin' ? 'brew install node   (or https://nodejs.org)' : 'install Node 20+ from https://nodejs.org or your package manager',
  python: IS_WIN ? 'winget install Python.Python.3.12   (or https://python.org)' : process.platform === 'darwin' ? 'brew install python' : 'sudo apt install python3 python3-pip   (or your package manager)',
  ffmpeg: IS_WIN ? 'winget install Gyan.FFmpeg' : process.platform === 'darwin' ? 'brew install ffmpeg' : 'sudo apt install ffmpeg',
};

const problems = [];
console.log(c(1, '\nmusi-type'), c(2, '- setup and launch'));

// ---------------------------------------------------------------- Node
step('1. Node.js (required, 20 or newer)');
const major = Number(process.versions.node.split('.')[0]);
if (major >= 20) ok(`Node ${process.versions.node}`);
else { bad(`Node ${process.versions.node} is too old`); info(hints.node); problems.push('node'); }

// ---------------------------------------------------------------- Python
step('2. Python 3 (required, for yt-dlp)');
let python = null;
for (const cand of [['python'], ['python3'], ['py', '-3']]) {
  const r = probe(cand[0], [...cand.slice(1), '--version']);
  if (r.ok && /Python 3\./.test(r.out)) { python = cand; ok(`${r.out}  (${cand.join(' ')})`); break; }
}
if (!python) { bad('Python 3 not found'); info(hints.python); problems.push('python'); }
const py = (extra) => [python[0], [...python.slice(1), ...extra]];

if (python) {
  const pip = probe(...py(['-m', 'pip', '--version']));
  if (pip.ok) ok('pip');
  else { bad('pip is missing'); info(`${python.join(' ')} -m ensurepip --upgrade`); problems.push('pip'); }
}

// ---------------------------------------------------------------- yt-dlp
step('3. yt-dlp (required, reads captions and titles)');
const ytdlpWorks = () => probe('yt-dlp', ['--version']).ok || (python && probe(...py(['-W', 'ignore', '-m', 'yt_dlp', '--version'])).ok);
if (python && ytdlpWorks()) ok('yt-dlp');
else if (!python) bad('needs Python first');
else if (CHECK_ONLY) { bad('not installed'); info(`${python.join(' ')} -m pip install -U yt-dlp`); problems.push('yt-dlp'); }
else {
  console.log('    installing yt-dlp ...');
  if (run(...py(['-m', 'pip', 'install', '-U', 'yt-dlp'])) && ytdlpWorks()) ok('yt-dlp installed');
  else { bad('could not install yt-dlp'); info(`${python.join(' ')} -m pip install -U yt-dlp`); problems.push('yt-dlp'); }
}

// ---------------------------------------------------------------- optional audio sync
step('4. Audio sync (optional: times lyrics from the song when a video has no captions)');
const hasFfmpeg = probe('ffmpeg', ['-version']).ok;
if (hasFfmpeg) ok('ffmpeg'); else { warn('ffmpeg not found (needed for audio sync only)'); info(hints.ffmpeg); }
const whisperWorks = () => python && probe(...py(['-W', 'ignore', '-c', 'import faster_whisper'])).ok;
if (whisperWorks()) ok('faster-whisper');
else if (WANT_AUDIO && python && !CHECK_ONLY) {
  console.log('    installing faster-whisper ...');
  if (run(...py(['-m', 'pip', 'install', 'faster-whisper'])) && whisperWorks()) ok('faster-whisper installed');
  else warn('could not install faster-whisper; the rest still works');
} else {
  warn('faster-whisper not installed (the "Sync with audio" button will be disabled)');
  info('to enable: node scripts/start.mjs --audio   or   pip install faster-whisper');
}

// ---------------------------------------------------------------- npm packages
step('5. Project packages');
if (existsSync(join(ROOT, 'node_modules')) && existsSync(join(ROOT, 'web', 'node_modules', '.bin')) || existsSync(join(ROOT, 'node_modules', '.bin', 'vite'))) ok('npm packages installed');
else if (CHECK_ONLY) { bad('not installed'); info('npm install'); problems.push('npm install'); }
else if (problems.includes('node')) bad('needs a newer Node first');
else {
  console.log('    npm install ...');
  if (run('npm', ['install'])) ok('npm packages installed');
  else { bad('npm install failed'); problems.push('npm install'); }
}

// ---------------------------------------------------------------- ports
/** In use if anything accepts a connection on it (binding a port can falsely succeed on another address). */
function portFree(port) {
  const tryHost = (host) =>
    new Promise((resolve) => {
      const sock = net.connect({ port, host });
      const done = (inUse) => { sock.destroy(); resolve(inUse); };
      sock.setTimeout(500, () => done(false));
      sock.once('connect', () => done(true));
      sock.once('error', () => done(false));
    });
  return Promise.all([tryHost('127.0.0.1'), tryHost('::1')]).then(([a, b]) => !(a || b));
}
step('6. Ports');
for (const [name, port] of [['API', API_PORT], ['site', WEB_PORT]]) {
  if (await portFree(port)) ok(`${name} port ${port} is free`);
  else if (!CHECK_ONLY) { bad(`${name} port ${port} is already in use (is musi-type already running?)`); problems.push(`port ${port}`); }
  else warn(`${name} port ${port} is in use`);
}

// ---------------------------------------------------------------- verdict
console.log('');
if (CHECK_ONLY) {
  console.log(problems.length ? c(31, `Missing: ${problems.join(', ')}`) : c(32, 'Everything required is installed.'));
  process.exit(problems.length ? 1 : 0);
}
if (problems.length) {
  console.log(c(31, `Can't start yet. Fix: ${problems.join(', ')}`));
  process.exit(1);
}

// ---------------------------------------------------------------- run
console.log(c(32, 'Starting musi-type ...'), c(2, '(Ctrl+C to stop)\n'));
const env = { ...process.env };
if (python && python.length === 1) env.PYTHON_BIN = python[0];
const child = spawn('npm', ['run', 'dev'], { cwd: ROOT, stdio: 'inherit', shell: IS_WIN, env });
const stop = () => { child.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => process.exit(code ?? 0));

// open the browser once the site answers
if (!NO_OPEN) {
  const url = `http://localhost:${WEB_PORT}`;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const res = await fetch(url);
      if (res.ok) {
        const opener = IS_WIN ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
        spawn(opener[0], opener[1], { stdio: 'ignore', detached: true }).unref();
        console.log(c(32, `\nOpen ${url}`));
        break;
      }
    } catch { /* still starting */ }
  }
}
