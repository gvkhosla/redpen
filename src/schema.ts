import { Schema } from 'effect';
import { errorMessage, ValidationError } from './errors.js';
import type { Source, PreviousReview, DroppedFinding } from './types.js';

export const PACKS = ['deck', 'website', 'writing'] as const;
const Text = Schema.String.check(Schema.isMaxLength(12_000), Schema.isPattern(/\S/));
const Strings = Schema.Array(Text).check(Schema.isMaxLength(20));
const Bounded = <S extends Schema.Constraint>(item: S, min: number, max: number) =>
  Schema.Array(item).check(Schema.isMinLength(min), Schema.isMaxLength(max));
const Readiness = Schema.Literals(['ready', 'needs-work', 'provisional']);
const Level = Schema.Literals(['high', 'medium', 'low']);
const FindingId = Text.check(Schema.isPattern(/^F[1-9][0-9]*$/));

const evidenceFields = { source: Text, locator: Text, detail: Text };
export const EvidenceSchema = Schema.Union([
  Schema.Struct({ ...evidenceFields, kind: Schema.Literal('quote') }),
  Schema.Struct({ ...evidenceFields, kind: Schema.Literal('visual') }),
  Schema.Struct({ ...evidenceFields, kind: Schema.Literal('absence') })
]);
export type Evidence = typeof EvidenceSchema.Type;

export const PlanSchema = Schema.Struct({
  task: Text, purpose: Text, audience: Text, stage: Text, stakes: Text, qualityBar: Text,
  stopWhen: Text, assumptions: Strings, questions: Bounded(Text, 0, 5),
  packs: Bounded(Schema.Literals(PACKS), 0, 3), outOfScope: Strings,
  lenses: Bounded(Schema.Struct({
    name: Text, why: Text, evidenceNeeded: Text, checks: Bounded(Text, 1, 6)
  }), 1, 4)
});
export type ReviewPlan = typeof PlanSchema.Type;

const FindingSchema = Schema.Struct({
  id: FindingId, title: Text, why: Text, action: Text, verify: Text,
  basis: Schema.Literals(['observed', 'goal', 'taste']), impact: Level, confidence: Level,
  evidence: Bounded(EvidenceSchema, 1, 5)
});
export type Finding = typeof FindingSchema.Type;

const reassessmentFields = { previousId: FindingId, reason: Text };
const ReassessmentSchema = Schema.Union([
  Schema.Struct({ ...reassessmentFields, status: Schema.Literals(['improved', 'persists', 'regressed']), evidence: Bounded(EvidenceSchema, 1, 5) }),
  Schema.Struct({ ...reassessmentFields, status: Schema.Literal('unverified'), evidence: Bounded(EvidenceSchema, 0, 5) })
]);

export const ReviewSchema = Schema.Struct({
  verdict: Text, readiness: Readiness, unknowns: Strings,
  findings: Bounded(FindingSchema, 0, 8),
  preserve: Bounded(Schema.Struct({ point: Text, evidence: Bounded(EvidenceSchema, 1, 5) }), 0, 5),
  reassessment: Bounded(ReassessmentSchema, 0, 8)
});
export type Review = typeof ReviewSchema.Type;

export const ChallengeSchema = Schema.Struct({
  verdict: Text, readiness: Readiness, caveats: Strings,
  decisions: Bounded(Schema.Struct({
    id: FindingId, reason: Text, decision: Schema.Literals(['keep', 'drop'])
  }), 0, 8)
});
export type Challenge = typeof ChallengeSchema.Type;

// Strict decoding is shared by file loading and model responses. Never store extra fields.
// Avoid including rejected input in errors: context may contain private work.
function decode<S extends Schema.ConstraintDecoder<unknown>>(schema: S, input: unknown, label: string): S['Type'] {
  try {
    return Schema.decodeUnknownSync(schema, { onExcessProperty: 'error', reportInput: false })(input);
  } catch (error) {
    throw new ValidationError({ message: `Invalid model output: ${label}: ${errorMessage(error)}` });
  }
}
function fail(message: string): never {
  throw new ValidationError({ message: `Invalid model output: ${message}` });
}

export function validatePlan(input: unknown): ReviewPlan {
  const plan = decode(PlanSchema, input, 'plan');
  if (new Set(plan.lenses.map(l => l.name)).size !== plan.lenses.length) fail('duplicate lens name');
  return plan;
}

export function validateReview(input: unknown, previous?: PreviousReview | null): Review {
  const review = decode(ReviewSchema, input, 'review');
  if (new Set(review.findings.map(f => f.id)).size !== review.findings.length) fail('finding IDs must be unique F1, F2, ...');
  const priorIds = new Set(previous?.review.findings.map(f => f.id) ?? []);
  const seen = new Set<string>();
  for (const r of review.reassessment) {
    if (!priorIds.has(r.previousId) || seen.has(r.previousId)) fail('invalid or repeated previous finding ID');
    seen.add(r.previousId);
  }
  if (priorIds.size !== seen.size) fail('reassessment must cover every previous finding');
  return review;
}

export function validateChallenge(input: unknown, review: Review): Challenge {
  const challenge = decode(ChallengeSchema, input, 'challenge');
  const ids = new Set(review.findings.map(f => f.id)), seen = new Set<string>();
  for (const d of challenge.decisions) {
    if (!ids.has(d.id) || seen.has(d.id)) fail('challenge must address each finding exactly once');
    seen.add(d.id);
  }
  if (seen.size !== ids.size) fail('challenge must address each finding exactly once');
  return challenge;
}

const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
export function evidenceProblem(evidence: readonly Evidence[], sources: readonly Source[]): string | null {
  for (const e of evidence) {
    const source = sources.find(s => s.id === e.source);
    if (!source) return `Unknown source ${e.source}`;
    if (e.kind === 'quote') {
      if (source.kind !== 'text') return 'Quotes require a text source; image text uses visual evidence.';
      const match = /^L([1-9][0-9]*)(?:-L?([1-9][0-9]*))?$/.exec(e.locator);
      if (!match) return 'Text quotes require a line locator such as L3 or L3-L5.';
      const start = Number(match[1]), end = Number(match[2] ?? match[1]), lines = source.text.split('\n');
      if (end < start || end > lines.length) return 'Quote locator is outside the source.';
      if (!normalize(lines.slice(start - 1, end).join('\n')).includes(normalize(e.detail))) return 'Quoted text does not occur at the cited location.';
    } else if (e.kind === 'visual' && source.kind !== 'image') {
      return 'Visual claims require a supplied image.';
    } else if (e.kind === 'absence' && source.kind !== 'text') {
      return 'Absence evidence requires a text scope; use a visual observation for a screenshot.';
    }
  }
  return null;
}

export function groundReview(review: Review, sources: readonly Source[]): { review: Review; dropped: DroppedFinding[] } {
  const dropped: DroppedFinding[] = [];
  const keep = (entry: { readonly evidence: readonly Evidence[] }, label: string) => {
    const problem = evidenceProblem(entry.evidence, sources);
    if (problem) dropped.push({ id: label, reason: problem });
    return !problem;
  };
  return {
    review: {
      ...review,
      findings: review.findings.filter(f => keep(f, f.id)),
      preserve: review.preserve.filter((p, i) => keep(p, `preserve-${i + 1}`)),
      reassessment: review.reassessment.map(r => {
        const problem = evidenceProblem(r.evidence, sources);
        return problem ? { ...r, status: 'unverified' as const, reason: `Current evidence failed grounding: ${problem}`, evidence: [] } : r;
      })
    },
    dropped
  };
}

// Model contracts and static types are generated from the same runtime schemas.
export const MODEL_SCHEMAS = {
  plan: Schema.toJsonSchemaDocument(PlanSchema, { onExcessProperty: 'error' }),
  review: Schema.toJsonSchemaDocument(ReviewSchema, { onExcessProperty: 'error' }),
  challenge: Schema.toJsonSchemaDocument(ChallengeSchema, { onExcessProperty: 'error' })
};

// Small illustrative fixtures; satisfies catches drift without replacing runtime validation.
export const CONTRACTS = {
  plan: {
    task: 'inferred task', purpose: 'intended outcome', audience: 'audience or explicitly unknown',
    stage: 'exploration, draft, or launch, with rationale', stakes: 'what failure costs',
    qualityBar: 'task-specific definition of good', assumptions: ['inferred context, not facts'],
    questions: ['only material unanswered questions'], packs: ['writing'],
    lenses: [{ name: 'chosen lens', why: 'why this matters now', evidenceNeeded: 'what is supplied vs missing', checks: ['specific criterion'] }],
    outOfScope: ['unperformed tests or excluded topics'], stopWhen: 'when another revision or check is no longer useful'
  },
  review: {
    verdict: 'conditional bottom line grounded in the actual work', readiness: 'needs-work',
    findings: [{
      id: 'F1', title: 'specific issue', basis: 'goal', impact: 'high', confidence: 'medium',
      evidence: [{ source: 'A1', kind: 'quote', locator: 'L1', detail: 'verbatim text at cited lines' }],
      why: 'mechanism linking this to the task', action: 'concrete next change', verify: 'how to evaluate improvement'
    }],
    preserve: [{ point: 'what should stay', evidence: [{ source: 'A1', kind: 'quote', locator: 'L1', detail: 'verbatim text' }] }],
    unknowns: ['what cannot be established'], reassessment: []
  },
  challenge: { verdict: 'bottom line based only on surviving findings and current evidence', readiness: 'needs-work', decisions: [{ id: 'F1', decision: 'keep', reason: 'specific grounding and usefulness assessment' }], caveats: ['remaining uncertainty'] }
} satisfies { plan: ReviewPlan; review: Review; challenge: Challenge };
