import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Effect } from 'effect';
import { extractPdfEffect } from '../dist/artifacts.js';
import { createModelClient } from '../dist/llm.js';
import { runReview, reviewEffect, loadTaste } from '../dist/engine.js';
import { MODEL_SCHEMAS, validatePlan, validateReview } from '../dist/schema.js';
import { plan, review, bundle, challenge, mockClient } from './helpers.js';

const config = { apiKey: 'private-test-key', baseUrl: 'https://model.example/v1', model: 'test-model' };
const request = { phase: 'plan', system: 'test', content: [], contract: MODEL_SCHEMAS.plan, validate: validatePlan };
function gate() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function fakePdf(getTextContent, destroyed, pages = 1) {
  return {
    numPages: pages,
    getPage: async () => ({ getTextContent }),
    loadingTask: { destroy: async () => { destroyed.push('closed'); } }
  };
}

test('Effect PDF scope closes on successful extraction', async () => {
  const destroyed = [];
  const pdf = fakePdf(async () => ({ items: [{ str: 'A readable slide.', hasEOL: true }] }), destroyed);
  const sources = await Effect.runPromise(extractPdfEffect(new Uint8Array(), 'A1', 'deck.pdf', 100, async () => pdf));
  assert.equal(sources[0].text, 'A readable slide.');
  assert.deepEqual(destroyed, ['closed']);
});
test('Effect PDF scope closes on parser failures and page-limit failures', async () => {
  for (const pages of [1, 101]) {
    const destroyed = [], pdf = fakePdf(async () => { throw new Error('Parsing failed.'); }, destroyed, pages);
    await assert.rejects(Effect.runPromise(extractPdfEffect(new Uint8Array(), 'A1', 'deck.pdf', 100, async () => pdf)),
      error => error._tag === 'ArtifactError');
    assert.deepEqual(destroyed, ['closed']);
  }
});
test('Effect PDF scope closes when extraction is interrupted', async () => {
  const destroyed = [], started = gate(), controller = new AbortController();
  const pdf = fakePdf(() => { started.resolve(); return new Promise(() => {}); }, destroyed);
  const running = Effect.runPromise(extractPdfEffect(new Uint8Array(), 'A1', 'deck.pdf', 100, async () => pdf), { signal: controller.signal });
  await started.promise;
  controller.abort();
  await assert.rejects(running);
  assert.deepEqual(destroyed, ['closed']);
});
test('transient status retries are capped at three attempts and release every body', async () => {
  let attempts = 0, closed = 0;
  const delays = [];
  const client = createModelClient(config, {
    fetchImpl: async () => {
      attempts++;
      return new Response(new ReadableStream({ cancel() { closed++; } }), { status: 503 });
    },
    sleep: async ms => { delays.push(ms); }
  });
  await assert.rejects(client.complete(request), error => error._tag === 'ModelTransportError' && error.status === 503 && !error.message.includes(config.apiKey));
  assert.equal(attempts, 3); assert.equal(closed, 3);
  assert.deepEqual(delays, [500, 1000]);
});
test('authentication failures are typed, not retried, and do not echo bodies', async () => {
  let attempts = 0;
  const client = createModelClient(config, { fetchImpl: async () => { attempts++; return new Response(config.apiKey, { status: 401 }); } });
  await assert.rejects(client.complete(request), error => error._tag === 'ModelTransportError' && !error.retryable && !error.message.includes(config.apiKey));
  assert.equal(attempts, 1);
});
test('invalid provider envelopes and non-JSON bodies have protocol errors', async () => {
  for (const body of ['null', '[]', 'not-json']) {
    const client = createModelClient(config, { fetchImpl: async () => new Response(body) });
    await assert.rejects(client.complete(request), error => error._tag === 'ModelProtocolError');
    assert.equal(client.calls.length, 0);
  }
});
test('invalid model output retains a tagged error after its one correction attempt', async () => {
  const client = createModelClient(config, { fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] })) });
  await assert.rejects(client.complete(request), error => error._tag === 'ModelOutputError' && error.phase === 'plan');
  assert.equal(client.calls.length, 2);
});
test('request timeout aborts the underlying fetch without retrying', async () => {
  let signal, attempts = 0;
  const client = createModelClient(config, {
    timeout: 20,
    fetchImpl: async (_url, options) => {
      attempts++; signal = options.signal;
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    }
  });
  await assert.rejects(client.complete(request), error => error._tag === 'ModelTransportError' && !error.retryable);
  assert.equal(signal.aborted, true); assert.equal(attempts, 1);
});
test('abort and timeout close a real HTTP response stalled after headers', { timeout: 5000 }, async t => {
  for (const mode of ['abort', 'timeout']) {
    const started = gate(), bodyClosed = gate(), controller = new AbortController();
    const server = createServer((_req, res) => {
      res.on('close', () => bodyClosed.resolve());
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{"choices":');
      started.resolve();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const client = createModelClient({ ...config, baseUrl: 'http://127.0.0.1:' + server.address().port + '/v1' }, { timeout: mode === 'timeout' ? 200 : 60_000 });
    const running = client.complete(request, { signal: controller.signal });
    await started.promise;
    if (mode === 'abort') controller.abort();
    await assert.rejects(running, error => mode === 'abort' || error._tag === 'ModelTransportError');
    await bodyClosed.promise;
    assert.equal(client.calls.length, 0);
  }
});
test('review cancellation aborts transport and prevents downstream review phases', async () => {
  const started = gate(), controller = new AbortController();
  let signal, attempts = 0;
  const client = createModelClient(config, {
    fetchImpl: async (_url, options) => {
      attempts++; signal = options.signal; started.resolve();
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    }
  });
  const running = runReview({ client, bundle: bundle(), taste: await loadTaste(), signal: controller.signal });
  await started.promise; controller.abort();
  await assert.rejects(running);
  assert.equal(signal.aborted, true); assert.equal(attempts, 1);
  assert.equal(client.calls.length, 0);
});
test('review can also be composed through its native Effect interface', async () => {
  const client = mockClient([plan(), review(), challenge()]);
  const result = await Effect.runPromise(reviewEffect({ client, bundle: bundle(), taste: await loadTaste() }));
  assert.equal(result.review.findings[0].id, 'F1');
  assert.deepEqual(client.calls.map(c => c.phase), ['plan', 'review', 'challenge']);
});
test('schemas reject malformed evidence even in unverified reassessment entries', () => {
  const prior = { version: 1, plan: plan(), review: review() }, r = review();
  r.reassessment = [{ previousId: 'F1', status: 'unverified', reason: 'Not inspected.', evidence: [{ kind: 'magic' }] }];
  assert.throws(() => validateReview(r, prior), error => error._tag === 'ValidationError');
});
