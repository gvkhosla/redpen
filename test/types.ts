import type { Source, CompletionRequest, ModelClient } from '../src/types.js';
import type { Finding, ReviewPlan, Evidence } from '../src/schema.js';
import type { ModelError } from '../src/errors.js';
import { validatePlan, MODEL_SCHEMAS } from '../src/schema.js';

export function sourceNarrowing(source: Source): string {
  if (source.kind === 'image') {
    // @ts-expect-error image evidence cannot be treated as extracted text
    const text: string = source.text;
    void text;
    return source.dataUrl;
  }
  // @ts-expect-error text evidence has no image payload
  const url: string = source.dataUrl;
  void url;
  return source.text;
}

export function invalidContracts(): void {
  // @ts-expect-error feedback labels are a closed union
  const basis: Finding['basis'] = 'objective-truth';
  // @ts-expect-error evidence kinds are a closed union
  const kind: Evidence['kind'] = 'web-research';
  void basis;
  void kind;
}

export function failureNarrowing(error: ModelError): number | null {
  if (error._tag === 'ModelTransportError') return error.status;
  // @ts-expect-error protocol/output failures do not expose HTTP status
  const status: number = error.status;
  void status;
  return null;
}

export function providerResult(client: ModelClient) {
  const request: CompletionRequest<ReviewPlan> = {
    phase: 'plan', system: '', content: [], contract: MODEL_SCHEMAS.plan, validate: validatePlan
  };
  return client.completeEffect(request);
}
