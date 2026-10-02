import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePlan, validateReview, validateChallenge, groundReview, evidenceProblem } from '../src/schema.js';
import { plan, review, bundle, challenge } from './helpers.js';

test('plans reject unsupported packs, missing intent, and too many lenses', () => {
  const p = plan();
  assert.equal(validatePlan(p), p);
  assert.throws(() => validatePlan({ ...p, packs: ['magic'] }), /pack/);
  assert.throws(() => validatePlan({ ...p, purpose: '' }), /purpose/);
  assert.throws(() => validatePlan({ ...p, lenses: Array(5).fill(p.lenses[0]) }), /lenses/);
  assert.throws(() => validatePlan({ ...p, lenses: [p.lenses[0], p.lenses[0]] }), /duplicate/);
});
test('unknown output fields cannot smuggle artifact payloads into saved reviews', () => {
  assert.throws(() => validatePlan({ ...plan(), fullArtifact: 'private content' }), /unexpected field/);
  const r = review(); r.findings[0].rawImage = 'base64 data';
  assert.throws(() => validateReview(r), /unexpected field/);
});
test('findings require explicit basis, action, evidence, unique IDs', () => {
  const r = review();
  assert.equal(validateReview(r), r);
  for (const field of ['basis', 'action', 'evidence']) {
    const bad = review(); delete bad.findings[0][field];
    assert.throws(() => validateReview(bad));
  }
  assert.throws(() => validateReview({ ...r, findings: [r.findings[0], r.findings[0]] }), /unique/);
});
test('quotes must exist at the cited line range', () => {
  const sources = bundle().sources;
  assert.equal(evidenceProblem(review().findings[0].evidence, sources), null);
  const evidence = [{ source: 'A1', kind: 'quote', locator: 'L1-L2', detail: 'sentence. Another' }];
  assert.equal(evidenceProblem(evidence, sources), null);
  assert.match(evidenceProblem([{ ...evidence[0], locator: 'L2', detail: 'A useful sentence.' }], sources), /does not occur/);
  assert.match(evidenceProblem([{ ...evidence[0], locator: 'L9' }], sources), /outside/);
  assert.match(evidenceProblem([{ ...evidence[0], source: 'A9' }], sources), /Unknown/);
});
test('visual observations cannot cite text and absence cannot cite images', () => {
  assert.match(evidenceProblem([{ source: 'A1', kind: 'visual', locator: 'top', detail: 'tiny font' }], bundle().sources), /supplied image/);
  const images = [{ id: 'A2', kind: 'image' }];
  assert.equal(evidenceProblem([{ source: 'A2', kind: 'visual', locator: 'top left', detail: 'three competing buttons' }], images), null);
  assert.match(evidenceProblem([{ source: 'A2', kind: 'absence', locator: 'all', detail: 'no proof' }], images), /text scope/);
});
test('grounding cuts fabricated quotes and ungrounded preservation notes', () => {
  const r = review(); r.findings[0].evidence[0].detail = 'Invented claim.';
  r.preserve[0].evidence[0].source = 'A99';
  const g = groundReview(r, bundle().sources);
  assert.equal(g.review.findings.length, 0); assert.equal(g.review.preserve.length, 0);
  assert.equal(g.dropped.length, 2);
});
test('reassessment covers every prior finding and requires current evidence', () => {
  const previous = { review: review() }, r = review();
  assert.throws(() => validateReview(r, previous), /every previous/);
  r.reassessment = [{ previousId: 'F1', status: 'improved', reason: 'A clear ask now exists.', evidence: [] }];
  assert.throws(() => validateReview(r, previous), /evidence/);
  r.reassessment[0].status = 'unverified';
  assert.equal(validateReview(r, previous), r);
  r.reassessment[0] = { ...r.reassessment[0], status: 'improved', evidence: [{ source: 'A1', kind: 'quote', locator: 'L1', detail: 'Not in this document.' }] };
  const g = groundReview(r, bundle().sources);
  assert.equal(g.review.reassessment[0].status, 'unverified');
});
test('challenge cannot omit IDs, duplicate decisions or introduce new findings', () => {
  const r = review(), c = challenge();
  assert.equal(validateChallenge(c, r), c);
  assert.throws(() => validateChallenge({ ...c, decisions: [] }, r));
  assert.throws(() => validateChallenge({ ...c, decisions: [{ ...c.decisions[0], id: 'F9' }] }, r), /exactly once/);
  assert.throws(() => validateChallenge({ ...c, readiness: 'perfect' }, r), /readiness/);
});
