import { constants } from 'node:fs';
import { open, mkdir, lstat, writeFile, rename, link, unlink, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Effect, Schema } from 'effect';
import { AgentResponseRequired, ModelOutputError, errorMessage } from './errors.js';
import type { Phase } from './errors.js';
import type { ArtifactBundle, ModelClient, Source, ReviewResult } from './types.js';
import { PlanSchema, ReviewSchema, validatePlan, validateReview } from './schema.js';
import { runReview } from './engine.js';
import type { ReviewRequest } from './engine.js';
import { renderReport } from './report.js';
import { serialize, terminalText } from './safety.js';
import { LIMITS } from './artifacts.js';

const MAX_JSON = 4 * 1024 * 1024;
const Text = Schema.String;
const SourceId = Text.check(Schema.isPattern(/^A(?:[1-9]|1[0-2])(?:\.p(?:[1-9]|[1-9][0-9]|100))?$/));
const Hash = Text.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const SnapshotSchema = Schema.Struct({
  version: Schema.Literal(1), createdAt: Text, task: Text, context: Text, feedback: Text,
  planOnly: Schema.Boolean, approvedPlan: Schema.NullOr(PlanSchema),
  previous: Schema.NullOr(Schema.Struct({ version: Schema.Literal(1), plan: PlanSchema, review: ReviewSchema })),
  taste: Schema.Struct({ principles: Text, deck: Text, website: Text, writing: Text }),
  artifacts: Schema.Array(Schema.Struct({ id: SourceId, name: Text, path: Text, sha256: Hash })),
  limitations: Schema.Array(Text),
  sources: Schema.Array(Schema.Union([
    Schema.Struct({ id: SourceId, name: Text, kind: Schema.Literal('text'), text: Text }),
    Schema.Struct({ id: SourceId, name: Text, kind: Schema.Literal('image'),
      mime: Schema.Literals(['image/png', 'image/jpeg', 'image/webp']), file: Text, sha256: Hash })
  ]))
});
type Snapshot = typeof SnapshotSchema.Type;
const files: Record<Phase, string> = { plan: 'accepted-plan.json', review: 'draft.json', challenge: 'challenge.json' };
const suffix = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' } as const;
const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');

// Reject links before opening and compare exact descriptor identity before reading.
// O_NOFOLLOW adds kernel enforcement on POSIX; identity checks also cover Windows.
async function localRead(path: string, maxBytes = MAX_JSON, signal?: AbortSignal): Promise<Buffer> {
  signal?.throwIfAborted();
  const expected = await lstat(path, { bigint: true });
  if (expected.isSymbolicLink()) throw new Error('ELOOP: Workspace and candidate symlinks are not allowed.');
  if (!expected.isFile() || expected.size > BigInt(maxBytes)) throw new Error('Invalid or oversized workspace file.');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat({ bigint: true });
    if (!info.isFile() || info.size > BigInt(maxBytes)) throw new Error('Invalid or oversized workspace file.');
    if (info.ino === 0n || info.ino !== expected.ino || info.dev !== expected.dev) throw new Error('Workspace file identity changed or cannot be verified.');
    const bytes = await handle.readFile();
    if (bytes.length > maxBytes) throw new Error('Workspace file grew beyond limit.');
    signal?.throwIfAborted();
    return bytes;
  } finally { await handle.close(); }
}

// Exclusive hard-link commits are atomic and cannot replace accepted submissions.
// Replaceable derived outputs use rename, which replaces a symlink rather than following it.
async function save(path: string, bytes: string | Buffer, exclusive = false): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, bytes, { flag: 'wx', mode: exclusive ? 0o400 : 0o600 });
    if (exclusive) await link(temp, path);
    else await rename(temp, path);
  } finally { await unlink(temp).catch(() => {}); }
}

export interface PendingPacket {
  readonly status: 'pending';
  readonly workspace: string;
  readonly phase: Phase;
  readonly system: string;
  readonly content: readonly ({ readonly type: 'text'; readonly text: string } | { readonly type: 'image_file'; readonly path: string })[];
  readonly contract: unknown;
  readonly candidate: string;
  readonly prompt: string;
}
export interface CompletePacket {
  readonly status: 'complete';
  readonly workspace: string;
  readonly result: ReviewResult;
  readonly report: string;
}
export type AgentPacket = PendingPacket | CompletePacket;

export async function prepareAgent(
  output: string, request: Omit<ReviewRequest, 'client' | 'progress'>
): Promise<AgentPacket> {
  request.signal?.throwIfAborted();
  const workspace = resolve(output);
  await mkdir(resolve(workspace, '..'), { recursive: true, mode: 0o700 });
  try { await mkdir(workspace, { mode: 0o700 }); }
  catch (error) {
    if (isCode(error, 'EEXIST')) throw new Error(`Output directory already exists: ${workspace}. Choose a new --out directory.`);
    throw error;
  }
  try {
    const sources: Snapshot['sources'][number][] = [];
    for (const source of request.bundle.sources) {
      if (source.kind === 'text') { sources.push(source); continue; }
      if (!(source.mime in suffix) || !/^A(?:[1-9]|1[0-2])$/.test(source.id)) throw new Error('Invalid image source.');
      const mime = source.mime as keyof typeof suffix;
      const file = source.id + suffix[mime];
      const bytes = Buffer.from(source.dataUrl.split(',')[1]!, 'base64');
      await save(join(workspace, file), bytes, true);
      sources.push({ id: source.id, name: source.name, kind: 'image', mime, file, sha256: digest(bytes) });
    }
    const snapshot: Snapshot = {
      version: 1, createdAt: new Date().toISOString(), task: request.task ?? '',
      context: request.context ?? '', feedback: request.feedback ?? '', planOnly: request.planOnly ?? false,
      approvedPlan: request.approvedPlan ?? null, previous: request.previous ?? null, taste: request.taste,
      artifacts: [...request.bundle.artifacts], limitations: [...request.bundle.limitations], sources
    };
    const bytes = serialize(snapshot);
    if (Buffer.byteLength(bytes) > MAX_JSON) throw new Error('Review snapshot exceeds 4 MiB.');
    await save(join(workspace, 'snapshot.json'), bytes, true);
    await save(join(workspace, 'snapshot.sha256'), digest(bytes), true);
    if (snapshot.approvedPlan) await save(join(workspace, 'plan.json'), serialize(snapshot.approvedPlan));
    return await nextAgent(workspace, { signal: request.signal });
  } catch (error) {
    // This directory was reserved by this call. Incomplete preparation is not resumable.
    await rm(workspace, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
async function loadWorkspace(path: string): Promise<{ workspace: string; snapshot: Snapshot; hash: string; bundle: ArtifactBundle }> {
  const workspace = resolve(path);
  const info = await lstat(workspace);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Workspace must be a real directory.');
  const bytes = await localRead(join(workspace, 'snapshot.json'));
  const hash = (await localRead(join(workspace, 'snapshot.sha256'), 64)).toString();
  if (digest(bytes) !== hash) throw new Error('Frozen snapshot changed; prepare a new review.');
  const snapshot = Schema.decodeUnknownSync(SnapshotSchema, { onExcessProperty: 'error', reportInput: false })(JSON.parse(bytes.toString()));
  if (snapshot.artifacts.length > LIMITS.files || snapshot.sources.length > LIMITS.files * LIMITS.pages) throw new Error('Too many snapshot sources.');
  const ids = new Set<string>(), sources: Source[] = [];
  let imageBytes = 0, textChars = 0;
  for (const source of snapshot.sources) {
    if (ids.has(source.id)) throw new Error('Duplicate snapshot source.');
    ids.add(source.id);
    if (source.kind === 'text') {
      textChars += source.text.length;
      if (textChars > LIMITS.textChars) throw new Error('Snapshot text exceeds limit.');
      sources.push(source);
    } else {
      if (!/^A(?:[1-9]|1[0-2])$/.test(source.id) || source.file !== source.id + suffix[source.mime]) throw new Error('Unsafe snapshot image filename.');
      const image = await localRead(join(workspace, source.file), LIMITS.fileBytes);
      imageBytes += image.length;
      if (imageBytes > LIMITS.totalBytes || digest(image) !== source.sha256) throw new Error('Frozen image changed or exceeds limit; prepare a new review.');
      sources.push({ id: source.id, name: source.name, kind: 'image', mime: source.mime, dataUrl: `data:${source.mime};base64,${image.toString('base64')}` });
    }
  }
  if (snapshot.approvedPlan) validatePlan(snapshot.approvedPlan);
  if (snapshot.previous) validateReview(snapshot.previous.review);
  return { workspace, snapshot, hash, bundle: { sources, artifacts: snapshot.artifacts, limitations: snapshot.limitations } };
}

async function replay(
  state: Awaited<ReturnType<typeof loadWorkspace>>, signal?: AbortSignal,
  candidate?: { phase: Phase; response: unknown }
): Promise<{ result: ReviewResult } | { pending: AgentResponseRequired; validated?: unknown }> {
  const responses: Partial<Record<Phase, unknown>> = {};
  for (const phase of ['plan', 'review', 'challenge'] as const) {
    try {
      const record = JSON.parse((await localRead(join(state.workspace, files[phase]))).toString()) as {
        phase: Phase; snapshot: string; response: unknown; sha256: string;
      };
      if (record.phase !== phase || record.snapshot !== state.hash || record.sha256 !== digest(serialize(record.response))) throw new Error('Accepted phase changed or belongs to another snapshot.');
      responses[phase] = record.response;
    } catch (error) { if (!isCode(error, 'ENOENT')) throw error; }
  }
  let validated: unknown;
  const client: ModelClient = {
    calls: [],
    completeEffect(request) {
      if (!(request.phase in responses) && candidate?.phase !== request.phase) {
        return Effect.fail(new AgentResponseRequired({ message: `Agent response needed: ${request.phase}`, phase: request.phase,
          system: request.system, content: request.content, contract: request.contract }));
      }
      return Effect.try({
        try: () => {
          const value = request.validate(request.phase in responses ? responses[request.phase] : candidate!.response);
          if (request.phase === candidate?.phase) validated = value;
          return value;
        },
        catch: error => new ModelOutputError({ message: errorMessage(error), phase: request.phase })
      });
    }
  };
  try {
    const { snapshot, bundle } = state;
    const result = await runReview({ ...snapshot, client, bundle, signal });
    return { result: { ...result, createdAt: snapshot.createdAt } };
  } catch (error) {
    if (error instanceof AgentResponseRequired) return { pending: error, validated };
    throw error;
  }
}

export async function nextAgent(path: string, options: { readonly signal?: AbortSignal } = {}): Promise<AgentPacket> {
  options.signal?.throwIfAborted();
  const state = await loadWorkspace(path);
  const outcome = await replay(state, options.signal);
  options.signal?.throwIfAborted();
  if ('result' in outcome) {
    const report = renderReport(outcome.result);
    await save(join(state.workspace, 'plan.json'), serialize(outcome.result.plan));
    await save(join(state.workspace, 'review.json'), serialize(outcome.result));
    await save(join(state.workspace, 'report.md'), report);
    return { status: 'complete', workspace: state.workspace, result: outcome.result, report };
  }
  const { pending } = outcome;
  let imageIndex = 0;
  const images = state.snapshot.sources.filter(s => s.kind === 'image');
  const content: PendingPacket['content'] = pending.content.map(part => {
    if (part.type === 'text') return part;
    const source = images[imageIndex++];
    if (!source) throw new Error('Image prompt mapping failed.');
    return { type: 'image_file', path: join(state.workspace, source.file) };
  });
  const packet: PendingPacket = {
    status: 'pending', workspace: state.workspace, phase: pending.phase, system: pending.system,
    content, contract: pending.contract, candidate: join(state.workspace, `${pending.phase}.candidate.json`),
    prompt: join(state.workspace, `${pending.phase}.prompt.json`)
  };
  await save(packet.prompt, serialize(packet));
  return packet;
}

export async function acceptAgent(
  path: string, candidateFile: string, phase: Phase, options: { readonly signal?: AbortSignal } = {}
): Promise<AgentPacket> {
  const state = await loadWorkspace(path);
  const current = await replay(state, options.signal);
  if ('result' in current || current.pending.phase !== phase) throw new Error(`Stale or duplicate phase: ${phase}. Run redpen next for the current stage.`);
  const response: unknown = JSON.parse((await localRead(candidateFile, MAX_JSON, options.signal)).toString());
  const outcome = await replay(state, options.signal, { phase, response });
  // Last phase finishes the engine; earlier phases stop at the following handoff.
  const validated = 'result' in outcome ? (phase === 'plan' ? outcome.result.plan : outcome.result.challenge) : outcome.validated;
  if (validated === undefined) throw new Error('Submission did not advance the requested phase.');
  options.signal?.throwIfAborted();
  await save(join(state.workspace, files[phase]), serialize({ phase, snapshot: state.hash,
    response: validated, sha256: digest(serialize(validated)) }), true);
  if (phase === 'plan') await save(join(state.workspace, 'plan.json'), serialize(validated));
  return nextAgent(state.workspace, options);
}

export function formatAgentPacket(packet: AgentPacket, json = false): string {
  if (json) return serialize(packet);
  if (packet.status === 'complete') return packet.report;
  return terminalText(`redpen: waiting for the current agent's ${packet.phase} response. Workspace: ${packet.workspace}. Read the complete prompt: ${packet.prompt}. Write schema-matching JSON: ${packet.candidate}. Submit with redpen accept <workspace> <candidate> --phase ${packet.phase}. No model API call was made. Use the redpen skill to complete all phases automatically.`) + '\n';
}
