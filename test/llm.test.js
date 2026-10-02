import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelConfig, createModelClient } from '../src/llm.js';
import { validatePlan, CONTRACTS } from '../src/schema.js';
import { plan } from './helpers.js';

const config = { apiKey: 'test-secret', baseUrl: 'https://model.example/v1', model: 'test-model' };
function reply(content, status = 200) {
  return new Response(JSON.stringify({ model: 'test-model', choices: [{ finish_reason: 'stop', message: { content } }], usage: { total_tokens: 42 } }), { status });
}
const request = { phase: 'plan', system: 'test', content: [{ type: 'text', text: 'artifact' }], contract: CONTRACTS.plan, validate: validatePlan };
test('provider selection is deterministic; explicit overrides win', () => {
  assert.equal(modelConfig({ OPENAI_API_KEY: 'a', OPENROUTER_API_KEY: 'b' }).baseUrl, 'https://api.openai.com/v1');
  assert.equal(modelConfig({ OPENROUTER_API_KEY: 'b' }).model, 'openai/gpt-5.5');
  assert.equal(modelConfig({ OPENAI_API_KEY: 'a' }, { model: 'custom', baseUrl: 'http://localhost:1234/v1/' }).model, 'custom');
  assert.throws(() => modelConfig({}), /Set OPENAI_API_KEY/);
});
test('remote HTTP, embedded credentials, and query strings are rejected', () => {
  for (const baseUrl of ['http://remote.example/v1', 'https://name:pass@example.com/v1', 'https://example.com/v1?key=secret', 'https://example.com/v1#fragment']) {
    assert.throws(() => modelConfig({ OPENAI_API_KEY: 'a' }, { baseUrl }));
  }
});
test('transport uses JSON response format, multimodal content, and rejects redirects', async () => {
  let sent;
  const client = createModelClient(config, { fetchImpl: async (url, options) => { sent = { url, options }; return reply(JSON.stringify(plan())); } });
  const result = await client.complete(request);
  assert.equal(result.task, plan().task);
  assert.equal(sent.options.redirect, 'error');
  assert.equal(sent.options.headers.Authorization, 'Bearer test-secret');
  assert.equal(JSON.parse(sent.options.body).response_format.type, 'json_object');
  assert.equal(client.calls[0].usage.total_tokens, 42);
});
test('invalid JSON/schema gets one corrective attempt', async () => {
  let count = 0;
  const client = createModelClient(config, { fetchImpl: async () => reply(++count === 1 ? '{}' : JSON.stringify(plan())) });
  await client.complete(request); assert.equal(count, 2);
});
test('persistent invalid output fails; embedded keys are redacted', async () => {
  const client = createModelClient(config, { fetchImpl: async () => reply('test-secret invalid') });
  await assert.rejects(client.complete(request), error => !error.message.includes('test-secret') && error.message.includes('invalid output'));
});
test('429/5xx retry is bounded; auth errors do not echo provider bodies', async () => {
  let count = 0, sleeps = 0;
  const client = createModelClient(config, {
    fetchImpl: async () => ++count < 3 ? new Response('private input', { status: 429 }) : reply(JSON.stringify(plan())),
    sleep: async () => { sleeps++; }
  });
  await client.complete(request); assert.equal(count, 3); assert.equal(sleeps, 2);
  const bad = createModelClient(config, { fetchImpl: async () => new Response('test-secret private input', { status: 401 }) });
  await assert.rejects(bad.complete(request), error => error.message.includes('HTTP 401') && !error.message.includes('private input') && !error.message.includes('test-secret'));
});
test('network errors are actionable without exposing headers', async () => {
  const client = createModelClient(config, { fetchImpl: async () => { throw new Error('test-secret'); } });
  await assert.rejects(client.complete(request), error => error.message.includes('network') && !error.message.includes('test-secret'));
});
