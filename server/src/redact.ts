/**
 * Keep secrets out of logs and error messages. Anything that looks like a credential, and the value of
 * every environment variable whose name suggests one (KEY, TOKEN, SECRET, COOKIE, PASSWORD), is replaced.
 */
const SECRET_NAME = /(KEY|TOKEN|SECRET|COOKIE|PASSWORD|AUTH)/i;

const PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, // Authorization headers
  /AIza[0-9A-Za-z_-]{20,}/g, // Google API keys
  /gh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /sk-[A-Za-z0-9]{20,}/g,
  /(x-genius-token|x-goog-api-key|authorization|cookie)\s*[:=]\s*\S+/gi, // header-like pairs
  /([?&](?:key|token|access_token|api_key)=)[^&\s]+/gi, // credentials in a URL
];

export function redact(text: string, env: NodeJS.ProcessEnv = process.env): string {
  let out = String(text);
  for (const [name, value] of Object.entries(env)) {
    if (value && value.length >= 8 && SECRET_NAME.test(name)) out = out.split(value).join('[redacted]');
  }
  for (const re of PATTERNS) out = out.replace(re, (m, p1) => (typeof p1 === 'string' && p1.startsWith('?') || typeof p1 === 'string' && p1.startsWith('&') ? `${p1}[redacted]` : '[redacted]'));
  return out;
}
