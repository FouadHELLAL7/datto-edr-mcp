import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  DattoEdrClient,
  DattoEdrApiError,
  getCredentials,
  normalizeBaseUrl,
  runWithCredentials,
} from '../utils/client.js';
import { clearEnv, filterOf, mockFetch } from './helpers.js';

const TOKEN = 'secret-token-abc';
const noSleep = () => Promise.resolve();

function client(fetchImpl?: typeof fetch, extra: Partial<{ timeoutMs: number }> = {}) {
  return new DattoEdrClient({ url: 'https://acme.infocyte.com', apiToken: TOKEN }, { sleep: noSleep, fetchImpl, ...extra });
}

afterEach(() => {
  clearEnv();
  vi.unstubAllGlobals();
});

describe('request-scoped credentials', () => {
  it('prefers ALS-scoped creds over process.env', () => {
    process.env.DATTO_EDR_URL = 'https://env.infocyte.com';
    process.env.DATTO_EDR_API_TOKEN = 'env-token';
    expect(getCredentials()).toEqual({ url: 'https://env.infocyte.com', apiToken: 'env-token' });

    runWithCredentials({ url: 'https://scoped.infocyte.com', apiToken: 'scoped-token' }, () => {
      expect(getCredentials()).toEqual({ url: 'https://scoped.infocyte.com', apiToken: 'scoped-token' });
    });

    // Scoped creds must not leak outside runWithCredentials
    expect(getCredentials()).toEqual({ url: 'https://env.infocyte.com', apiToken: 'env-token' });
  });

  it('returns null when neither scope nor env set', () => {
    expect(getCredentials()).toBeNull();
  });

  it('returns null when only the URL is set', () => {
    process.env.DATTO_EDR_URL = 'https://env.infocyte.com';
    expect(getCredentials()).toBeNull();
  });

  it('returns null when only the token is set', () => {
    process.env.DATTO_EDR_API_TOKEN = 'token-only';
    expect(getCredentials()).toBeNull();
  });

  it('ALS scope does not leak into sibling async paths', async () => {
    const results: Array<ReturnType<typeof getCredentials>> = [];
    const run = (url: string, apiToken: string) =>
      runWithCredentials({ url, apiToken }, async () => {
        await Promise.resolve();
        results.push(getCredentials());
      });
    await Promise.all([run('https://a.infocyte.com', 'ta'), run('https://b.infocyte.com', 'tb')]);
    expect(results).toContainEqual({ url: 'https://a.infocyte.com', apiToken: 'ta' });
    expect(results).toContainEqual({ url: 'https://b.infocyte.com', apiToken: 'tb' });
  });
});

describe('normalizeBaseUrl', () => {
  it('strips trailing slash, /api and /explorer', () => {
    expect(normalizeBaseUrl('https://acme.infocyte.com/')).toBe('https://acme.infocyte.com');
    expect(normalizeBaseUrl('https://acme.infocyte.com/api')).toBe('https://acme.infocyte.com');
    expect(normalizeBaseUrl('https://acme.infocyte.com/explorer/')).toBe('https://acme.infocyte.com');
  });

  it('rejects http unless DATTO_EDR_ALLOW_HTTP=1', () => {
    expect(() => normalizeBaseUrl('http://acme.infocyte.com')).toThrow(/https/);
    process.env.DATTO_EDR_ALLOW_HTTP = '1';
    expect(normalizeBaseUrl('http://127.0.0.1:9999')).toBe('http://127.0.0.1:9999');
  });

  it('rejects garbage and embedded credentials', () => {
    expect(() => normalizeBaseUrl('not a url')).toThrow(/Invalid Datto EDR URL/);
    expect(() => normalizeBaseUrl('https://user:pw@acme.infocyte.com')).toThrow(/credentials/);
  });

  it('enforces DATTO_EDR_ALLOWED_HOSTS suffixes', () => {
    process.env.DATTO_EDR_ALLOWED_HOSTS = '.infocyte.com';
    expect(normalizeBaseUrl('https://acme.infocyte.com')).toBe('https://acme.infocyte.com');
    expect(() => normalizeBaseUrl('https://evil.example.com')).toThrow(/not in DATTO_EDR_ALLOWED_HOSTS/);
    expect(() => normalizeBaseUrl('https://acme.infocyte.com.evil.com')).toThrow(/not in DATTO_EDR_ALLOWED_HOSTS/);
  });
});

describe('DattoEdrClient', () => {
  it('sends the token in the Authorization header, never in the URL', async () => {
    const { calls } = mockFetch([{ body: [{ id: '1' }] }]);
    await client().get('Agents', { filter: { where: { active: true }, limit: 5 } });
    expect(calls).toHaveLength(1);
    expect(calls[0].url.pathname).toBe('/api/Agents');
    expect(calls[0].headers.authorization).toBe(TOKEN);
    expect(calls[0].url.toString()).not.toContain(TOKEN);
    expect(calls[0].url.searchParams.has('access_token')).toBe(false);
    expect(filterOf(calls[0])).toEqual({ where: { active: true }, limit: 5 });
  });

  it('posts JSON bodies', async () => {
    const { calls } = mockFetch([{ body: { scanTaskId: 't1' } }]);
    const result = await client().post('targets/scan', { target: 'host1' });
    expect(result).toEqual({ scanTaskId: 't1' });
    expect(calls[0].method).toBe('POST');
    expect(calls[0].headers['content-type']).toBe('application/json');
    expect(calls[0].body).toEqual({ target: 'host1' });
  });

  it('reads the swagger document from /explorer/swagger.json', async () => {
    const { calls } = mockFetch([{ body: { paths: {} } }]);
    await client().swagger();
    expect(calls[0].url.pathname).toBe('/explorer/swagger.json');
  });

  it.each([
    [401, /rejected the API token/],
    [403, /Permission denied/],
    [404, /Not found/],
    [500, /API error 500/],
  ])('maps HTTP %i to a clear error', async (status, pattern) => {
    mockFetch([{ status, body: { error: { message: 'boom' } } }]);
    const err = (await client().get('Agents').catch(e => e)) as DattoEdrApiError;
    expect(err).toBeInstanceOf(DattoEdrApiError);
    expect(err.status).toBe(status);
    expect(err.message).toMatch(pattern);
    expect(err.message).toContain('boom');
  });

  it('redacts the token if the API echoes it back', async () => {
    mockFetch([{ status: 400, body: { error: { message: `bad token ${TOKEN}` } } }]);
    const err = (await client().get('Agents').catch(e => e)) as DattoEdrApiError;
    expect(err.message).not.toContain(TOKEN);
    expect(err.message).toContain('[REDACTED]');
  });

  it('retries 429 honoring Retry-After, then succeeds', async () => {
    const sleeps: number[] = [];
    const { calls } = mockFetch([
      { status: 429, headers: { 'retry-after': '2' } },
      { body: [{ id: 'ok' }] },
    ]);
    const c = new DattoEdrClient({ url: 'https://acme.infocyte.com', apiToken: TOKEN }, {
      sleep: async (ms) => { sleeps.push(ms); },
    });
    await expect(c.get('Agents')).resolves.toEqual([{ id: 'ok' }]);
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([2000]);
  });

  it('gives up on 429 after retries', async () => {
    const { calls } = mockFetch([{ status: 429 }]);
    await expect(client().get('Agents')).rejects.toThrow(/rate limit/);
    expect(calls).toHaveLength(4);
  });

  it('retries GET on 503 but never retries POST on 503', async () => {
    const get = mockFetch([{ status: 503 }, { body: [] }]);
    await expect(client().get('Agents')).resolves.toEqual([]);
    expect(get.calls).toHaveLength(2);

    const post = mockFetch([{ status: 503 }, { body: {} }]);
    await expect(client().post('targets/scan', {})).rejects.toThrow(/503/);
    expect(post.calls).toHaveLength(1);
  });

  it('reports timeouts', async () => {
    const hang: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    await expect(client(hang, { timeoutMs: 10 }).get('Agents')).rejects.toThrow(/timed out after 10 ms/);
  });

  it('reports network failures after retrying GETs', async () => {
    const { calls } = mockFetch([new TypeError('getaddrinfo ENOTFOUND')]);
    await expect(client().get('Agents')).rejects.toThrow(/Could not reach Datto EDR at acme.infocyte.com/);
    expect(calls).toHaveLength(4);
  });

  it('explains non-JSON responses', async () => {
    mockFetch([{ body: '<html>login</html>' }]);
    await expect(client().get('Agents')).rejects.toThrow(/non-JSON/);
  });
});
