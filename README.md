# redpen

**Understand the task. Choose the right review. Tell me what actually matters.**

An adaptive review agent for knowledge work: pitch decks, website designs, memos,
proposals, and whatever comes next.

The task determines the review—not a universal scorecard or a fixed panel of
personas. Taste proposes what matters. Evidence grounds the judgment. Human
feedback informs the next pass.

[See an illustrative review](examples/sample-report.md) of the included synthetic memo.

## Try it

Requires **Node 22+** and an OpenAI-compatible model API.

```sh
npm install -g git+https://github.com/gvkhosla/redpen.git#v0.2.0
export OPENAI_API_KEY="your-key"

redpen review ./memo.md --task "Help the team make a decision"
```

No npm registry release yet; install from the tagged GitHub repo.

Or clone and run the included example:

```sh
git clone https://github.com/gvkhosla/redpen.git
cd redpen
npm ci
export OPENAI_API_KEY="your-key"

node dist/cli.js review examples/memo.md \
  --context examples/brief.md \
  --task "Get approval for a two-week pilot" \
  --out .redpen/first-review
```

**Privacy:** supplied files, context, screenshots, feedback, and prior findings
are sent to your model provider. This is not an offline tool.

## What happens

1. **Understand the task.** Infer purpose, audience, stage, stakes, and the quality
   bar. Expose assumptions and only material unanswered questions.
2. **Compose a review plan.** Select 1–4 relevant lenses and the evidence they need.
   Don't demand launch polish from an exploratory draft.
3. **Gather evidence.** Load local text, extract PDF text by page, and pass supplied
   images to a vision-capable model.
4. **Review with judgment.** Apply selected standards and holistic taste. Notice
   what the plan missed. Prioritize at most eight changes; don't fill a quota.
5. **Challenge findings.** Validate quotes against source lines, then run a separate
   same-model critique to cut unsupported or unhelpful feedback and update the verdict.
6. **Deliver useful feedback.** Bottom line, ranked changes, evidence, why each
   matters, what to do, how to assess improvement, and what to preserve.
7. **Reassess.** Compare against a prior review, incorporating human corrections
   without treating compliance as proof of improvement.

One model plans, reviews, and challenges. This is not independent multi-model
validation. Usually **three API calls** per full review; plan-only uses one,
and supplying an existing plan uses two. Invalid JSON gets one corrective retry
per phase; rate limits/server errors get bounded retries. Artifacts are sent
again in each phase, so larger inputs cost more.

## Review setup you can inspect

```sh
redpen review ./homepage.png ./copy.md \
  --task "Explore a distinctive homepage for architecture firms" \
  --plan-only --out .redpen/homepage-plan

# Read/edit .redpen/homepage-plan/plan.json, then:
redpen review ./homepage.png ./copy.md \
  --plan .redpen/homepage-plan/plan.json \
  --out .redpen/homepage-review
```

The plan records intent, assumptions, questions, lenses, checks, evidence needs,
out-of-scope work, and a stopping condition. V1 cannot ask follow-up questions
interactively or autonomously fetch missing evidence; it produces a conditional
review and identifies what a human should supply or test.

## Different tasks, different standards

```sh
redpen review ./deck.pdf --task "Earn a first pre-seed investor meeting"
redpen review ./desktop.png ./mobile.png --task "Review the visual design before launch"
redpen review ./proposal.md --task "Help a skeptical buyer approve a small pilot"
```

Supported inputs: `.md`, `.txt`, `.html`, `.htm`, `.csv`, `.json`, `.pdf`,
`.png`, `.jpg`, `.jpeg`, `.webp`. Supply multiple files to combine evidence.

**Inspection limits are explicit:**
- PDFs: text by page, not rendered slides, charts, or layout. Add screenshots for
  visual critique. Scanned/image-only PDFs need exported screenshots; no OCR.
- Screenshots: visual observations, not verified interactions, accessibility,
  responsive behavior at unseen widths, or conversion performance.
- HTML: source only. No browser rendering or script execution.
- URLs/PPTX: not supported. Export local HTML/screenshots or PDF/Markdown.
- No external research or fact verification. A quoted claim is not a verified fact.

Limits: 12 files, 10 MiB/file, 25 MiB combined, 120,000 extracted text characters,
100 pages/PDF. PDFs are not sandboxed; use trusted exports.

## Human feedback and reassessment

```sh
redpen review examples/memo-v2.md \
  --previous .redpen/first-review/review.json \
  --feedback ./my-notes.md \
  --task "Check whether the pilot proposal actually improved" \
  --out .redpen/second-review
```

Every prior finding is reassessed as **improved**, **persists**, **regressed**, or
**unverified**. Improvement claims require current evidence. Human notes can
include rejected suggestions, constraints, and observed outcomes; they remain
reported context, not independently verified evidence.

Feedback affects this run only. There is no automatic learning, global memory,
or fine-tuning. Edit taste files deliberately when a lesson should persist.

## Taste is editable

`taste/principles.md` supplies shared editorial judgment. The planner selects
relevant starter guidance from `deck.md`, `website.md`, and `writing.md`.
Each includes weak/competent/strong anchors and annotated synthetic examples.

These are **starter heuristics, not a calibrated expert benchmark**. There is no
claim of perfect taste. Improve them using your own judgments on known work.

Findings distinguish:
- **observed** — a demonstrable defect;
- **goal** — a reasoned effect on the intended outcome;
- **taste** — an honestly labeled preference.

No universal numerical quality score. Quotes are checked deterministically.
Visual observations, absence claims, and causal judgments still require scrutiny.

## Output and configuration

Each run prints Markdown and writes a new, owner-private directory:

```text
.redpen/<unique-run>/
  plan.json      # inspectable/editable review setup
  review.json    # structured findings, sources, hashes, cuts, model usage
  report.md      # readable feedback
```

`--json` prints the JSON instead. `--quiet` suppresses progress.
`--out` must name a **new** directory; old reviews and inputs are never overwritten.
Default `.redpen/` is gitignored. Custom output paths may not be: reports include
excerpts and local paths. Keep them out of public repos.

OpenAI defaults to `gpt-5.5`. If only `OPENROUTER_API_KEY` is set, use OpenRouter
with `openai/gpt-5.5`. An OpenAI key takes precedence when both are present.

Override with `--model` / `REDPEN_MODEL` and `--base-url` / `REDPEN_BASE_URL`.
Endpoints must implement Chat Completions and JSON object response format.
Screenshot inputs also require image support. HTTPS is required, except for
loopback endpoints. Custom endpoints receive your key: trust the endpoint.

No automatic `.env` loading. Export variables, or use Node's `--env-file=.env`
when running `dist/cli.js` directly. Never commit a real key.

Exit **0** = review completed; **1** = configuration, parsing, transport, or
validation error. **130** = SIGINT cancellation; **143** = SIGTERM cancellation.
A successful command is **not** approval to ship. Interrupting a review aborts
in-flight model transport, stops later phases, and removes an empty reserved
output directory. The per-attempt timeout covers the response body as well as
connection setup. PDF parser acquisition cannot be interrupted safely; cleanup
runs once it finishes. This is not a hard PDF CPU/memory sandbox.

Generated Markdown treats model text as escaped prose: no active HTML, remote
images, model-generated links, or terminal control sequences. Raw structured
values remain in JSON; treat them as untrusted if you build another renderer.

## Use from another agent

Install the CLI, then copy [SKILL.md](SKILL.md) into your agent's skills directory.
Provide the task and context from the working conversation, inspect the plan,
run the review, and apply judgment to the findings—not blind obedience.

## Implementation

Strict TypeScript source lives in `src/`; `tsc` builds executable JavaScript and
declarations into `dist/`. The CLI and report formatting stay straightforward.

Effect 4 is used where it earns its keep:
- Runtime schemas infer plan/finding/evidence types and generate model JSON Schemas.
- The engine composes planning, review, and challenge as one Effect program.
- Transport failures are tagged, transient-status retries are bounded, and abort
  signals propagate through the whole review.
- Scopes own response cancellation and PDF document cleanup.

`runReview(request)` remains a Promise interface. `reviewEffect(request)` is the
native composition interface; model adapters implement `completeEffect`.
No layers or services for every function, browser tooling, or new review behavior
were added in this migration. Saved JSON remains version 1; prior v0.1 reviews
and edited plans remain readable.

## Develop

```sh
npm ci
npm test
npm run check
npm pack --dry-run
```

Node's built-in tests cover parsing, quote grounding, schemas, provider handling,
plan selection, challenge cuts, reassessment, CLI execution, and packaging-style
symlinks. Regression tests also cover typed failures, bounded retries, full-request
timeouts, interruption, scope cleanup, and CLI SIGINT handling. Compile-only type
tests guard evidence and error unions. Transport integration tests use a local
fake API. CI runs Node 22 and 24.

Git installs build through `prepare`; package archives contain compiled `dist/`
and taste files. `npm ci` also builds; after `npm ci --ignore-scripts`, run
`npm run build` before invoking the CLI.

Automated tests prove deterministic behavior, **not review quality**. To calibrate:
review known examples yourself, run redpen, compare important misses, false
positives, prioritization, and preservation, then edit the taste files. V1's API
transport has been tested with controlled responses; live model-quality validation
is still needed.

## Relationship to preflight

[preflight](https://github.com/gvkhosla/preflight) reviews code against real diffs
and executable checks. Redpen reviews knowledge work against intent, explicit
taste, and available evidence. Shared philosophy; different grounds for judgment.

## License

MIT
