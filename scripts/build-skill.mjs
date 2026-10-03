import { cp, chmod } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
await cp(new URL('taste/', root), new URL('skills/redpen/references/taste/', root), { recursive: true });
await chmod(new URL('dist/cli.js', root), 0o755);
await chmod(new URL('scripts/cli.mjs', root), 0o755);
await chmod(new URL('skills/redpen/scripts/redpen.mjs', root), 0o755);
