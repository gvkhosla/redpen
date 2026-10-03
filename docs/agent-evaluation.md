# Agent integration evaluation

## v0.3.0

### Live Pi smoke test

A noninteractive Pi session used its existing openai-codex managed authentication
and gpt-6.1-sol model. It loaded the portable redpen skill and reviewed the included
synthetic memo against the synthetic brief, completing plan, review, and challenge
through local helper operations.

The helper came from a production-only package copy with no dist/ and no TypeScript
compiler. It loaded source using the runtime Jiti dependency. The finished version-1
report contained two surviving findings and calls: []: no redpen API transport.

Pi was run with startup networking disabled, ordinary local file/command tools,
no discovered extensions or context files, and ephemeral session storage. Model
inference still used Pi's configured provider. No managed credentials were printed,
copied, or passed to redpen. Private logs and evidence remain in ignored .redpen/.

This verifies a real Pi host integration, not an independent judgment-quality
benchmark or a claim that the two findings were expert-calibrated.

### Deterministic verification

Tests exercise the full agent loop without credentials/fetch, frozen text and
image evidence, prompt image paths without base64, schema/cross-reference rejection,
quote grounding, plan-only and approved-plan flows, feedback and prior finding
coverage, stale/duplicate/concurrent submissions, workspace mutation detection,
unsafe image names and symlinks, portable skill copying/PATH fallback, and complete
source-only helper execution.

Existing API tests still exercise explicit --api, transport cancellation, resource
cleanup, retry/time limits, and output safety. Type checks guard native contracts.

A clean production-only npm install with --omit=dev --legacy-peer-deps also ran the
source helper successfully without the dev compiler.

### Other hosts and limits

Claude Code and Codex installation paths are documented; their portable skill
format and fixed CLI fallback do not require a provider integration. The copied
helper has a deterministic PATH-fallback test. No live Claude Code, Codex editorial
workflow, or image-review evaluation was performed for this release.

Host models may ignore a skill, stop early, or produce invalid JSON. Explicit skill
invocation improves routing; schema errors are repairable but the helper cannot
guarantee an agent follows all instructions. Tests do not prove model judgment,
visual accuracy, resistance to all prompt injection, or high-stakes readiness.
