# Changelog

## 0.3.0

- Agent-first review skill: Pi and portable Agent Skills hosts judge in their
  existing session, with no separate model API key or agent subprocess.
- Default review prepares frozen private evidence and phase prompts. next/accept
  replay the shared Effect engine, validate submissions, ground quotes, and render.
- Explicit --api retains standalone provider support; API env is ignored by default.
- Atomic exclusive accepted phases, bounded checksummed snapshots, safe image paths,
  symlink-resistant workspace reads, resume, and stale/duplicate phase rejection.
- Portable skill installer, bundled helper/taste references, and Pi package manifest.
- Production-only Git installs run from source with a bundled Jiti runtime.
- Retained version-1 reports, approved plans, plan-only review, and reassessment.
- Added deterministic agent-mode, installation, and source-bootstrap tests.
- No claims of independently verified taste, visual facts, or improved model quality.

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
