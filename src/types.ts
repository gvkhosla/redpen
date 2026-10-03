import type { Effect } from 'effect';
import type { Phase, ModelError } from './errors.js';
import type { ReviewPlan, Review, Challenge } from './schema.js';

export interface TextSource {
  readonly id: string;
  readonly name: string;
  readonly kind: 'text';
  readonly text: string;
}

export interface ImageSource {
  readonly id: string;
  readonly name: string;
  readonly kind: 'image';
  readonly mime: string;
  readonly dataUrl: string;
}

export type Source = TextSource | ImageSource;
export interface Artifact {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly sha256: string;
}
export interface ArtifactBundle {
  readonly artifacts: readonly Artifact[];
  readonly sources: readonly Source[];
  readonly limitations: readonly string[];
}
export type SourceManifest = Pick<Source, 'id' | 'name' | 'kind'>;
export type MessagePart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image_url'; readonly image_url: { readonly url: string } };

export interface ModelCall {
  readonly phase: Phase;
  readonly model: string;
  readonly usage: Readonly<Partial<Record<'prompt_tokens' | 'completion_tokens' | 'total_tokens', number>>> | null;
}
export interface CompletionRequest<T> {
  readonly phase: Phase;
  readonly system: string;
  readonly content: readonly MessagePart[];
  readonly contract: unknown;
  readonly validate: (input: unknown) => T;
}
export interface ModelClient {
  readonly calls: readonly ModelCall[];
  completeEffect<T>(request: CompletionRequest<T>): Effect.Effect<T, ModelError>;
}
export interface PromiseModelClient extends ModelClient {
  complete<T>(request: CompletionRequest<T>, options?: { readonly signal?: AbortSignal }): Promise<T>;
}
export type Taste = Readonly<Record<'principles' | 'deck' | 'website' | 'writing', string>>;

export interface PreviousReview {
  readonly version: 1;
  readonly plan: ReviewPlan;
  readonly review: Review;
}
export interface DroppedFinding {
  readonly id: string;
  readonly reason: string;
}
export interface ReviewSetup {
  readonly version: 1;
  readonly createdAt: string;
  readonly task: string;
  readonly plan: ReviewPlan;
  readonly artifacts: readonly Artifact[];
  readonly sources: readonly SourceManifest[];
  readonly limitations: readonly string[];
  readonly calls: readonly ModelCall[];
}
export interface PlanResult extends ReviewSetup {
  readonly review?: never;
  readonly challenge?: never;
  readonly dropped?: never;
}
export interface FullReviewResult extends ReviewSetup {
  readonly review: Review;
  readonly challenge: Challenge;
  readonly dropped: readonly DroppedFinding[];
}
export type ReviewResult = PlanResult | FullReviewResult;
