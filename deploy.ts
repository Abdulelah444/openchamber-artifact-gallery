// Copy freshly built entries into a live OpenChamber extension install, then
// stop its service so the host respawns it with the new code on next panel open.
//
//   bun run deploy                      # live path defaults to the installed extension
//   GALLERY_LIVE=/some/dir bun run deploy
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const live = process.env.GALLERY_LIVE ?? '/opt/openchamber/data/extensions/artifact-gallery';
if (!existsSync(live)) {
  console.error(`Live extension not found at ${live}. Set GALLERY_LIVE to the install path.`);
  process.exit(1);
}
for (const [from, to] of [['panel/main.js', join(live, 'panel/main.js')], ['service/main.js', join(live, 'service/main.js')]] as const) {
  await mkdir(join(live, to.split('/').slice(0, -1).join('/')), { recursive: true });
  await copyFile(from, to);
  console.log(`copied ${from} -> ${to}`);
}

// The host replaces a dead service on its next request; killing it avoids a stale runtime.
const { spawnSync } = await import('node:child_process');
const found = spawnSync('pgrep', ['-f', join(live, 'service/main.js')], { encoding: 'utf8' });
const pids = (found.stdout ?? '').trim().split('\n').filter(Boolean);
for (const pid of pids) {
  try { process.kill(Number(pid)); console.log(`stopped old service pid ${pid}`); } catch { /* already gone */ }
}
console.log('deployed. Reload the Artifact Gallery panel (or the OpenChamber page) to pick it up.');
