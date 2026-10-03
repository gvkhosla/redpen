#!/usr/bin/env node
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { stripVTControlCharacters } from 'node:util';

const root = new URL('../../../', import.meta.url);
const controller = new AbortController();
let interrupted;
const interrupt = () => { interrupted = 'SIGINT'; controller.abort(); };
const terminate = () => { interrupted = 'SIGTERM'; controller.abort(); };
process.once('SIGINT', interrupt);
process.once('SIGTERM', terminate);
const exists = url => access(url).then(() => true, () => false);
try {
  const manifest = new URL('package.json', root);
  const packaged = await exists(manifest) && JSON.parse(await readFile(manifest, 'utf8')).name === '@khosla/redpen';
  if (packaged) {
    const dist = new URL('dist/cli.js', root);
    let module;
    if (await exists(dist)) module = await import(dist.href);
    else {
      const { createJiti } = await import('jiti');
      module = await createJiti(import.meta.url).import(fileURLToPath(new URL('src/cli.ts', root)));
    }
    await module.main(process.argv.slice(2), process.env, { signal: controller.signal });
  } else {
    // Portable copies need a globally installed CLI. No shell or model subprocess.
    const child = spawn('redpen', process.argv.slice(2), { stdio: 'inherit', signal: controller.signal });
    process.exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve(code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1)));
    });
  }
} catch (error) {
  let message = interrupted ? 'Review cancelled.' : error instanceof Error ? error.message : 'Unknown error';
  for (const key of [process.env.OPENAI_API_KEY, process.env.OPENROUTER_API_KEY].filter(Boolean)) message = message.split(key).join('[REDACTED]');
  message = stripVTControlCharacters(message).replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, ' ');
  process.stderr.write('redpen: ' + message + '\n');
  process.exitCode = interrupted === 'SIGINT' ? 130 : interrupted === 'SIGTERM' ? 143 : 1;
} finally {
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', terminate);
}
