// Vercel build: compile Tailwind once (instead of in every visitor's browser)
// and copy the static site into dist/.
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { transformSync } from 'esbuild';

const OUT = 'dist';

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const file of ['index.html', 'manifest.json', 'sw.js']) {
  cpSync(file, `${OUT}/${file}`);
}

const skip = ['assets/backup', 'assets/images/references', 'assets/css/tailwind.input.css'];
cpSync('assets', `${OUT}/assets`, {
  recursive: true,
  filter: (src) => !skip.some((s) => src.replace(/\\/g, '/').startsWith(s))
});

// Minify our own scripts and stylesheet (transform only: top-level names stay global,
// since the scripts share state through classic <script> tags).
for (const [dir, loader] of [['assets/js', 'js'], ['assets/css', 'css']]) {
  for (const name of readdirSync(`${OUT}/${dir}`)) {
    if (!name.endsWith(`.${loader}`) || name === 'tailwind.css') continue;
    const path = `${OUT}/${dir}/${name}`;
    const { code } = transformSync(readFileSync(path, 'utf8'), { loader, minify: true, charset: 'utf8' });
    writeFileSync(path, code);
  }
}

// Font Awesome: keep only the icon rules the site actually references, and ship woff2 only
// (every browser we support picks woff2 first, so the .ttf and v4-compat files are dead weight).
{
  const sources = [readFileSync('index.html', 'utf8')];
  for (const name of readdirSync('assets/js')) {
    if (name.endsWith('.js')) sources.push(readFileSync(`assets/js/${name}`, 'utf8'));
  }
  const used = new Set(sources.join('\n').match(/fa-[a-z0-9-]+/g));
  const faCss = `${OUT}/assets/lib/fa/all.min.css`;
  let css = readFileSync(faCss, 'utf8');
  css = css.replace(/([^{}]+?)\{content:"[^"]*"\}/g, (rule, selectors) => {
    if (!selectors.includes(':before')) return rule;
    const keep = selectors.split(',').filter((s) => used.has(s.replace(':before', '').slice(1)));
    return keep.length ? rule.replace(selectors, keep.join(',')) : '';
  });
  css = css
    .replace(/@font-face\{[^}]*fa-v4compatibility[^}]*\}/g, '')
    .replace(/,url\([^)]*\.ttf\) format\("truetype"\)/g, '');
  writeFileSync(faCss, css);
  for (const name of readdirSync(`${OUT}/assets/lib/fa/webfonts`)) {
    if (!name.endsWith('.woff2') || name.includes('v4compat')) rmSync(`${OUT}/assets/lib/fa/webfonts/${name}`);
  }
}

execSync(
  `npx tailwindcss -c tailwind.config.js -i assets/css/tailwind.input.css -o ${OUT}/assets/css/tailwind.css --minify`,
  { stdio: 'inherit' }
);

// Fingerprint our own JS/CSS in index.html (?v=<content hash>) so they can be cached "forever":
// a changed file gets a new URL, an unchanged one is never downloaded again.
{
  const html = readFileSync(`${OUT}/index.html`, 'utf8');
  const stamped = html.replace(/((?:src|href)="assets\/(?:js|css)\/[^"?]+)"/g, (match, ref) => {
    const hash = createHash('sha256').update(readFileSync(`${OUT}/${ref.split('"')[1]}`)).digest('hex').slice(0, 10);
    return `${ref}?v=${hash}"`;
  });
  writeFileSync(`${OUT}/index.html`, stamped);
}
