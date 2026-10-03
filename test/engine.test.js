import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runReview, loadTaste } from '../dist/engine.js';
import { renderReport } from '../dist/report.js';
import { plan, review, bundle, mockClient, challenge } from './helpers.js';

test('task → plan → grounded review → challenge produces a report and audit trail', async () => {
  const client = mockClient([plan(), review(), challenge()]);
  const result = await runReview({ client, bundle: bundle(), task: 'Help the reader decide', taste: await loadTaste() });
  assert.deepEqual(client.requests.map(r => r.phase), ['plan', 'review', 'challenge']);
  assert.equal(result.review.findings.length, 1);
  assert.equal(result.review.verdict, 'The next action still needs work.');
  assert.ok(renderReport(result).includes('Check improvement:'));
  assert.ok(!JSON.stringify(result).includes('A useful sentence.\\nAnother sentence.'));
  assert.ok(client.requests.every(r => r.system.includes('untrusted data')));
});
test('plan-only costs one call and can be inspected', async () => {
  const client = mockClient([plan()]);
  const result = await runReview({ client, bundle: bundle(), taste: await loadTaste(), planOnly: true });
  assert.equal(client.requests.length, 1); assert.equal(result.review, undefined);
  assert.ok(renderReport(result).includes('Review setup'));
});
test('approved plan bypasses planning and human feedback reaches review and challenge', async () => {
  const prior = { plan: plan(), review: review() }, r = review();
  r.reassessment = [{ previousId: 'F1', status: 'unverified', reason: 'Current artifact does not verify outcome.', evidence: [] }];
  const client = mockClient([r, challenge()]);
  const result = await runReview({ client, bundle: bundle(), taste: await loadTaste(), approvedPlan: plan(), previous: prior, feedback: 'Keep the distinctive voice.' });
  assert.deepEqual(client.requests.map(r => r.phase), ['review', 'challenge']);
  assert.ok(JSON.stringify(client.requests[0].content).includes('Keep the distinctive voice.'));
  assert.equal(result.review.reassessment[0].status, 'unverified');
});
test('fabricated quotes are cut before the challenge can rubber-stamp them', async () => {
  const draft = review(); draft.findings[0].evidence[0].detail = 'Fake text.';
  const client = mockClient([plan(), draft, { ...challenge(), decisions: [], readiness: 'provisional', verdict: 'Evidence is insufficient.' }]);
  const result = await runReview({ client, bundle: bundle(), taste: await loadTaste() });
  assert.equal(result.review.findings.length, 0);
  assert.match(result.dropped[0].reason, /does not occur/);
  assert.equal(result.review.readiness, 'provisional');
});
test('challenge can remove a grounded but unhelpful taste preference', async () => {
  const draft = review(); draft.findings[0].basis = 'taste';
  const c = challenge('drop'); c.verdict = 'This preference is not a blocker.'; c.readiness = 'ready';
  const client = mockClient([plan(), draft, c]);
  const result = await runReview({ client, bundle: bundle(), taste: await loadTaste() });
  assert.equal(result.review.findings.length, 0);
  assert.equal(result.review.verdict, c.verdict);
  assert.equal(result.dropped[0].id, 'F1');
});
test('taste packs are selected by plan, not imposed universally', async () => {
  const p = plan(); p.packs = ['website']; p.task = 'Explore a homepage direction';
  const client = mockClient([p, review(), challenge()]);
  await runReview({ client, bundle: bundle(), taste: await loadTaste() });
  assert.match(client.requests[1].system, /Websites \/ visual/);
  assert.doesNotMatch(client.requests[1].system, /Fundraising \/ persuasive/);
});
