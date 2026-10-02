import { setTimeout as delay } from 'node:timers/promises';

export function modelConfig(env = process.env, options = {}) {
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

export function createModelClient(config, { fetchImpl = fetch, sleep = delay, timeout = 120_000 } = {}) {
  const calls = [];
  const redact = value => String(value).split(config.apiKey).join('[REDACTED]');
  return {
    calls,
    async complete({ phase, system, content, contract, validate }) {
      let validationError;
      for (let formatAttempt = 0; formatAttempt < 2; formatAttempt++) {
        const messages = [
          { role: 'system', content: system + '\nReturn one JSON object matching this shape, with no extra fields. Use empty arrays when appropriate. No Markdown fences.\n' + JSON.stringify(contract) +
            (validationError ? '\nYour previous response failed validation: ' + validationError + '. Produce a corrected response from the evidence.' : '') },
          { role: 'user', content }
        ];
        let response;
        for (let networkAttempt = 0; networkAttempt < 3; networkAttempt++) {
          try {
            response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
              method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeout),
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
              body: JSON.stringify({ model: config.model, response_format: { type: 'json_object' }, messages })
            });
          } catch {
            throw new Error(`Model request failed during ${phase} (network, timeout, or redirect). Check endpoint and connectivity.`);
          }
          if ((response.status === 429 || response.status >= 500) && networkAttempt < 2) {
            await response.body?.cancel();
            await sleep(500 * (networkAttempt + 1));
            continue;
          }
          break;
        }
        if (!response.ok) {
          // Never echo provider error bodies: they can contain keys or input content.
          throw new Error(`Model API returned HTTP ${response.status} during ${phase}. Check key, model, endpoint, and quota.`);
        }
        let payload;
        try { payload = await response.json(); } catch { throw new Error(`Model API returned a non-JSON response during ${phase}.`); }
        const usage = payload.usage ? Object.fromEntries(['prompt_tokens', 'completion_tokens', 'total_tokens']
          .filter(key => Number.isSafeInteger(payload.usage[key]) && payload.usage[key] >= 0)
          .map(key => [key, payload.usage[key]])) : null;
        calls.push({ phase, model: typeof payload.model === 'string' ? payload.model.slice(0, 200) : config.model, usage });
        try {
          const choice = payload.choices?.[0];
          if (choice?.finish_reason === 'length') throw new Error('response was truncated');
          if (choice?.message?.refusal) throw new Error('model refused the request');
          const raw = choice?.message?.content;
          if (typeof raw !== 'string') throw new Error('missing JSON response content');
          return validate(JSON.parse(raw));
        } catch (error) {
          validationError = redact(error.message).slice(0, 500);
        }
      }
      throw new Error(`Model returned invalid output during ${phase}: ${validationError}`);
    }
  };
}
