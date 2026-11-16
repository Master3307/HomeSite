/*
 * After the Vite build:
 * - dist/404.html is a copy of index.html, so the app can show its own
 *   "not found" page for unknown paths.
 * - dist/serve.json gives `serve` (pnpm serve) one rewrite per route in
 *   src/App.jsx. Real pages answer 200 with index.html; anything else is
 *   a real 404 (with 404.html) instead of a 200 for every path.
 *   Don't start `serve` with -s/--single: that puts a catch-all rewrite
 *   in front of these, and every path answers 200 again.
 */
const { copyFileSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

copyFileSync(path.join(dist, 'index.html'), path.join(dist, '404.html'));
console.log('[Build] Created dist/404.html from dist/index.html');

// Every <Route path="…"> in App.jsx except the catch-all ("*") and "/" (index.html itself).
const app = readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');
const paths = [...app.matchAll(/<Route\s[^>]*?path=["']([^"']+)["']/g)]
  .map((match) => match[1])
  .filter((route) => route.startsWith('/') && route !== '/' && !route.includes('*'));

if (paths.length === 0) {
  throw new Error('[Build] No routes found in src/App.jsx; refusing to write dist/serve.json.');
}

const routes = [...new Set(paths)];
const config = {
  rewrites: routes.map((source) => ({ source, destination: '/index.html' })),
};

writeFileSync(path.join(dist, 'serve.json'), `${JSON.stringify(config, null, 2)}\n`);
console.log(`[Build] Wrote dist/serve.json with ${routes.length} routes`);
