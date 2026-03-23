/**
 * Thin fetch wrappers for AI model calls.
 * Supports direct Anthropic API and proxy endpoints (e.g. Bedrock via learn-service).
 */

export const MODEL_LIGHT = 'claude-haiku-4-5-20251001';
export const MODEL_HEAVY = 'claude-sonnet-4-6';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const TIMEOUT_MS = 30000;
const PROXY_TIMEOUT_MS = 90000;

export class ApiError extends Error {
  constructor(type, message, status) {
    super(message);
    this.name = 'ApiError';
    this.type = type;   // 'invalid_key' | 'rate_limit' | 'network' | 'parse' | 'api'
    this.status = status;
  }
}

/**
 * Parse a Messages API response (shared by callClaude and callProxy).
 * Expects a fetch Response object. Returns { content, usage }.
 */
export async function parseResponse(resp) {
  if (!resp.ok) {
    const status = resp.status;
    let body;
    try { body = await resp.json(); } catch { body = {}; }
    const msg = body?.error?.message || body?.error || `API returned ${status}`;

    if (status === 401) throw new ApiError('invalid_key', 'Invalid API key. Check your key in Settings.');
    if (status === 429) throw new ApiError('rate_limit', 'Rate limited. Try again in a moment.');
    throw new ApiError('api', msg, status);
  }

  let data;
  try {
    data = await resp.json();
  } catch {
    throw new ApiError('parse', 'Failed to parse API response.');
  }

  const textBlock = data.content?.find(b => b.type === 'text');
  if (!textBlock) throw new ApiError('parse', 'No text content in API response.');

  return { content: textBlock.text, usage: data.usage };
}

/**
 * Call the Anthropic API directly (requires user's own API key).
 */
export async function callClaude({ apiKey, model, systemPrompt, messages, maxTokens = 1024 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let resp;
  try {
    resp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages
      }),
      signal: controller.signal
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
      throw new ApiError('network', 'Request timed out after 30 seconds.');
    }
    throw new ApiError('network', 'Network error. Check your connection.');
  }
  clearTimeout(timer);

  return parseResponse(resp);
}

/**
 * Call a proxy endpoint that forwards to Bedrock (or any Messages-API-compatible backend).
 * Used for learn-service proxy and custom proxy URLs.
 */
export async function callProxy({ url, headers = {}, model, systemPrompt, messages, maxTokens = 1024 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);

  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages
      }),
      signal: controller.signal
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
      throw new ApiError('network', 'Request timed out. The proxy may be slow or unreachable.');
    }
    throw new ApiError('network', 'Network error. Check your connection.');
  }
  clearTimeout(timer);

  return parseResponse(resp);
}
