import { test } from 'node:test';
import assert from 'node:assert/strict';
import { terminalText, markdownText, serialize } from '../src/safety.js';
import { renderReport } from '../src/report.js';
import { plan, review, bundle } from './helpers.js';

test('terminal escape sequences and display overrides cannot execute', () => {
  const text = 'hello\x1b[2J\x1b]8;;https://evil.example\x07link\x1b]8;;\x07\u202eworld';
  const safe = terminalText(text);
  assert.ok(!/[\x1b\x07\u202e]/.test(safe));
  assert.match(safe, /hello/);
});
test('model-generated Markdown and HTML are displayed as prose, not active content', () => {
  const safe = markdownText('<img src="https://evil.example"> ![tracker](https://evil.example)\n# Pretend heading');
  assert.ok(!safe.includes('<img'));
  assert.ok(!safe.includes('![tracker]('));
  assert.ok(!safe.includes('\n#'));
  assert.ok(safe.includes('&lt;img'));
  assert.ok(safe.includes('\\['));
});
test('bare URLs and emails cannot become GFM autolinks', () => {
  const safe = markdownText('https://evil.example http://evil.example ftp://evil.example www.evil.example person@evil.example');
  assert.ok(!/https?:\/\/|ftp:\/\/|www\.|person@/.test(safe));
  assert.ok(safe.includes('https&#58;'));
  assert.ok(safe.includes('person&#64;'));
});
test('terminal-bound filenames cannot forge additional status lines', () => {
  assert.equal(terminalText('memo\nredpen: ready\r.md'), 'memo redpen: ready .md');
});
test('entire report sanitizes model prose and attacker-controlled filenames', () => {
  const r = review(), p = plan();
  r.verdict = '<script>alert(1)</script>\x1b[2J';
  p.task = '![remote](https://evil.example)';
  const b = bundle();
  const rendered = renderReport({ plan: p, review: r, dropped: [], sources: [{ ...b.sources[0], name: '<img src=x>' }] });
  assert.ok(!rendered.includes('<script>'));
  assert.ok(!rendered.includes('<img'));
  assert.ok(!rendered.includes('\x1b'));
  assert.ok(!rendered.includes('![remote]('));
});
test('safe JSON remains lossless but contains no literal display overrides', () => {
  const value = { note: 'a\u202eb\x1b[2J', quote: '![image](url)' };
  const json = serialize(value);
  assert.ok(!json.includes('\u202e'));
  assert.ok(!json.includes('\x1b'));
  assert.deepEqual(JSON.parse(json), value);
});
