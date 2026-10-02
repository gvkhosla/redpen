---
name: redpen
description: Adaptive review of knowledge work. Use to review a deck, website design, memo, or proposal against its purpose, or to reassess a revision using prior findings and human feedback.
---

# redpen

## Prepare
1. Check `redpen --help` to confirm the CLI is installed.
2. Identify purpose, audience, stage, constraints, and intended next action from
   the working conversation. Save relevant context in a local brief.
3. Ask before sending confidential work to an external model provider.

Complete when the task is explicit enough to select a review standard and the
human has authorized external processing.

## Design the review
Run:

```sh
redpen review <local-files...> --task "<intended outcome>" \
  --context <brief.md> --plan-only --out <new-plan-directory>
```

Inspect plan.json. Correct material assumptions, irrelevant lenses, and checks
that need unavailable evidence. Add screenshots for visual review; PDF and HTML
are text/source evidence only. Obtain needed context or accept a conditional review.

Complete when each lens is appropriate to this task and evidence limits are visible.

## Review
Run:

```sh
redpen review <local-files...> --plan <plan-directory>/plan.json \
  --context <brief.md> --json --out <new-review-directory>
```

Read review.json. Present the highest-impact surviving findings, their evidence,
recommended changes, preservation notes, and unknowns. Distinguish defects,
goal-based judgments, and taste preferences. Evaluate tradeoffs before making edits.

Complete when the human can decide what to change and what to preserve.

## Reassess
After revisions, run with `--previous <review-directory>/review.json`.
If the human corrected a finding or reported an outcome, include those notes with
`--feedback <notes.md>`.

Report improved, persisting, regressed, and unverified issues. Acceptance of a
suggestion is not evidence of improvement. Exit 0 means a completed review, not
permission to ship. Taste changes require explicit edits; v1 does not learn globally.
