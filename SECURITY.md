# Security and privacy

Redpen sends supplied artifact content, images, context, prior findings, and human
feedback to your configured model endpoint. It is not an offline reviewer.
Do not submit confidential information unless your provider policy permits it.

Reports contain excerpts and local file paths. Keep them private. The default
.redpen/ folder is gitignored, but a custom --out directory may not be.

V1 executes no model-generated commands, web requests, artifact scripts, or
embedded instructions. Treat model output as untrusted; prompt injection cannot
be ruled out. Never use a readiness verdict as authorization for a high-stakes
action. Same-model critique is not independent validation.

Inputs are bounded by file size, total size, text length, and PDF page count.
Parsing adversarial PDFs can still consume substantial resources; use trusted
exports. There is no sandbox or hard PDF CPU/memory limit in v1.

API requests time out and reject redirects. HTTPS is required except on loopback.
Custom endpoints receive your configured key: use only an endpoint you trust.
Output never includes keys or full image payloads. Provider error bodies are not
printed. Local reports are created with owner-only permissions where supported.

Report vulnerabilities privately through GitHub's private vulnerability reporting
when available, rather than opening an issue containing credentials or private work.
