import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const root = new URL('../', import.meta.url);
// Pi's Git package installer deliberately omits devDependencies.
if (existsSync(new URL('node_modules/typescript/bin/tsc', root))) {
  const run = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
  process.exitCode = run.status ?? 1;
}
