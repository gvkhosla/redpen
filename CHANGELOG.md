# Changelog

## 0.2.0

- Migrated source to strict TypeScript, compiled with tsc to dist/.
- Plans, findings, and evidence types are inferred from Effect runtime schemas.
- Model JSON Schemas are generated from those same contracts.
- Native Effect orchestration with a Promise-friendly review interface.
- Tagged transport, protocol, output-validation, and artifact failures.
- Bounded transient-status retries, full-request timeouts, and cancellation.
- Scoped HTTP response cleanup and PDF cleanup on success/failure/interruption.
- SIGINT/SIGTERM stop model work and remove empty reserved output directories.
- Preserved CLI flags, taste files, reports, and version-1 saved-review compatibility.
- Added regression and compile-only type tests. No browser/research features or
  claims of improved taste from the migration itself.

## 0.1.0

- Adaptive task diagnosis and inspectable/editable review plans.
- Text, per-page PDF text, and multimodal screenshot inputs.
- Editable taste principles, anchors, and synthetic annotated examples.
- Grounded findings with observed / goal / taste labels.
- Same-model challenge pass and an audit trail of cut findings.
- Human feedback and evidence-based reassessment of previous findings.
- Markdown and JSON reports, source hashes, privacy safeguards, and CI.
- No browser automation, external research, automatic learning, or universal scores.
