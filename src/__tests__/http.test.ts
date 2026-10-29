import { describe, it, expect, afterEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { startHttpServer } from '../http.js';
import { clearEnv, type RecordedCall } from './helpers.js';

const SECRET = 'a3f9c2d1e8b7a6f5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1';

function s2sHeader(secret = SECRET): string {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${createHmac('sha256', secret).update(`t=${t}`).digest('hex')}`;
}

let server: HttpServer | undefined;

async function start(env: Record<string, string>): Promise<string> {
  Object.assign(process.env, { MCP_HTTP_PORT: '0', ...env });
  server = await startHttpServer();
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const realFetch = globalThis.fetch;

function rpc(base: string, body: unknown, headers: Record<string, string> = {}) {
  return realFetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
}

const LIST_TOOLS = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };

afterEach(async () => {
  await new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
  clearEnv();
  vi.unstubAllGlobals();
});

describe('HTTP transport', () => {
  it('serves /health without credentials and 404s unknown paths', async () => {
    const base = await start({ CONDUIT_S2S_SECRET: SECRET, AUTH_MODE: 'gateway' });
    const health = await realFetch(`${base}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'ok', transport: 'http', mode: 'gateway' });
    expect((await realFetch(`${base}/healthz`)).status).toBe(200);
    expect((await realFetch(`${base}/other`)).status).toBe(404);
  });

  it('requires a valid X-Gateway-S2S header on /mcp', async () => {
    const base = await start({ CONDUIT_S2S_SECRET: SECRET });
    expect((await rpc(base, LIST_TOOLS)).status).toBe(401);
    expect((await rpc(base, LIST_TOOLS, { 'X-Gateway-S2S': s2sHeader('wrong-secret') })).status).toBe(401);
    const ok = await rpc(base, LIST_TOOLS, { 'X-Gateway-S2S': s2sHeader() });
    expect(ok.status).toBe(200);
    const body = await ok.json() as { result: { tools: unknown[] } };
    expect(body.result.tools.length).toBe(36);
  });

  it('gateway mode rejects requests without the X-Datto-EDR-* headers', async () => {
    const base = await start({ CONDUIT_S2S_SECRET: SECRET, AUTH_MODE: 'gateway' });
    const res = await rpc(base, LIST_TOOLS, { 'X-Gateway-S2S': s2sHeader(), 'X-Datto-EDR-URL': 'https://a.infocyte.com' });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('X-Datto-EDR-API-Token') });
  });

  it('gateway mode uses the per-request URL and token, never the env ones', async () => {
    process.env.DATTO_EDR_URL = 'https://env.infocyte.com';
    process.env.DATTO_EDR_API_TOKEN = 'env-token';
    const base = await start({ CONDUIT_S2S_SECRET: SECRET, AUTH_MODE: 'gateway' });

    const calls: RecordedCall[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.hostname === '127.0.0.1') return realFetch(input, init);
      calls.push({ url, method: init?.method ?? 'GET', headers: init?.headers as Record<string, string> });
      return new Response(JSON.stringify({ version: '5.0.0' }), { status: 200 });
    }));

    const res = await rpc(base, {
      jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'datto_edr_test_connection', arguments: {} },
    }, {
      'X-Gateway-S2S': s2sHeader(),
      'X-Datto-EDR-URL': 'https://tenant-a.infocyte.com',
      'X-Datto-EDR-API-Token': 'tenant-a-token',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { result: { content: Array<{ text: string }> } };
    expect(JSON.parse(body.result.content[0].text)).toMatchObject({ connected: true, instance: 'tenant-a.infocyte.com' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url.host).toBe('tenant-a.infocyte.com');
    expect(calls[0].headers.Authorization).toBe('tenant-a-token');
  });

  it('insecure dev mode starts without a secret and skips the S2S check', async () => {
    const base = await start({ MCP_ALLOW_INSECURE_DEV: '1', MCP_HTTP_HOST: '0.0.0.0' });
    expect((server!.address() as AddressInfo).address).toBe('127.0.0.1');
    expect((await rpc(base, LIST_TOOLS)).status).toBe(200);
  });
});
