// Vercel build: compile Tailwind once (instead of in every visitor's browser)
// and copy the static site into dist/.
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

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

execSync(
  `npx tailwindcss -c tailwind.config.js -i assets/css/tailwind.input.css -o ${OUT}/assets/css/tailwind.css --minify`,
  { stdio: 'inherit' }
);
