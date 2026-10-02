function fail(message) { throw new Error(`Invalid model output: ${message}`); }
const FIELDS = {
  plan: ['task', 'purpose', 'audience', 'stage', 'stakes', 'qualityBar', 'stopWhen', 'assumptions', 'questions', 'packs', 'outOfScope', 'lenses'],
  lens: ['name', 'why', 'evidenceNeeded', 'checks'],
  review: ['verdict', 'readiness', 'unknowns', 'findings', 'preserve', 'reassessment'],
  finding: ['id', 'title', 'why', 'action', 'verify', 'basis', 'impact', 'confidence', 'evidence'],
  evidence: ['source', 'locator', 'detail', 'kind'],
  preserve: ['point', 'evidence'],
  reassessment: ['previousId', 'reason', 'status', 'evidence'],
  challenge: ['verdict', 'readiness', 'decisions', 'caveats'],
  decision: ['id', 'reason', 'decision']
};
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  if (Object.keys(value).some(key => !FIELDS[label].includes(key))) fail(`${label} contains an unexpected field`);
}
function text(value, label) { if (typeof value !== 'string' || !value.trim() || value.length > 12_000) fail(`${label} must be a nonempty string (max 12,000 chars)`); }
function list(value, label, min = 0, max = 20) { if (!Array.isArray(value) || value.length < min || value.length > max) fail(`${label} must have ${min}–${max} items`); }
function strings(value, label, min = 0, max = 20) { list(value, label, min, max); value.forEach(v => text(v, label)); }
function choice(value, values, label) { if (!values.includes(value)) fail(`${label} must be one of ${values.join(', ')}`); }
export const PACKS = ['deck', 'website', 'writing'];

export function validatePlan(plan) {
  object(plan, 'plan');
  for (const key of ['task', 'purpose', 'audience', 'stage', 'stakes', 'qualityBar', 'stopWhen']) text(plan[key], key);
  strings(plan.assumptions, 'assumptions'); strings(plan.questions, 'questions', 0, 5);
  list(plan.packs, 'packs', 0, 3);
  plan.packs.forEach(pack => choice(pack, PACKS, 'pack'));
  strings(plan.outOfScope, 'outOfScope');
  list(plan.lenses, 'lenses', 1, 4);
  const names = new Set();
  for (const lens of plan.lenses) {
    object(lens, 'lens');
    for (const key of ['name', 'why', 'evidenceNeeded']) text(lens[key], `lens.${key}`);
    if (names.has(lens.name)) fail('duplicate lens name');
    names.add(lens.name);
    strings(lens.checks, 'lens.checks', 1, 6);
  }
  return plan;
}

function validateEvidence(evidence) {
  list(evidence, 'evidence', 1, 5);
  for (const e of evidence) {
    object(e, 'evidence');
    for (const key of ['source', 'locator', 'detail']) text(e[key], `evidence.${key}`);
    choice(e.kind, ['quote', 'visual', 'absence'], 'evidence.kind');
  }
}

export function validateReview(review, previous) {
  object(review, 'review');
  text(review.verdict, 'verdict');
  choice(review.readiness, ['ready', 'needs-work', 'provisional'], 'readiness');
  strings(review.unknowns, 'unknowns');
  list(review.findings, 'findings', 0, 8);
  const ids = new Set();
  for (const finding of review.findings) {
    object(finding, 'finding');
    for (const key of ['id', 'title', 'why', 'action', 'verify']) text(finding[key], `finding.${key}`);
    if (!/^F[1-9][0-9]*$/.test(finding.id) || ids.has(finding.id)) fail('finding IDs must be unique F1, F2, ...');
    ids.add(finding.id);
    choice(finding.basis, ['observed', 'goal', 'taste'], 'finding.basis');
    choice(finding.impact, ['high', 'medium', 'low'], 'finding.impact');
    choice(finding.confidence, ['high', 'medium', 'low'], 'finding.confidence');
    validateEvidence(finding.evidence);
  }
  list(review.preserve, 'preserve', 0, 5);
  for (const p of review.preserve) { object(p, 'preserve'); text(p.point, 'preserve.point'); validateEvidence(p.evidence); }
  list(review.reassessment, 'reassessment', 0, 8);
  const seen = new Set(), priorIds = new Set(previous?.review?.findings?.map(f => f.id) ?? []);
  for (const r of review.reassessment) {
    object(r, 'reassessment'); text(r.previousId, 'previousId'); text(r.reason, 'reassessment.reason');
    choice(r.status, ['improved', 'persists', 'regressed', 'unverified'], 'reassessment.status');
    if (!priorIds.has(r.previousId) || seen.has(r.previousId)) fail('invalid or repeated previous finding ID');
    seen.add(r.previousId);
    if (r.status === 'unverified') list(r.evidence, 'reassessment.evidence', 0, 5);
    else validateEvidence(r.evidence);
  }
  if (priorIds.size !== seen.size) fail('reassessment must cover every previous finding');
  return review;
}

export function validateChallenge(challenge, review) {
  object(challenge, 'challenge');
  text(challenge.verdict, 'challenge.verdict');
  choice(challenge.readiness, ['ready', 'needs-work', 'provisional'], 'challenge.readiness');
  list(challenge.decisions, 'decisions', review.findings.length, review.findings.length);
  const ids = new Set(review.findings.map(f => f.id)), seen = new Set();
  for (const d of challenge.decisions) {
    object(d, 'decision'); text(d.id, 'decision.id'); text(d.reason, 'decision.reason');
    choice(d.decision, ['keep', 'drop'], 'decision');
    if (!ids.has(d.id) || seen.has(d.id)) fail('challenge must address each finding exactly once');
    seen.add(d.id);
  }
  strings(challenge.caveats, 'caveats');
  return challenge;
}

const normalize = value => value.replace(/\s+/g, ' ').trim();
export function evidenceProblem(evidence, sources) {
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

export function groundReview(review, sources) {
  const dropped = [];
  const keep = (entry, label) => {
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
        return problem ? { ...r, status: 'unverified', reason: `Current evidence failed grounding: ${problem}`, evidence: [] } : r;
      })
    },
    dropped
  };
}

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
    unknowns: ['what cannot be established'],
    reassessment: []
  },
  challenge: { verdict: 'bottom line based only on surviving findings and current evidence', readiness: 'needs-work', decisions: [{ id: 'F1', decision: 'keep', reason: 'specific grounding and usefulness assessment' }], caveats: ['remaining uncertainty'] }
};
