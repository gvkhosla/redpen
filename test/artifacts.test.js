import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadArtifacts, artifactMessages, sourceManifest, readBoundedFile } from '../dist/artifacts.js';
import { makePdf } from './helpers.js';

async function files(t, entries) {
  const dir = await mkdtemp(join(tmpdir(), 'redpen-artifacts-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(entries)) await writeFile(join(dir, name), content);
  return Object.keys(entries).map(name => join(dir, name));
}
test('text evidence has stable source IDs, hashes, and numbered lines', async t => {
  const paths = await files(t, { 'memo.md': 'One\nTwo', 'context.txt': 'Audience: operators' });
  const b = await loadArtifacts(paths);
  assert.equal(b.sources[0].id, 'A1'); assert.equal(b.sources[1].id, 'A2');
  assert.match(b.artifacts[0].sha256, /^[a-f0-9]{64}$/);
  assert.match(artifactMessages(b.sources)[1].text, /L2: Two/);
  assert.equal(sourceManifest(b)[0].text, undefined);
});
test('image evidence is multimodal but saved manifests omit bytes', async t => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1S0AAAAASUVORK5CYII=', 'base64');
  const b = await loadArtifacts(await files(t, { 'screen.png': png }));
  assert.equal(b.sources[0].kind, 'image');
  assert.equal(artifactMessages(b.sources)[2].type, 'image_url');
  assert.ok(!JSON.stringify(sourceManifest(b)).includes('base64'));
  assert.ok(b.limitations.some(l => l.includes('static image')));
});
test('PDF parsing preserves page sources and admits visual limits', async t => {
  const b = await loadArtifacts(await files(t, { 'deck.pdf': makePdf(['Slide one.', 'Slide two.']) }));
  assert.equal(b.sources.length, 2);
  assert.equal(b.sources[0].id, 'A1.p1'); assert.equal(b.sources[1].id, 'A1.p2');
  assert.match(b.sources[1].text, /Slide two/);
  assert.ok(b.limitations.some(l => l.includes('PDF text only')));
});
test('scanned/empty PDFs require screenshots rather than fake reviews', async t => {
  const paths = await files(t, { 'empty.pdf': makePdf(['']) });
  await assert.rejects(loadArtifacts(paths), /No extractable text/);
});
test('HTML is source evidence, not a claimed browser inspection', async t => {
  const b = await loadArtifacts(await files(t, { 'page.html': '<h1>Hello</h1>' }));
  assert.ok(b.limitations.some(l => l.includes('no page rendering')));
});
test('empty input, unsupported formats, URLs, binary and oversized text fail', async t => {
  await assert.rejects(loadArtifacts([]), /1–12/);
  await assert.rejects(loadArtifacts(['https://example.com']), /local files/);
  await assert.rejects(loadArtifacts(['deck.pptx']), /Unsupported/);
  for (const content of ['', '\u0000text']) {
    const paths = await files(t, { 'bad.txt': content });
    await assert.rejects(loadArtifacts(paths), /Empty or non-text/);
  }
  const large = await files(t, { 'large.txt': 'x'.repeat(120_001) });
  await assert.rejects(loadArtifacts(large), /120,000/);
  await assert.rejects(readBoundedFile(large[0], 12), /too large/);
});
test('too many files and excessive PDF page counts fail', async t => {
  await assert.rejects(loadArtifacts(Array(13).fill('memo.md')), /1–12/);
  const paths = await files(t, { 'long.pdf': makePdf(Array(101).fill('Slide')) });
  await assert.rejects(loadArtifacts(paths), /100 pages/);
});
