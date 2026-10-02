import { CONTRACTS } from '../src/schema.js';
export const plan = () => structuredClone(CONTRACTS.plan);
export function review() {
  const r = structuredClone(CONTRACTS.review);
  r.findings[0].evidence = [{ source: 'A1', kind: 'quote', locator: 'L1', detail: 'A useful sentence.' }];
  r.preserve = [{ point: 'Specific opening.', evidence: structuredClone(r.findings[0].evidence) }];
  return r;
}
export function bundle() {
  return {
    artifacts: [{ id: 'A1', name: 'memo.md', path: '/tmp/memo.md', sha256: 'test-hash' }],
    sources: [{ id: 'A1', name: 'memo.md', kind: 'text', text: 'A useful sentence.\nAnother sentence.' }],
    limitations: ['No external verification.']
  };
}
export function mockClient(responses) {
  const requests = [], calls = [];
  return {
    requests, calls,
    async complete(request) {
      requests.push(request); calls.push({ phase: request.phase, model: 'mock', usage: null });
      if (!responses.length) throw new Error('Unexpected model call');
      return request.validate(structuredClone(responses.shift()));
    }
  };
}
export function challenge(decision = 'keep') {
  return { verdict: 'The next action still needs work.', readiness: 'needs-work',
    decisions: [{ id: 'F1', decision, reason: 'Checked the actual evidence and effect on the task.' }], caveats: [] };
}
export function makePdf(pages = ['A synthetic PDF slide.']) {
  const escape = text => text.replace(/[\\()]/g, '\\$&');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_,i)=>`${4+i*2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  pages.forEach((text, i) => {
    const stream = `BT /F1 12 Tf 40 750 Td (${escape(text)}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5+i*2} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  });
  let document = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((value, i) => { offsets.push(Buffer.byteLength(document)); document += `${i+1} 0 obj\n${value}\nendobj\n`; });
  const xref = Buffer.byteLength(document);
  document += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  document += offsets.slice(1).map(n => `${String(n).padStart(10,'0')} 00000 n \n`).join('');
  document += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(document);
}
