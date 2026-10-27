import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * Content Security Policy for the built site: the page may only load code from itself and YouTube's player,
 * talk only to its own origin (the API is reached through the same address), and can't be given inline scripts.
 * Added to the production build only, because the dev server needs inline scripts for hot reloading.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://www.youtube.com https://s.ytimg.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", // React sets style attributes
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data: https://i.ytimg.com https://*.ytimg.com",
  'frame-src https://www.youtube.com https://www.youtube-nocookie.com',
  "connect-src 'self'",
  "media-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

function securityMeta(): Plugin {
  return {
    name: 'security-meta',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
      { tag: 'meta', attrs: { name: 'referrer', content: 'strict-origin-when-cross-origin' }, injectTo: 'head-prepend' },
    ],
  };
}

export default defineConfig({
  plugins: [react(), securityMeta()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8787' },
  },
});
