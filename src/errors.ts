import { Data } from 'effect';
import type { MessagePart } from './types.js';

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

export class AgentResponseRequired extends Data.TaggedError('AgentResponseRequired')<{
  readonly message: string;
  readonly phase: Phase;
  readonly system: string;
  readonly content: readonly MessagePart[];
  readonly contract: unknown;
}> {}

export type ModelError = ModelTransportError | ModelProtocolError | ModelOutputError | AgentResponseRequired;

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}
