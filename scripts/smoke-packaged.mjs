// Runs server/test/packaged-check.mjs INSIDE the freshly built app (the code and libraries exactly as an installer ships them).
// Electron can act as plain Node (ELECTRON_RUN_AS_NODE), so no screen is needed. Used by the cloud build before publishing.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const release = path.resolve('release');
const exists = (p) => fs.existsSync(p);
const find = (dir, test) => (exists(dir) ? fs.readdirSync(dir).find(test) : undefined);

function locate() {
  if (process.platform === 'win32') {
    const dir = path.join(release, 'win-unpacked');
    const exe = find(dir, (f) => f.endsWith('.exe') && !/crashpad|elevate|uninstall/i.test(f));
    return exe && { exe: path.join(dir, exe), resources: path.join(dir, 'resources') };
  }
  if (process.platform === 'darwin') {
    for (const d of ['mac-universal', 'mac-arm64', 'mac']) {
      const dir = path.join(release, d);
      const app = find(dir, (f) => f.endsWith('.app'));
      if (!app) continue;
      const macos = path.join(dir, app, 'Contents', 'MacOS');
      const exe = find(macos, () => true);
      if (exe) return { exe: path.join(macos, exe), resources: path.join(dir, app, 'Contents', 'Resources') };
    }
    return undefined;
  }
  const dir = path.join(release, 'linux-unpacked');
  const exe = find(dir, (f) => f === 'imprimerie-erp' || f === 'Imprimerie ERP');
  return exe && { exe: path.join(dir, exe), resources: path.join(dir, 'resources') };
}

const target = locate();
if (!target) { console.error('No packaged app found under release/. Build it first (pnpm desktop:build).'); process.exit(1); }
const script = path.join(target.resources, 'app.asar', 'server', 'test', 'packaged-check.mjs');
console.log(`Packaged app: ${target.exe}\nRunning:      ${script}\n`);
const run = spawnSync(target.exe, [script], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit', timeout: 240_000 });
if (run.error) { console.error(run.error.message); process.exit(1); }
process.exit(run.status ?? 1);
