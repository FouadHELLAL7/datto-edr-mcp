import { AsyncLocalStorage } from 'node:async_hooks';
import { logger } from './logger.js';

export interface Credentials {
  /** Instance base URL, e.g. https://acme.infocyte.com */
  url: string;
  apiToken: string;
}

// Request-scoped credential store. In gateway mode the HTTP layer runs each
// request inside runWithCredentials({url, apiToken}); getCredentials() reads
// from it. Falls back to process.env for stdio/single-tenant mode.
const credStore = new AsyncLocalStorage<Credentials>();

export function runWithCredentials<T>(creds: Credentials, fn: () => T): T {
  return credStore.run(creds, fn);
}

export function getCredentials(): Credentials | null {
  const scoped = credStore.getStore();
  if (scoped?.url && scoped?.apiToken) return scoped;
  const url = process.env.DATTO_EDR_URL?.trim();
  const apiToken = process.env.DATTO_EDR_API_TOKEN?.trim();
  if (!url || !apiToken) {
    logger.warn('Missing credentials', { hasUrl: !!url, hasApiToken: !!apiToken });
    return null;
  }
  return { url, apiToken };
}

/** LoopBack rejects page sizes above this ("1000 is max supported by Infocyte API"). */
export const MAX_LIMIT = 1000;

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const MAX_RETRIES = 3;
const MAX_RETRY_DELAY_MS = 30_000;
const MAX_ERROR_DETAIL = 500;

export class DattoEdrApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'DattoEdrApiError';
  }
}

export interface ClientOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

type QueryValue = string | number | boolean | object | undefined | null;

function parseAllowedHosts(): string[] {
  return (process.env.DATTO_EDR_ALLOWED_HOSTS ?? '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Normalizes and validates the instance URL. In gateway mode it comes from a
 * request header, so it is treated as untrusted: https only (http needs
 * DATTO_EDR_ALLOW_HTTP=1 for local mocks), no embedded credentials, and an
 * optional host-suffix allowlist (DATTO_EDR_ALLOWED_HOSTS).
 */
export function normalizeBaseUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new DattoEdrApiError('Invalid Datto EDR URL. Expected something like https://yourcompany.infocyte.com');
  }
  const allowHttp = process.env.DATTO_EDR_ALLOW_HTTP === '1';
  if (parsed.protocol !== 'https:' && !(allowHttp && parsed.protocol === 'http:')) {
    throw new DattoEdrApiError('Invalid Datto EDR URL: only https:// instance URLs are allowed.');
  }
  if (parsed.username || parsed.password) {
    throw new DattoEdrApiError('Invalid Datto EDR URL: credentials must not be embedded in the URL.');
  }
  const host = parsed.hostname.toLowerCase();
  const allowed = parseAllowedHosts();
  if (allowed.length > 0 && !allowed.some(s => host === s.replace(/^\./, '') || host.endsWith(s.startsWith('.') ? s : `.${s}`))) {
    throw new DattoEdrApiError(`Datto EDR host ${host} is not in DATTO_EDR_ALLOWED_HOSTS.`);
  }
  // Accept the instance root, /api, or /explorer and reduce all of them to the root.
  const path = parsed.pathname.replace(/\/+$/, '').replace(/\/(api|explorer)$/i, '');
  return `${parsed.protocol}//${parsed.host}${path}`;
}

function encodeQuery(query: Record<string, QueryValue> | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    params.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }
  const str = params.toString();
  return str ? `?${str}` : '';
}

/**
 * Thin client for the Datto EDR LoopBack API (https://<instance>/api/<Model>).
 * The token always travels in the Authorization header, never in the URL, so
 * it cannot end up in logs or error messages.
 */
export class DattoEdrClient {
  readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(creds: Credentials, options: ClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(creds.url);
    this.token = creds.apiToken;
    this.timeoutMs = options.timeoutMs ?? (parseInt(process.env.DATTO_EDR_TIMEOUT_MS || '', 10) || 30_000);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise(resolve => setTimeout(resolve, ms)));
  }

  get host(): string {
    return new URL(this.baseUrl).host;
  }

  /** GET /api/<path> */
  async get<T = unknown>(path: string, query?: Record<string, QueryValue>): Promise<T> {
    return this.request<T>('GET', `/api/${path.replace(/^\/+/, '')}`, query);
  }

  /** POST /api/<path> with a JSON body */
  async post<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', `/api/${path.replace(/^\/+/, '')}`, undefined, body);
  }

  /** GET /explorer/swagger.json (the instance's own API description). */
  async swagger<T = unknown>(): Promise<T> {
    return this.request<T>('GET', '/explorer/swagger.json');
  }

  private redact(text: string): string {
    return this.token ? text.split(this.token).join('[REDACTED]') : text;
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    query?: Record<string, QueryValue>,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}${encodeQuery(query)}`;
    // Writes are not idempotent (a retried POST targets/scan starts a second
    // scan), so only 429 — which means the request was not processed — is
    // retried for POST.
    const canRetry = (status: number) => status === 429 || (method === 'GET' && RETRYABLE_STATUS.has(status));

    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let res: Response;
      try {
        logger.debug('Datto EDR request', { method, path, attempt });
        res = await this.fetchImpl(url, {
          method,
          headers: {
            Authorization: this.token,
            Accept: 'application/json',
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
      } catch (error) {
        clearTimeout(timer);
        const aborted = (error as Error).name === 'AbortError';
        if (method === 'GET' && attempt < MAX_RETRIES && !aborted) {
          await this.sleep(this.backoff(attempt));
          continue;
        }
        if (aborted) {
          throw new DattoEdrApiError(`Request to Datto EDR (${this.host}) timed out after ${this.timeoutMs} ms.`);
        }
        throw new DattoEdrApiError(`Could not reach Datto EDR at ${this.host}: ${this.redact((error as Error).message)}`);
      }
      clearTimeout(timer);

      if (res.ok) {
        const text = await res.text();
        if (!text) return null as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new DattoEdrApiError(`Datto EDR returned a non-JSON response for ${method} ${path}. Check that DATTO_EDR_URL points at the instance root.`, res.status);
        }
      }

      if (canRetry(res.status) && attempt < MAX_RETRIES) {
        const delay = this.retryAfter(res.headers.get('retry-after')) ?? this.backoff(attempt);
        logger.warn('Datto EDR request retrying', { method, path, status: res.status, delayMs: delay });
        await this.sleep(delay);
        continue;
      }

      throw await this.toError(res, method, path);
    }
  }

  private backoff(attempt: number): number {
    return Math.min(500 * 2 ** attempt + Math.floor(Math.random() * 250), MAX_RETRY_DELAY_MS);
  }

  private retryAfter(header: string | null): number | undefined {
    if (!header) return undefined;
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.min(Math.max(seconds, 0) * 1000, MAX_RETRY_DELAY_MS);
    const date = Date.parse(header);
    if (!Number.isNaN(date)) return Math.min(Math.max(date - Date.now(), 0), MAX_RETRY_DELAY_MS);
    return undefined;
  }

  private async toError(res: Response, method: string, path: string): Promise<DattoEdrApiError> {
    let detail = '';
    try {
      const text = await res.text();
      try {
        const parsed = JSON.parse(text) as { error?: { message?: string } };
        detail = parsed?.error?.message ?? text;
      } catch {
        detail = text;
      }
    } catch {
      // body unavailable
    }
    detail = this.redact(detail).slice(0, MAX_ERROR_DETAIL).trim();
    const suffix = detail ? ` API said: ${detail}` : '';
    const where = `${method} ${path}`;

    switch (res.status) {
      case 401:
        return new DattoEdrApiError(
          `Datto EDR rejected the API token (401) for ${where}. Check that the token is correct, belongs to ${this.host}, and has not expired (tokens last one year).${suffix}`,
          401,
        );
      case 403:
        return new DattoEdrApiError(
          `Permission denied (403) for ${where}. The token's user needs administrator, analyst or external analyst access to this data.${suffix}`,
          403,
        );
      case 404:
        return new DattoEdrApiError(
          `Not found (404): ${where}. The id may be wrong, or this instance does not expose that endpoint (see datto_edr_api_models).${suffix}`,
          404,
        );
      case 429:
        return new DattoEdrApiError(`Datto EDR rate limit hit (429) for ${where}; retries exhausted. Try again shortly or request less data.${suffix}`, 429);
      default:
        return new DattoEdrApiError(`Datto EDR API error ${res.status} for ${where}.${suffix}`, res.status);
    }
  }
}

// Constructs a client from the request-scoped (or env) credentials. The client
// is cheap and holds no shared mutable state, so we build one per call — never
// a process-global singleton.
export async function getClient(): Promise<DattoEdrClient> {
  const creds = getCredentials();
  if (!creds) {
    throw new Error('No Datto EDR credentials configured. Set DATTO_EDR_URL and DATTO_EDR_API_TOKEN.');
  }
  return new DattoEdrClient(creds);
}
