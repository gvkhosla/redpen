import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, cp, symlink, stat, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { prepareAgent, nextAgent, acceptAgent } from '../dist/agent.js';
import { loadTaste } from '../dist/engine.js';
import { main } from '../dist/cli.js';
import { plan, review, challenge, bundle } from './helpers.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = join(root, 'scripts/cli.mjs');
async function setup(t, extra = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'redpen-agent-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const workspace = join(dir, 'workspace');
  const request = { bundle: bundle(), taste: await loadTaste(), task: 'Decision memo', ...extra };
  request.bundle.artifacts[0].sha256 = createHash('sha256').update('synthetic fixture').digest('hex');
  const packet = await prepareAgent(workspace, request);
  const accept = async (phase, value, path = workspace) => {
    const file = join(dir, phase + '.candidate.json');
    await writeFile(file, JSON.stringify(value));
    return acceptAgent(path, file, phase);
  };
  return { dir, workspace, request, packet, accept };
}
function run(args, cwd, executable = cli, extraEnv = {}, nodeArgs = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...nodeArgs, executable, ...args], {
      cwd, env: { ...process.env, OPENAI_API_KEY: '', OPENROUTER_API_KEY: '', ...extraEnv }
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', b => { stdout += b; });
    child.stderr.on('data', b => { stderr += b; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
  });
}

test('agent workflow freezes input and completes without credentials or fetch', async t => {
  const original = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Agent mode must not fetch'); };
  t.after(() => { globalThis.fetch = original; });
  const s = await setup(t);
  assert.equal(s.packet.status, 'pending');
  assert.equal(s.packet.phase, 'plan');
  assert.match(JSON.stringify(s.packet), /L1: A useful sentence/);
  assert.equal(s.packet.contract.schema.additionalProperties, false);
  s.request.bundle.sources[0].text = 'Changed original!';
  const next = await s.accept('plan', plan());
  assert.equal(next.phase, 'review');
  assert.match(JSON.stringify(next), /A useful sentence/);
  assert.doesNotMatch(JSON.stringify(next), /Changed original!/);
  assert.equal((await s.accept('review', review())).phase, 'challenge');
  const completed = await s.accept('challenge', challenge());
  assert.equal(completed.status, 'complete');
  assert.deepEqual(completed.result.calls, []);
  assert.equal(completed.result.review.findings[0].id, 'F1');
  assert.match(completed.report, /Prioritized changes/);
  assert.equal((await nextAgent(s.workspace)).result.createdAt, completed.result.createdAt);
  assert.equal(JSON.parse(await readFile(join(s.workspace, 'review.json'))).version, 1);
  if (process.platform !== 'win32') {
    assert.equal((await stat(join(s.workspace, 'snapshot.json'))).mode & 0o777, 0o400);
    assert.equal((await stat(s.workspace)).mode & 0o777, 0o700);
  }
});
test('CLI agent default ignores configured API keys and emits pending, not fake results', async t => {
  const s = await setup(t);
  const input = join(s.dir, 'memo.md');
  await writeFile(input, 'A useful sentence.');
  const result = await run(['review', input, '--out', join(s.dir, 'cli'), '--json'], s.dir, cli, {
    OPENAI_API_KEY: 'must-not-be-used', REDPEN_BASE_URL: 'https://must-not-fetch.invalid'
  });
  assert.equal(result.code, 0, result.stderr);
  const packet = JSON.parse(result.stdout);
  assert.equal(packet.status, 'pending');
  assert.equal(packet.phase, 'plan');
  assert.equal(packet.result, undefined);
  assert.doesNotMatch(result.stdout, /must-not-be-used/);
  assert.equal((await run(['next', packet.workspace, '--json'], s.dir)).code, 0);
  assert.equal((await run(['accept', packet.workspace, '--phase', 'bad'], s.dir)).code, 1);
  assert.equal((await run(['review', input, '--model', 'other'], s.dir)).code, 1);
});
test('invalid, stale, duplicate and concurrent submissions cannot advance the wrong stage', async t => {
  const s = await setup(t);
  await assert.rejects(s.accept('review', review()), /Stale or duplicate/);
  await assert.rejects(s.accept('plan', {}), /Invalid model output/);
  assert.equal((await nextAgent(s.workspace)).phase, 'plan');
  const candidate = join(s.dir, 'race.json');
  await writeFile(candidate, JSON.stringify(plan()));
  const results = await Promise.allSettled([
    acceptAgent(s.workspace, candidate, 'plan'), acceptAgent(s.workspace, candidate, 'plan')
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  await assert.rejects(s.accept('plan', plan()), /Stale or duplicate/);
  assert.equal((await nextAgent(s.workspace)).phase, 'review');
});
test('grounding and challenge use the same engine with no unsupported surviving finding', async t => {
  const s = await setup(t);
  await s.accept('plan', plan());
  const r = review(); r.findings[0].evidence[0].detail = 'Invented quote';
  const packet = await s.accept('review', r);
  assert.deepEqual(JSON.parse(packet.content.at(-1).text).draftReview.findings, []);
  await assert.rejects(s.accept('challenge', challenge()), /each finding exactly once/);
  const completed = await s.accept('challenge', { ...challenge(), decisions: [] });
  assert.deepEqual(completed.result.review.findings, []);
  assert.equal(completed.result.dropped[0].id, 'F1');
});
test('plan-only and approved plan preserve short workflows', async t => {
  const s = await setup(t, { planOnly: true });
  const done = await s.accept('plan', plan());
  assert.equal(done.status, 'complete');
  assert.equal(done.result.review, undefined);
  const approved = await prepareAgent(join(s.dir, 'approved'), { ...s.request, planOnly: false, approvedPlan: plan() });
  assert.equal(approved.phase, 'review');
});
test('prior findings, feedback, context, and taste remain frozen and reassessment is required', async t => {
  const s = await setup(t, { previous: { version: 1, plan: plan(), review: review() }, feedback: 'Keep voice', context: 'Early draft' });
  s.request.previous.review.findings = [];
  s.request.taste.principles = 'Changed taste';
  const next = await s.accept('plan', plan());
  assert.match(JSON.stringify(next), /Keep voice/);
  assert.match(JSON.stringify(next), /Early draft/);
  assert.doesNotMatch(JSON.stringify(next), /Changed taste/);
  await assert.rejects(s.accept('review', review()), /cover every previous finding/);
  const r = review();
  r.reassessment = [{ previousId: 'F1', status: 'unverified', evidence: [], reason: 'Outcome not measured.' }];
  await s.accept('review', r);
  const done = await s.accept('challenge', challenge());
  assert.equal(done.result.review.reassessment[0].status, 'unverified');
});
test('image bytes are private snapshots; prompt paths have no base64 and mutations fail', async t => {
  const b = bundle();
  const bytes = Buffer.from('synthetic image fixture');
  b.sources = [{ id: 'A1', name: 'photo.png', kind: 'image', mime: 'image/png', dataUrl: 'data:image/png;base64,' + bytes.toString('base64') }];
  const s = await setup(t, { bundle: b });
  const image = s.packet.content.find(p => p.type === 'image_file');
  assert.equal(image.path, join(s.workspace, 'A1.png'));
  assert.deepEqual(await readFile(image.path), bytes);
  assert.doesNotMatch(JSON.stringify(s.packet), /base64|data:image/);
  await chmod(image.path, 0o600);
  await writeFile(image.path, 'changed image');
  await assert.rejects(nextAgent(s.workspace), /Frozen image changed/);
});
test('snapshot tampering, traversal and symlink image reads are rejected', async t => {
  const s = await setup(t);
  const path = join(s.workspace, 'snapshot.json');
  await chmod(path, 0o600); await writeFile(path, '{}');
  await assert.rejects(nextAgent(s.workspace), /Frozen snapshot changed/);
  const b = bundle();
  b.artifacts[0].sha256 = s.request.bundle.artifacts[0].sha256;
  b.sources = [{ id: 'A1', name: 'a.png', kind: 'image', mime: 'image/png', dataUrl: 'data:image/png;base64,eA==' }];
  const second = await prepareAgent(join(s.dir, 'second'), { ...s.request, bundle: b });
  const snapshotPath = join(second.workspace, 'snapshot.json');
  const snapshot = JSON.parse(await readFile(snapshotPath));
  snapshot.sources[0].file = '../outside.png';
  const encoded = JSON.stringify(snapshot);
  await chmod(snapshotPath, 0o600); await writeFile(snapshotPath, encoded);
  const hash = join(second.workspace, 'snapshot.sha256');
  await chmod(hash, 0o600); await writeFile(hash, createHash('sha256').update(encoded).digest('hex'));
  await assert.rejects(nextAgent(second.workspace), /Unsafe snapshot image/);
  snapshot.sources[0].file = 'A1.png';
  const encoded2 = JSON.stringify(snapshot);
  await writeFile(snapshotPath, encoded2);
  await writeFile(hash, createHash('sha256').update(encoded2).digest('hex'));
  await rm(join(second.workspace, 'A1.png'));
  await symlink(join(s.dir, 'outside.png'), join(second.workspace, 'A1.png'));
  await writeFile(join(s.dir, 'outside.png'), 'x');
  await assert.rejects(nextAgent(second.workspace), /ELOOP/);
});
test('candidate symlinks fail safely without advancing the stage', async t => {
  const s = await setup(t);
  const actual = join(s.dir, 'actual.json'), candidate = join(s.dir, 'candidate.json');
  await writeFile(actual, JSON.stringify(plan()));
  await symlink(actual, candidate);
  await assert.rejects(acceptAgent(s.workspace, candidate, 'plan'), /ELOOP/);
  assert.equal((await nextAgent(s.workspace)).phase, 'plan');
});
test('candidate descriptor identity mismatch and unavailable identity fail before reading', async t => {
  const s = await setup(t), candidate = join(s.dir, 'identity.json'), hook = join(s.dir, 'fs-hook.mjs');
  await writeFile(candidate, JSON.stringify(plan()));
  await writeFile(hook, `import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
const original = fs.open;
fs.open = async (...args) => {
  const handle = await original(...args);
  if (args[0] === process.env.TEST_CANDIDATE) {
    const stat = handle.stat.bind(handle);
    handle.stat = async options => {
      const info = await stat(options);
      info.ino = process.env.TEST_IDENTITY === 'zero' ? 0n : info.ino + 1n;
      return info;
    };
  }
  return handle;
};
syncBuiltinESMExports();
`);
  for (const mode of ['mismatch', 'zero']) {
    const result = await run(['accept', s.workspace, candidate, '--phase', 'plan'], s.dir, cli,
      { TEST_CANDIDATE: candidate, TEST_IDENTITY: mode }, ['--import', hook]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /file identity changed or cannot be verified/);
    assert.equal((await nextAgent(s.workspace)).phase, 'plan');
  }
});
test('failed and interrupted preparation remove only newly reserved private workspaces', async t => {
  const s = await setup(t);
  const b = structuredClone(s.request.bundle);
  b.sources = [{ id: 'A1', name: 'a.png', kind: 'image', mime: 'image/png', dataUrl: 'data:image/png;base64,eA==' }];
  const tooBig = join(s.dir, 'oversized');
  await assert.rejects(prepareAgent(tooBig, { ...s.request, bundle: b,
    taste: { ...s.request.taste, principles: 'x'.repeat(4 * 1024 * 1024) } }), /exceeds 4 MiB/);
  await assert.rejects(stat(tooBig), /ENOENT/);
  const interrupted = join(s.dir, 'interrupted'), controller = new AbortController();
  await assert.rejects(prepareAgent(interrupted, { ...s.request, bundle: b, signal: controller.signal,
    get task() { controller.abort(); return 'Abort after image creation'; } }));
  await assert.rejects(stat(interrupted), /ENOENT/);
  await assert.rejects(prepareAgent(s.workspace, s.request), /already exists/);
  assert.equal((await nextAgent(s.workspace)).phase, 'plan');
});
test('accepted responses are snapshot-bound and checksummed', async t => {
  const s = await setup(t);
  await s.accept('plan', plan());
  const file = join(s.workspace, 'accepted-plan.json');
  const data = JSON.parse(await readFile(file));
  data.response.purpose = 'Modified accepted response';
  await chmod(file, 0o600); await writeFile(file, JSON.stringify(data));
  await assert.rejects(nextAgent(s.workspace), /Accepted phase changed/);
});
test('skill install copies the full portable directory and never overwrites it', async t => {
  const s = await setup(t), target = join(s.dir, 'skill');
  const result = await run(['install-skill', target], s.dir);
  assert.equal(result.code, 0, result.stderr);
  assert.match(await readFile(join(target, 'SKILL.md'), 'utf8'), /this agent session/);
  assert.match(await readFile(join(target, 'scripts/redpen.mjs'), 'utf8'), /spawn\('redpen'/);
  assert.equal(await readFile(join(target, 'references/taste/principles.md'), 'utf8'), await readFile(join(root, 'taste/principles.md'), 'utf8'));
  assert.equal((await run(['install-skill', target], s.dir)).code, 1);
  const bin = join(s.dir, 'bin');
  // Exercise a copied skill's fixed PATH fallback using an actual CLI symlink.
  await import('node:fs/promises').then(fs => fs.mkdir(bin));
  await symlink(cli, join(bin, 'redpen'));
  const copied = await run(['--version'], s.dir, join(target, 'scripts/redpen.mjs'), { PATH: bin + ':' + process.env.PATH });
  assert.equal(copied.code, 0, copied.stderr);
  assert.equal(copied.stdout.trim(), '0.3.0');
});
test('interrupted skill copying removes only its newly reserved destination', async t => {
  const s = await setup(t), destination = join(s.dir, 'interrupted-skill');
  const controller = new AbortController();
  let checks = 0;
  controller.signal.throwIfAborted = function() {
    if (++checks === 2) controller.abort();
    return AbortSignal.prototype.throwIfAborted.call(this);
  };
  await assert.rejects(main(['install-skill', destination], {}, { signal: controller.signal }));
  await assert.rejects(stat(destination), /ENOENT/);
  assert.equal((await nextAgent(s.workspace)).phase, 'plan');
});
test('actual skill copy failure cleans its new destination and permits retry', async t => {
  const s = await setup(t), isolated = join(s.dir, 'missing-skill-package'), destination = join(s.dir, 'failed-skill');
  await cp(join(root, 'dist'), join(isolated, 'dist'), { recursive: true });
  await cp(join(root, 'package.json'), join(isolated, 'package.json'));
  await symlink(join(root, 'node_modules'), join(isolated, 'node_modules'));
  const result = await run(['install-skill', destination], s.dir, join(isolated, 'dist/cli.js'));
  assert.equal(result.code, 1);
  assert.match(result.stderr, /ENOENT/);
  await assert.rejects(stat(destination), /ENOENT/);
  assert.equal((await run(['install-skill', destination], s.dir)).code, 0);
});
test('source helper runs a complete phase loop without dist or a TypeScript build', async t => {
  const s = await setup(t), sourceRoot = join(s.dir, 'source-package');
  await cp(join(root, 'src'), join(sourceRoot, 'src'), { recursive: true });
  for (const p of ['skills', 'taste', 'scripts']) await cp(join(root, p), join(sourceRoot, p), { recursive: true });
  await cp(join(root, 'package.json'), join(sourceRoot, 'package.json'));
  await symlink(join(root, 'node_modules'), join(sourceRoot, 'node_modules'));
  const input = join(s.dir, 'source.md'); await writeFile(input, 'A useful sentence.');
  const executable = join(sourceRoot, 'scripts/cli.mjs');
  let output = await run(['review', input, '--out', join(s.dir, 'source-run'), '--json'], s.dir, executable);
  assert.equal(output.code, 0, output.stderr);
  for (const [phase, value] of [['plan', plan()], ['review', review()], ['challenge', challenge()]]) {
    const packet = JSON.parse(output.stdout); assert.equal(packet.phase, phase);
    await writeFile(packet.candidate, JSON.stringify(value));
    output = await run(['accept', packet.workspace, packet.candidate, '--phase', phase, '--json'], s.dir, executable);
    assert.equal(output.code, 0, output.stderr);
  }
  assert.equal(JSON.parse(output.stdout).status, 'complete');
});
