import { mapStrings, markdownText } from './safety.js';
import type { ReviewResult } from './types.js';

function evidenceLines(evidence: readonly { readonly source: string; readonly locator: string; readonly kind: string; readonly detail: string }[]): string {
  return evidence.map(e => `  - **${e.source} · ${e.locator}** (${e.kind}): ${e.detail}`).join('\n');
}

export function renderReport(input: ReviewResult): string {
  // Model output and artifact names are prose, never executable Markdown/HTML.
  const result = mapStrings(input, markdownText);
  const p = result.plan;
  const lines = [
    '# redpen', '', '## Review setup', '',
    `**Task:** ${p.task}`, `**Purpose:** ${p.purpose}`, `**Audience:** ${p.audience}`,
    `**Stage:** ${p.stage}`, `**Stakes:** ${p.stakes}`, `**Quality bar:** ${p.qualityBar}`, '',
    ...p.lenses.flatMap(l => [`### ${l.name}`, l.why, `Evidence: ${l.evidenceNeeded}`, ...l.checks.map(c => `- ${c}`), '']),
    '**Assumptions:**', ...p.assumptions.map(s => `- ${s}`),
    '', '**Questions that could change the review:**', ...(p.questions.length ? p.questions.map(s => `- ${s}`) : ['- None identified.']),
    '', '**Out of scope:**', ...p.outOfScope.map(s => `- ${s}`),
    '', `**Stop when:** ${p.stopWhen}`, ''
  ];
  if (result.review) {
    const r = result.review;
    lines.push('## Bottom line', '', `**${r.readiness}** — ${r.verdict}`, '', '## Prioritized changes', '');
    if (!r.findings.length) lines.push('No findings survived the review checks. This is not proof the work is ready.', '');
    r.findings.forEach((f, i) => lines.push(
      `### ${i + 1}. ${f.title} (${f.id})`,
      `**${f.impact} impact · ${f.basis} · ${f.confidence} confidence**`, '',
      evidenceLines(f.evidence), '', `**Why it matters:** ${f.why}`,
      `**Change:** ${f.action}`, `**Check improvement:** ${f.verify}`, ''
    ));
    lines.push('## Preserve', '');
    if (!r.preserve.length) lines.push('No specific preservation notes identified.', '');
    r.preserve.forEach(s => lines.push(`- ${s.point}`, evidenceLines(s.evidence), ''));
    if (r.reassessment.length) {
      lines.push('## Reassessment', '');
      r.reassessment.forEach(s => lines.push(`- **${s.previousId}: ${s.status}** — ${s.reason}`, evidenceLines(s.evidence), ''));
    }
    lines.push('## Unknowns and limits', '', ...r.unknowns.map(u => `- ${u}`), '');
    if (result.dropped?.length) lines.push('## Findings cut by review checks', '', ...result.dropped.map(d => `- **${d.id}:** ${d.reason}`), '');
  } else {
    lines.push('## Inspection limits', '', ...result.limitations.map(l => `- ${l}`), '');
  }
  lines.push('## Sources', '', ...result.sources.map(s => `- **${s.id}:** ${s.name} (${s.kind})`), '',
    '_Model-generated review. Same-model challenge is not independent validation. No external facts verified._', '');
  return lines.join('\n');
}
