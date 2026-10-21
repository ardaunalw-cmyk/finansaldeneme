// Local development server: builds assets/css/tailwind.css exactly like the Vercel
// build, keeps it rebuilt on every change, and serves the site on all interfaces
// so it can also be opened from a phone on the same Wi-Fi.
import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import chatHandler from './api/chat.mjs';
import quoteHandler from './api/quote.mjs';

const PORT = Number(process.env.PORT) || 8080;
const ROOT = resolve('.');
const TW_ARGS = '-c tailwind.config.js -i assets/css/tailwind.input.css -o assets/css/tailwind.css --minify';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf'
};

// 1) One synchronous build so the first page load is already styled
execSync(`npx tailwindcss ${TW_ARGS}`, { stdio: 'inherit' });

// 2) Rebuild in the background whenever index.html or a JS file changes
spawn(`npx tailwindcss ${TW_ARGS} --watch`, { stdio: 'inherit', shell: true });

// 3) Static file server
createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    // Same serverless function Vercel runs; needs ANTHROPIC_API_KEY in this shell
    if (path === '/api/chat') {
      await chatHandler(req, res);
      return;
    }
    if (path === '/api/quote') {
      await quoteHandler(req, res);
      return;
    }
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end('403');
      return;
    }
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404 Not Found');
  }
}).listen(PORT, '0.0.0.0', () => {
  const lan = Object.values(networkInterfaces()).flat()
    .find((i) => i && i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254'));
  console.log(`\n  Bilgisayarda: http://localhost:${PORT}/`);
  if (lan) console.log(`  Telefonda:    http://${lan.address}:${PORT}/`);
  console.log('  Durdurmak icin Ctrl+C\n');
});
