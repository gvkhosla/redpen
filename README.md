# redpen

**Understand the task. Choose the right review. Tell me what actually matters.**

An adaptive review skill for knowledge work: decks, website designs, memos,
proposals, and whatever comes next. Runs **inside your existing coding agent**,
using its current model and authentication. No separate model API key required.

The task determines the review—not a universal scorecard or a fixed panel of
personas. Taste proposes what matters. Evidence grounds judgment. Human feedback
informs the next pass.

[See an illustrative review](examples/sample-report.md) of the synthetic memo.

## Install in Pi

Requires **Node 22+**.

```sh
pi install git:github.com/gvkhosla/redpen@v0.3.0
```

Run `/reload` in your active Pi session, then:

```text
/skill:redpen review ./memo.md to help the team make a decision
```

Pi does the planning, review, and challenge in **your current session**. Redpen's
local helper snapshots evidence, supplies phase prompts and schemas, checks
submissions, grounds quotes, and renders the report. It does not launch another
model agent, export your credentials, or make model requests itself.

## Claude Code, Codex, and other agents

Redpen ships a portable [Agent Skill](skills/redpen/SKILL.md). Install the CLI,
then copy the **whole skill directory**, including its helper and references:

```sh
npm install -g git+https://github.com/gvkhosla/redpen.git#v0.3.0

# Claude Code (personal skill)
redpen install-skill "$HOME/.claude/skills/redpen"

# Codex and hosts that discover the shared Agent Skills directory
redpen install-skill "$HOME/.agents/skills/redpen"
```

Choose the location your host supports; avoid duplicate copies in directories
it discovers simultaneously. Restart/reload your host and invoke its redpen skill
(or ask it to use redpen). The skill instructs **that agent** to complete every
phase automatically using its file and command tools. It is not an SDK or an
MCP server, and does not assume any particular model provider. Hosts need local
command/file tools; screenshot review also needs an image-reading tool and vision.

No npm registry release yet; install from the tagged GitHub repo. Skill copying
requires a **new** destination and never overwrites an existing skill. A copied
skill requires the redpen CLI on PATH. Pi packages carry their own helper and
runtime dependencies, so no global CLI install is needed for Pi.

**Privacy:** the helper's default workflow is local, but evidence enters your
existing agent's model context. Your agent's provider, retention, and privacy
policies still apply. This is not a promise of offline inference.

## What happens

1. **Understand the task.** Infer purpose, audience, stage, stakes, and quality bar.
   Expose assumptions and material unanswered questions.
2. **Compose a plan.** Choose 1–4 relevant lenses and the evidence they need.
   Don't demand launch polish from an exploratory draft.
3. **Inspect supplied evidence.** Load text, extract PDF text by page, and inspect
   supplied images using the host's image tool.
4. **Review with judgment.** Apply selected standards and holistic taste. Rank at
   most eight useful changes; don't fill a quota. Preserve what works.
5. **Challenge findings.** Deterministically ground quotes, cut unsupported or
   low-value feedback, and rewrite the verdict using surviving findings.
6. **Deliver feedback.** Bottom line, evidence, why it matters, actions, ways to
   judge improvement, preservation notes, and unknowns.
7. **Reassess.** Incorporate human corrections without treating compliance as
   proof of improvement.

The same agent plans, reviews, and challenges. This is **not independent
validation**. The helper cannot measure judgment quality, verify visual claims,
or prove causal effects merely by validating JSON.

## Local protocol (for debugging or custom integrations)

Ordinarily the skill handles this loop. Running `redpen review` directly prepares
an inspectable workspace; **it does not produce a finished review on its own**.

```sh
redpen review ./memo.md --task "Get approval for a two-week pilot" \
  --context ./brief.md --out .redpen/pilot --json

# Your current agent reads the returned prompt and writes schema-matching JSON.
redpen accept .redpen/pilot .redpen/pilot/plan.candidate.json --phase plan --json
redpen accept .redpen/pilot .redpen/pilot/review.candidate.json --phase review --json
redpen accept .redpen/pilot .redpen/pilot/challenge.candidate.json --phase challenge --json

# Resume at any point; accepted phases replay without model API calls.
redpen next .redpen/pilot --json
```

Pending packets include `status`, `workspace`, `phase`, `prompt`, `candidate`,
`system`, `content`, and the shared JSON Schema in `contract.schema`. Image parts
use local `image_file` paths, never base64 prompt dumps. `accept` applies the full
runtime and cross-reference validation, then returns the next phase or a
`status: "complete"` packet containing the version-1 result and Markdown report.
Invalid submissions leave the stage pending; stale/duplicate submissions fail.
`prepare` is an alias for local `review`.

Inputs, brief, feedback, prior findings, approved plan, and taste are frozen at
preparation. Later edits to original files do not affect that run. Checksums detect
accidental workspace mutation; this is not tamper-proof storage against its owner.
Keep the snapshot and accepted responses untouched. Write candidates separately.
To change evidence or assumptions, prepare a new workspace.

### Plan approval

Use `--plan-only` and complete the plan submission. Inspect the resulting
`plan.json`; edit a separate copy if needed. Start a fresh full review with
`--plan <approved-plan.json>`. An approved plan skips the planning phase.

### Reassessment

```sh
redpen review examples/memo-v2.md \
  --previous .redpen/first-review/review.json --feedback ./my-notes.md \
  --task "Check whether the pilot proposal actually improved" \
  --out .redpen/second-review --json
```

The skill completes the returned stages. Every prior finding is reassessed as
**improved**, **persists**, **regressed**, or **unverified**. Improvement requires
current evidence. Human notes remain reported context, not independently verified
outcomes. Feedback affects this run only: no automatic learning or global memory.

## Inputs and inspection limits

Supported: `.md`, `.txt`, `.html`, `.htm`, `.csv`, `.json`, `.pdf`, `.png`, `.jpg`,
`.jpeg`, `.webp`. Supply multiple local files to combine evidence.

- **PDF:** text by page, not rendered layout/charts. Add screenshots for visuals.
  Scanned/image-only PDFs need screenshots; no OCR.
- **Screenshots:** visible observations only, not tested interactions, accessibility,
  responsive behavior at unseen widths, or conversion performance.
- **HTML:** source only; no browser rendering or script execution.
- **URLs/PPTX:** export local HTML/screenshots or PDF/Markdown.
- No external research or fact verification. A quoted claim is not a verified fact.

Limits: 12 files, 10 MiB/file, 25 MiB combined, 120,000 extracted text characters,
100 pages/PDF; local snapshot JSON is bounded to 4 MiB. PDFs are not sandboxed;
use trusted exports. The review standard follows the task, not the file extension.

## Taste is editable

`taste/principles.md` supplies shared judgment. The planner selects starter packs
from `deck.md`, `website.md`, and `writing.md`. They contain weak/competent/strong
anchors and annotated synthetic examples: **heuristics, not a calibrated expert
benchmark**. Package builds copy canonical taste into the portable skill references.

Findings distinguish **observed** defects, **goal**-based judgment, and **taste**
preferences. No universal quality score. Quotes are checked deterministically;
visual observations, absence claims, and predictions still need scrutiny.

## Output and safety

Each run reserves a new owner-private directory:

```text
.redpen/<unique-run>/
  snapshot.json, snapshot.sha256  # private frozen inputs, context, and taste
  A1.png, ...                    # supplied image copies, when applicable
  <phase>.prompt.json            # complete phase packet
  <phase>.candidate.json         # written by your agent
  accepted-plan.json             # immutable accepted plan envelope
  draft.json, challenge.json     # immutable accepted phase envelopes
  plan.json                      # readable/exportable plan
  review.json, report.md         # final result and report after completion
```

`--out` must be new. `--json` prints a stage packet locally (not a fake finished
result); without it, pending output points to the prompt. Final reports contain
excerpts, hashes, and local paths, **not** full evidence or base64 images. Workspaces
and prompts **do contain full private evidence**. Keep the entire directory private;
default `.redpen/` is gitignored, but custom paths may not be.

Generated Markdown escapes model text: no active HTML, remote images, generated
links, or terminal controls. JSON values remain untrusted data for custom renderers.
Artifacts and human feedback never authorize tool actions or credential access.
Readiness is not authorization for a high-stakes decision.

Exit **0** = helper operation succeeded; in agent mode a pending operation still
needs judgment. **1** = parsing/configuration/validation/transport error,
**130** = SIGINT, **143** = SIGTERM. Accepted progress survives interruption.

## Optional standalone API mode

Only an explicit `--api` makes direct model requests. API environment variables
are ignored in the default agent workflow.

```sh
export OPENAI_API_KEY="your-key"
redpen review ./memo.md --api --task "Help the team make a decision"
```

Usually three API calls: plan, review, challenge; plan-only uses one and an approved
plan uses two. Invalid output gets one correction retry; transient failures get
bounded retries. Supplied evidence is resent in each phase. Screenshots require a
vision-capable API model. This mode sends files directly to the configured endpoint.

Defaults: OpenAI `gpt-5.5`; with only `OPENROUTER_API_KEY`, OpenRouter
`openai/gpt-5.5`. Override with `--model` / `REDPEN_MODEL` and `--base-url` /
`REDPEN_BASE_URL`. An OpenAI key takes precedence when both keys are present.
HTTPS required except loopback; custom endpoints receive your key and must support
Chat Completions with JSON object output. No automatic `.env` loading. Never
export your coding agent's credentials to redpen.

API cancellation aborts transport and cleans an empty reserved output directory.
Timeouts include the response body. PDF acquisition cannot safely be interrupted;
cleanup runs when it finishes. See [SECURITY.md](SECURITY.md).

## Develop

```sh
npm ci
npm test
npm run check
npm pack --dry-run
```

Strict TypeScript in `src/` builds to `dist/`. Effect schemas infer domain types
and JSON contracts; one Effect engine orchestrates both adapters. The local file
adapter suspends on a tagged pending response and replays accepted phases through
the same validation, quote grounding, challenge, and report logic. API mode retains
bounded retries, typed failures, cancellation, and scoped transport/PDF cleanup.
Saved results remain version 1; prior reviews and edited plans stay readable.

Git installs compile when the dev compiler is available. Pi's production-only
Git install skips compilation; the helper loads source through the bundled Jiti
runtime. Archives include compiled `dist/` plus source fallback. No Pi SDK peers
or model credentials are required. `prepack` always builds.

Deterministic tests cover the agent loop, frozen inputs, image paths, safe reads,
invalid/stale/concurrent submissions, reassessment, skill copying, source bootstrap,
and the existing API/Effect safety and resource tests. Tests prove mechanics,
**not review quality**. Live host evaluations and their limits are recorded in
[docs/agent-evaluation.md](docs/agent-evaluation.md).

## Relationship to preflight

[preflight](https://github.com/gvkhosla/preflight) reviews code against real diffs
and executable checks. Redpen reviews knowledge work against intent, explicit
taste, and supplied evidence. Shared philosophy; different grounds for judgment.

## License

MIT
