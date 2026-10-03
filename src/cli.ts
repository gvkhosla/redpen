#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve, dirname, join } from 'node:path';
import { mkdir, writeFile, rmdir, realpath, cp, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadArtifacts, readBoundedFile } from './artifacts.js';
import { createModelClient, modelConfig } from './llm.js';
import { loadTaste, runReview } from './engine.js';
import { validatePlan, validateReview } from './schema.js';
import { renderReport } from './report.js';
import { terminalText, serialize } from './safety.js';
import { errorMessage } from './errors.js';
import type { PreviousReview, ReviewResult } from './types.js';
import { prepareAgent, nextAgent, acceptAgent, formatAgentPacket } from './agent.js';

const HELP = `redpen — adaptive review for knowledge work

Usage:
  redpen review <files...> [options]   Prepare a review for your current agent
  redpen next <workspace>              Show the next phase or finished report
  redpen accept <workspace> <candidate.json> --phase plan|review|challenge
  redpen install-skill <new-directory> Copy the portable skill for another agent

Options:
  --task <text>       Intended outcome (otherwise inferred, with uncertainty)
  --context <file>    Audience, stage, constraints, or relevant background
  --plan-only        Generate the review setup without running the review
  --plan <file>      Run with an inspected/edited plan.json
  --previous <file>  Reassess a prior review.json against current files
  --feedback <file>  Human corrections or outcome notes for this run
  --out <directory>  New output directory (default: unique .redpen/ directory)
  --api              Opt in to standalone model API calls (requires a key)
  --phase <name>     Phase being submitted with accept
  --model <name>     API model override (default: gpt-5.5)
  --base-url <url>   OpenAI-compatible API endpoint
  --json             Print structured JSON instead of Markdown
  --quiet            Suppress progress messages
  --help             Show help
  --version          Show version

Inputs: Markdown, text, HTML source, CSV, JSON, PDF text, PNG, JPEG, WebP.
Screenshots require a vision-capable model. PDF visuals are NOT inspected.
Default: local preparation and validation; your current agent supplies judgment.
Use the redpen skill to finish all phases with your existing model access.
Only --api uses OPENAI_API_KEY or OPENROUTER_API_KEY and sends files directly.
`;

async function readContext(path?: string): Promise<string> {
  return path ? (await readBoundedFile(path, 32_000)).toString('utf8') : '';
}

async function readJson(path: string): Promise<unknown> {
  try { return JSON.parse((await readBoundedFile(path, 1024 * 1024)).toString('utf8')); }
  catch (error) { throw new Error(`Cannot load JSON file ${path}: ${errorMessage(error)}`); }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function readPrevious(path?: string): Promise<PreviousReview | null> {
  if (!path) return null;
  const value = await readJson(path);
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.review)) throw new Error('Previous file must be a v1 review.json, not a plan-only result.');
  const plan = validatePlan(value.plan);
  // Historical reassessment may refer to an earlier run not available here.
  const review = validateReview({ ...value.review, reassessment: [] });
  return { version: 1, plan, review };
}

export async function main(args: string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env, options: { readonly signal?: AbortSignal } = {}): Promise<void> {
  const { values, positionals } = parseArgs({
    args, allowPositionals: true, strict: true,
    options: {
      task: { type: 'string' }, context: { type: 'string' }, 'plan-only': { type: 'boolean' },
      plan: { type: 'string' }, previous: { type: 'string' }, feedback: { type: 'string' },
      out: { type: 'string' }, model: { type: 'string' }, 'base-url': { type: 'string' },
      json: { type: 'boolean' }, quiet: { type: 'boolean' }, api: { type: 'boolean' }, phase: { type: 'string' },
      help: { type: 'boolean', short: 'h' }, version: { type: 'boolean' }
    }
  });
  if (values.help || !args.length) { process.stdout.write(HELP); return; }
  if (values.version) { process.stdout.write('0.3.0\n'); return; }
  const command = positionals[0];
  if (command === 'install-skill') {
    if (positionals.length !== 2) throw new Error('Use: redpen install-skill <new-directory>.');
    options.signal?.throwIfAborted();
    const target = resolve(positionals[1]!);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    try { await mkdir(target, { mode: 0o700 }); }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST') throw new Error('Skill destination already exists; choose a new directory.');
      throw error;
    }
    try {
      await cp(new URL('../skills/redpen/', import.meta.url), target, { recursive: true, force: false });
      options.signal?.throwIfAborted();
    } catch (error) {
      await rm(target, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
    process.stdout.write(`Installed skill: ${terminalText(target)}\n`);
    return;
  }
  if (command === 'next' || command === 'accept') {
    if (values.api) throw new Error('--api applies only to review.');
    if (positionals.length !== (command === 'next' ? 2 : 3)) throw new Error(`Invalid ${command} arguments. See --help.`);
    if (command === 'accept' && !['plan', 'review', 'challenge'].includes(values.phase ?? '')) throw new Error('accept requires --phase plan|review|challenge.');
    const packet = command === 'next' ? await nextAgent(positionals[1]!, options)
      : await acceptAgent(positionals[1]!, positionals[2]!, values.phase as 'plan' | 'review' | 'challenge', options);
    process.stdout.write(formatAgentPacket(packet, values.json));
    return;
  }
  if (!['review', 'prepare'].includes(command ?? '') || positionals.length < 2) throw new Error('Use: redpen review <files...> [--task "..."]. See --help.');
  if (values.phase) throw new Error('--phase applies only to accept.');
  if (command === 'prepare' && values.api) throw new Error('prepare is local; use review --api for API calls.');
  if (!values.api && (values.model || values['base-url'])) throw new Error('--model and --base-url require --api; the current agent chooses its own model.');
  if (values['plan-only'] && (values.previous || values.feedback)) throw new Error('--previous and --feedback apply to a full review, not --plan-only.');
  const config = values.api ? modelConfig(env, { model: values.model, baseUrl: values['base-url'] }) : null;
  const bundle = await loadArtifacts(positionals.slice(1), options);
  const context = await readContext(values.context);
  const feedback = await readContext(values.feedback);
  const previous = await readPrevious(values.previous);
  const suppliedPlan = values.plan ? await readJson(values.plan) : null;
  const approvedPlan = suppliedPlan ? validatePlan(isRecord(suppliedPlan) && 'plan' in suppliedPlan ? suppliedPlan.plan : suppliedPlan) : null;
  const taste = await loadTaste();
  const output = resolve(values.out || join('.redpen', new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8)));
  if (!config) {
    const packet = await prepareAgent(output, { bundle, task: values.task, context, previous, feedback, taste,
      planOnly: values['plan-only'], approvedPlan, signal: options.signal });
    process.stdout.write(formatAgentPacket(packet, values.json));
    return;
  }
  const client = createModelClient(config);
  // Reserve a fresh directory before incurring model cost. Never overwrite input or older runs.
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  try { await mkdir(output, { mode: 0o700 }); }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') throw new Error(`Output directory already exists: ${output}. Choose a new --out directory.`);
    throw error;
  }
  const progress = (message: string) => { if (!values.quiet) process.stderr.write(`redpen: ${terminalText(message)}\n`); };
  let result: ReviewResult;
  try {
    progress(`Sending ${bundle.artifacts.length} local file(s) to ${new URL(config.baseUrl).host} using ${config.model}`);
    result = await runReview({ client, bundle, task: values.task, context, previous, feedback, taste, planOnly: values['plan-only'], approvedPlan, progress, signal: options.signal });
    options.signal?.throwIfAborted();
  } catch (error) {
    await rmdir(output).catch(() => {});
    throw error;
  }
  const report = renderReport(result);
  await writeFile(join(output, 'plan.json'), serialize(result.plan), { flag: 'wx', mode: 0o600 });
  await writeFile(join(output, 'review.json'), serialize(result), { flag: 'wx', mode: 0o600 });
  await writeFile(join(output, 'report.md'), report, { flag: 'wx', mode: 0o600 });
  process.stdout.write(values.json ? serialize(result) : report);
  progress(`Saved ${output}/{plan.json,review.json,report.md}`);
}

// Importable for tests without executing.
if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(resolve(process.argv[1]))).href) {
  const controller = new AbortController();
  let interrupted: 'SIGINT' | 'SIGTERM' | undefined;
  const onInterrupt = () => { interrupted = 'SIGINT'; controller.abort(); };
  const onTerminate = () => { interrupted = 'SIGTERM'; controller.abort(); };
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  main(process.argv.slice(2), process.env, { signal: controller.signal }).catch(error => {
    const keys = [process.env.OPENAI_API_KEY, process.env.OPENROUTER_API_KEY].filter((key): key is string => Boolean(key));
    let message = interrupted ? 'Review cancelled.' : errorMessage(error);
    for (const key of keys) message = message.split(key).join('[REDACTED]');
    process.stderr.write(`redpen: ${terminalText(message)}\n`);
    process.exitCode = interrupted === 'SIGINT' ? 130 : interrupted === 'SIGTERM' ? 143 : 1;
  }).finally(() => {
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
  });
}
