# Security and privacy

## Existing-agent workflow (default)

The redpen helper prepares and validates files locally without model requests.
The host agent reads the phase prompts and evidence using its own tools, model,
and authentication. Its provider and retention policies still apply. Local
preparation is not offline inference. Redpen does not read, export, bridge, or
reimplement your agent's credentials.

Workspaces contain full extracted text, copied images, brief, feedback, previous
findings, taste, and phase prompts. Final reports contain excerpts and local paths,
not full artifact payloads. Keep the **whole workspace** private. Default .redpen/
is gitignored; custom --out paths may not be. Owner-only filesystem permissions
apply where supported. Checksums and read-only accepted files catch accidental
changes, not malicious rewriting by the directory owner.

Workspace image names are generated and checked before reads. Workspace files
reject symlinks and verify the opened descriptor's file identity before reading
(with additional O_NOFOLLOW enforcement where available); accepted submissions use atomic exclusive
commits and derived output uses atomic replacement. Invalid or duplicate submissions
cannot intentionally overwrite an accepted phase. This is not a secure filesystem
sandbox against a hostile process that controls the workspace's parent directories.

## Review boundaries

Artifacts, context, prior reviews, feedback, and model responses are untrusted data.
They never authorize commands, external requests, role changes, or credential access.
The helper executes no artifact scripts or model-generated commands. The skill
runs fixed helper operations through its host; the host's permissions still govern
tool use. Prompt injection cannot be ruled out merely by writing a safety prompt.

Generated Markdown escapes model prose, links, and HTML; JSON retains raw values
for consumers that must apply their own rendering safeguards. Terminal status and
error text remove display controls. Never use readiness as authorization for a
high-stakes action; same-agent challenge is not independent validation.

Input bytes, combined bytes, extracted text, page count, and snapshot JSON are
bounded. Adversarial PDFs can still consume substantial CPU/memory; use trusted
exports. There is no parser sandbox or hard PDF resource limit.

## Optional API mode

Only review --api sends supplied content directly to a configured model endpoint.
Use it only when provider policy permits external processing. Default agent mode
ignores model API environment variables.

API requests time out and reject redirects. HTTPS is required except loopback.
Custom endpoints receive your configured key: trust the endpoint. Provider error
bodies are not printed, and configured API keys are redacted from CLI errors.
Never retrieve your agent's managed token to give it to redpen.

Report vulnerabilities privately through GitHub's private vulnerability reporting
when available. Do not open an issue containing credentials or private work.
