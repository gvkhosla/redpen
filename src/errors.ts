import { Data } from 'effect';

export type Phase = 'plan' | 'review' | 'challenge';

export class ValidationError extends Data.TaggedError('ValidationError')<{
  readonly message: string;
}> {}

export class ModelTransportError extends Data.TaggedError('ModelTransportError')<{
  readonly message: string;
  readonly phase: Phase;
  readonly status: number | null;
  readonly retryable: boolean;
}> {}

export class ModelProtocolError extends Data.TaggedError('ModelProtocolError')<{
  readonly message: string;
  readonly phase: Phase;
}> {}

export class ModelOutputError extends Data.TaggedError('ModelOutputError')<{
  readonly message: string;
  readonly phase: Phase;
}> {}

export class ArtifactError extends Data.TaggedError('ArtifactError')<{
  readonly message: string;
}> {}

export type ModelError = ModelTransportError | ModelProtocolError | ModelOutputError;

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}
