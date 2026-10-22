// Vercel build: compile Tailwind once (instead of in every visitor's browser)
// and copy the static site into dist/.
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

execSync(
  `npx tailwindcss -c tailwind.config.js -i assets/css/tailwind.input.css -o ${OUT}/assets/css/tailwind.css --minify`,
  { stdio: 'inherit' }
);
