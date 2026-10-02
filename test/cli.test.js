import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, readdir, rm, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plan, review, challenge } from './helpers.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
function run(args, cwd, extraEnv = {}, executable = cli) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [executable, ...args], {
      cwd, env: { ...process.env, OPENAI_API_KEY: '', OPENROUTER_API_KEY: '', REDPEN_MODEL: '', REDPEN_BASE_URL: '', ...extraEnv }
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', b => { stdout += b; });
    child.stderr.on('data', b => { stderr += b; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}
async function setup(t, responses = [plan(), review(), challenge()]) {
  const dir = await mkdtemp(join(tmpdir(), 'redpen-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = join(dir, 'a memo.md');
  await writeFile(input, 'A useful sentence.\nAnother sentence.');
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    const next = responses.shift();
    res.writeHead(next ? 200 : 500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ model: 'mock-model', choices: [{ message: { content: JSON.stringify(next) }, finish_reason: 'stop' }], usage: { total_tokens: 10 } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = 'http://127.0.0.1:' + server.address().port + '/v1';
  return { dir, input, requests, env: { OPENAI_API_KEY: 'local-test-key', REDPEN_BASE_URL: baseUrl } };
}

test('help/version require no credentials; unknown flags and missing key fail clearly', async t => {
  const s = await setup(t);
  assert.equal((await run(['--help'], s.dir)).code, 0);
  assert.equal((await run(['--version'], s.dir)).stdout.trim(), '0.1.0');
  assert.equal((await run(['--unknown'], s.dir)).code, 1);
  const noKey = await run(['review', s.input], s.dir);
  assert.equal(noKey.code, 1); assert.match(noKey.stderr, /Set OPENAI_API_KEY/);
  assert.equal(s.requests.length, 0);
});
test('CLI writes a useful Markdown report, JSON audit, and an inspectable plan', async t => {
  const s = await setup(t);
  const out = join(s.dir, 'first-review');
  const result = await run(['review', s.input, '--task', 'Get a pilot decision', '--out', out, '--json'], s.dir, s.env);
  assert.equal(result.code, 0, result.stderr);
  const saved = JSON.parse(await readFile(join(out, 'review.json'), 'utf8'));
  assert.equal(saved.review.findings[0].id, 'F1');
  assert.equal(JSON.parse(result.stdout).task, 'Get a pilot decision');
  assert.equal(s.requests.length, 3);
  assert.match(await readFile(join(out, 'report.md'), 'utf8'), /Prioritized changes/);
  assert.equal(JSON.parse(await readFile(join(out, 'plan.json'), 'utf8')).task, plan().task);
  assert.ok(!result.stdout.includes('local-test-key'));
  if (process.platform !== 'win32') assert.equal((await stat(join(out, 'review.json'))).mode & 0o777, 0o600);
});
test('plan-only and edited-plan rerun use one then two requests', async t => {
  const s = await setup(t);
  const out = join(s.dir, 'planning');
  const planned = await run(['review', s.input, '--plan-only', '--out', out], s.dir, s.env);
  assert.equal(planned.code, 0, planned.stderr); assert.equal(s.requests.length, 1);
  const p = JSON.parse(await readFile(join(out, 'plan.json'), 'utf8')); p.qualityBar = 'A concrete decision request.';
  await writeFile(join(out, 'plan.json'), JSON.stringify(p));
  const reviewed = await run(['review', s.input, '--plan', join(out, 'plan.json'), '--out', join(s.dir, 'second')], s.dir, s.env);
  assert.equal(reviewed.code, 0, reviewed.stderr); assert.equal(s.requests.length, 3);
  assert.match(JSON.stringify(s.requests[1]), /A concrete decision request/);
});
test('previous review and feedback are used without treating acceptance as proof', async t => {
  const r = review();
  r.reassessment = [{ previousId: 'F1', status: 'unverified', reason: 'Outcome has not been tested.', evidence: [] }];
  const s = await setup(t, [plan(), r, challenge()]);
  const prior = join(s.dir, 'prior.json'), notes = join(s.dir, 'feedback.md');
  await writeFile(prior, JSON.stringify({ version: 1, plan: plan(), review: review() }));
  await writeFile(notes, 'Preserve the voice; outcome not measured.');
  const result = await run(['review', s.input, '--previous', prior, '--feedback', notes, '--json'], s.dir, s.env);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).review.reassessment[0].status, 'unverified');
  assert.match(JSON.stringify(s.requests[1]), /Preserve the voice/);
});
test('existing output directory is never overwritten or charged for', async t => {
  const s = await setup(t);
  const result = await run(['review', s.input, '--out', s.dir], s.dir, s.env);
  assert.equal(result.code, 1); assert.match(result.stderr, /already exists/);
  assert.equal(s.requests.length, 0);
  assert.equal(await readFile(s.input, 'utf8'), 'A useful sentence.\nAnother sentence.');
});
test('invalid previous review is rejected before API calls', async t => {
  const s = await setup(t), prior = join(s.dir, 'prior.json');
  await writeFile(prior, JSON.stringify({ version: 1, plan: plan() }));
  const result = await run(['review', s.input, '--previous', prior], s.dir, s.env);
  assert.equal(result.code, 1); assert.match(result.stderr, /not a plan-only/);
  assert.equal(s.requests.length, 0);
});
test('model failure cleans the reserved empty output directory', async t => {
  const s = await setup(t, [{}, {}]);
  const out = join(s.dir, 'failed');
  const result = await run(['review', s.input, '--out', out], s.dir, s.env);
  assert.equal(result.code, 1); assert.match(result.stderr, /invalid output/);
  assert.ok(!(await readdir(s.dir)).includes('failed'));
});
test('error output cannot be forged by a filename containing a newline', async t => {
  const s = await setup(t), input = join(s.dir, 'memo\nredpen: ready.md');
  await writeFile(input, '');
  const result = await run(['review', input], s.dir, s.env);
  assert.equal(result.code, 1);
  assert.equal(result.stderr.trim().split('\n').length, 1);
  assert.match(result.stderr, /Empty or non-text/);
});
test('npm-style executable symlink runs the CLI, not an inert import', async t => {
  const s = await setup(t), link = join(s.dir, 'redpen');
  await symlink(cli, link);
  const result = await run(['--version'], s.dir, {}, link);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout.trim(), '0.1.0');
});
