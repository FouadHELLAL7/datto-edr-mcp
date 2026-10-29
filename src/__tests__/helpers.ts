import { vi } from 'vitest';

export interface RecordedCall {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

export type MockResponse = { status?: number; body?: unknown; headers?: Record<string, string> } | Error;

/**
 * Installs a fetch mock that answers from a queue (the last entry repeats)
 * and records every request.
 */
export function mockFetch(responses: MockResponse[] | ((call: RecordedCall) => MockResponse)) {
  const calls: RecordedCall[] = [];
  let index = 0;
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]),
    );
    const call: RecordedCall = {
      url: new URL(String(input)),
      method: init?.method ?? 'GET',
      headers,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const next = typeof responses === 'function'
      ? responses(call)
      : responses[Math.min(index++, responses.length - 1)];
    if (next instanceof Error) throw next;
    const body = next.body === undefined ? '' : typeof next.body === 'string' ? next.body : JSON.stringify(next.body);
    return new Response(body, { status: next.status ?? 200, headers: next.headers });
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}

/** Parses the JSON-encoded LoopBack filter of a recorded GET. */
export function filterOf(call: RecordedCall): Record<string, unknown> {
  return JSON.parse(call.url.searchParams.get('filter') ?? '{}');
}

export function setEnvCreds(url = 'https://acme.infocyte.com', token = 'test-token-123') {
  process.env.DATTO_EDR_URL = url;
  process.env.DATTO_EDR_API_TOKEN = token;
}

export function clearEnv() {
  for (const key of [
    'DATTO_EDR_URL', 'DATTO_EDR_API_TOKEN', 'DATTO_EDR_READ_ONLY', 'DATTO_EDR_ALLOWED_HOSTS',
    'DATTO_EDR_ALLOW_HTTP', 'DATTO_EDR_TIMEOUT_MS', 'AUTH_MODE', 'CONDUIT_S2S_SECRET',
    'MCP_ALLOW_INSECURE_DEV', 'MCP_HTTP_PORT', 'MCP_HTTP_HOST',
  ]) {
    delete process.env[key];
  }
}

export function textOf(result: { content: Array<{ text: string }> }): string {
  return result.content[0].text;
}

export function jsonOf<T = Record<string, unknown>>(result: { content: Array<{ text: string }> }): T {
  return JSON.parse(textOf(result)) as T;
}
