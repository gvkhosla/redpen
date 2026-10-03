import { Effect } from 'effect';
import { errorMessage, ModelOutputError, ModelProtocolError, ModelTransportError } from './errors.js';
import type { Phase, ModelError } from './errors.js';
import type { CompletionRequest, ModelCall, PromiseModelClient } from './types.js';

export interface ModelConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
}
export function modelConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: { readonly baseUrl?: string; readonly model?: string } = {}
): ModelConfig {
  const openrouter = !env.OPENAI_API_KEY && Boolean(env.OPENROUTER_API_KEY);
  const apiKey = env.OPENAI_API_KEY || env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('Set OPENAI_API_KEY or OPENROUTER_API_KEY. Files are sent to that model provider.');
  const baseUrl = (options.baseUrl || env.REDPEN_BASE_URL || (openrouter ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1')).replace(/\/+$/, '');
  const url = new URL(baseUrl);
  if (url.username || url.password || url.search || url.hash) throw new Error('Base URL must not contain credentials, query parameters, or a fragment.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('Use an HTTPS model endpoint (HTTP is allowed only on loopback).');
  }
  return { apiKey, baseUrl, model: options.model || env.REDPEN_MODEL || (openrouter ? 'openai/gpt-5.5' : 'gpt-5.5') };
}

interface ClientOptions {
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<unknown>;
  readonly timeout?: number;
}
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
function metadata(payload: Record<string, unknown>, phase: Phase, config: ModelConfig): ModelCall {
  const raw = record(payload.usage);
  const usage: Partial<Record<'prompt_tokens' | 'completion_tokens' | 'total_tokens', number>> = {};
  for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens'] as const) {
    const value = raw[key];
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) usage[key] = value;
  }
  return { phase, model: typeof payload.model === 'string' ? payload.model.slice(0, 200) : config.model, usage: payload.usage ? usage : null };
}

export function createModelClient(config: ModelConfig, options: ClientOptions = {}): PromiseModelClient {
  const calls: ModelCall[] = [], fetchImpl = options.fetchImpl ?? fetch, timeout = options.timeout ?? 120_000;
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('Model timeout must be a positive number.');
  const redact = (value: string) => value.split(config.apiKey).join('[REDACTED]');
  const networkError = (phase: Phase) => new ModelTransportError({
    phase, status: null, retryable: false,
    message: `Model request failed during ${phase} (network, timeout, or redirect). Check endpoint and connectivity.`
  });

  function requestOnce(body: string, phase: Phase): Effect.Effect<Record<string, unknown>, ModelTransportError | ModelProtocolError> {
    return Effect.scoped(Effect.gen(function*() {
      // The controller also aborts a response body if cancellation races body acquisition.
      const controller = yield* Effect.acquireRelease(
        Effect.sync(() => new AbortController()),
        c => Effect.sync(() => c.abort())
      );
      const response = yield* Effect.tryPromise({
        try: signal => fetchImpl(`${config.baseUrl}/chat/completions`, {
          method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, controller.signal]),
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` }, body
        }),
        catch: () => networkError(phase)
      });
      yield* Effect.addFinalizer(() => Effect.promise(async () => {
        await response.body?.cancel().catch(() => {});
      }));
      if (!response.ok) return yield* Effect.fail(new ModelTransportError({
        phase, status: response.status, retryable: response.status === 429 || response.status >= 500,
        message: `Model API returned HTTP ${response.status} during ${phase}. Check key, model, endpoint, and quota.`
      }));
      const payload: unknown = yield* Effect.tryPromise({
        try: () => response.json(),
        catch: () => new ModelProtocolError({ phase, message: `Model API returned a non-JSON response during ${phase}.` })
      });
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        return yield* Effect.fail(new ModelProtocolError({ phase, message: `Model API returned a malformed completion during ${phase}.` }));
      }
      return record(payload);
    })).pipe(Effect.timeoutOrElse({
      duration: timeout,
      orElse: () => Effect.fail(networkError(phase))
    }));
  }

  function completeEffect<T>(request: CompletionRequest<T>): Effect.Effect<T, ModelError> {
    return Effect.gen(function*() {
      const { phase, system, content, contract, validate } = request;
      let validationError: string | undefined;
      for (let formatAttempt = 0; formatAttempt < 2; formatAttempt++) {
        const messages = [
          { role: 'system', content: system + '\nReturn one JSON object satisfying the following contract, with no extra fields. The contract may be a JSON Schema document. Use empty arrays when appropriate. No Markdown fences.\n' + JSON.stringify(contract) +
            (validationError ? '\nYour previous response failed validation: ' + validationError + '. Produce a corrected response from the evidence.' : '') },
          { role: 'user', content }
        ];
        const body = JSON.stringify({ model: config.model, response_format: { type: 'json_object' }, messages });
        let attempt = 0;
        const payload = yield* Effect.suspend(() => {
          attempt++;
          return requestOnce(body, phase);
        }).pipe(
          Effect.tapError(error => {
            if (error._tag !== 'ModelTransportError' || !error.retryable || attempt >= 3) return Effect.void;
            return options.sleep
              ? Effect.tryPromise({ try: signal => options.sleep!(500 * attempt, signal), catch: () => networkError(phase) })
              : Effect.sleep(500 * attempt);
          }),
          Effect.retry({ times: 2, while: error => error._tag === 'ModelTransportError' && error.retryable })
        );
        calls.push(metadata(payload, phase, config));
        const decoded = yield* Effect.try({
          try: () => {
            const choice = record(Array.isArray(payload.choices) ? payload.choices[0] : undefined);
            if (choice.finish_reason === 'length') throw new Error('response was truncated');
            const message = record(choice.message);
            if (message.refusal) throw new Error('model refused the request');
            if (typeof message.content !== 'string') throw new Error('missing JSON response content');
            return validate(JSON.parse(message.content));
          },
          catch: error => new ModelOutputError({ phase, message: redact(errorMessage(error)).slice(0, 500) })
        }).pipe(Effect.match({
          onSuccess: value => ({ ok: true as const, value }),
          onFailure: error => ({ ok: false as const, error })
        }));
        if (decoded.ok) return decoded.value;
        validationError = decoded.error.message;
      }
      return yield* Effect.fail(new ModelOutputError({
        phase: request.phase, message: `Model returned invalid output during ${request.phase}: ${validationError}`
      }));
    });
  }
  return {
    calls, completeEffect,
    complete: (request, options) => Effect.runPromise(completeEffect(request), options)
  };
}
