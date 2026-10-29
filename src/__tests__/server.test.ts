import { describe, it, expect, afterEach, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../server.js';
import { clearEnv, mockFetch, setEnvCreds } from './helpers.js';

async function connectedClient(): Promise<Client> {
  const server = createServer();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

type Content = Array<{ type: string; text: string }>;

afterEach(() => { clearEnv(); vi.unstubAllGlobals(); });

describe('MCP server', () => {
  it('lists every tool once, all prefixed datto_edr_ with object input schemas', async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    const names = tools.map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBe(36);
    for (const tool of tools) {
      expect(tool.name).toMatch(/^datto_edr_[a-z_]+$/);
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.description?.length).toBeGreaterThan(10);
    }
    expect(names).toEqual(expect.arrayContaining([
      'datto_edr_navigate', 'datto_edr_status', 'datto_edr_test_connection', 'datto_edr_raw_request',
      'datto_edr_agents_list', 'datto_edr_alerts_list', 'datto_edr_organizations_list', 'datto_edr_isolate_host',
    ]));
  });

  it('read-only mode drops the write tools from the list', async () => {
    process.env.DATTO_EDR_READ_ONLY = '1';
    const client = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.length).toBe(32);
    expect(tools.every(t => t.annotations?.destructiveHint !== true)).toBe(true);
  });

  it('navigate returns a domain tool list and rejects unknown domains', async () => {
    const client = await connectedClient();
    const ok = await client.callTool({ name: 'datto_edr_navigate', arguments: { domain: 'alerts' } });
    expect((ok.content as Content)[0].text).toContain('datto_edr_alerts_list');
    const bad = await client.callTool({ name: 'datto_edr_navigate', arguments: { domain: 'nope' } });
    expect(bad.isError).toBe(true);
  });

  it('status reports credentials without leaking the token', async () => {
    setEnvCreds('https://acme.infocyte.com', 'super-secret-token');
    const client = await connectedClient();
    const result = await client.callTool({ name: 'datto_edr_status', arguments: {} });
    const text = (result.content as Content)[0].text;
    expect(JSON.parse(text)).toMatchObject({ connected: true, instance: 'acme.infocyte.com' });
    expect(text).not.toContain('super-secret-token');
  });

  it('turns API failures into isError results', async () => {
    setEnvCreds();
    mockFetch([{ status: 401, body: { error: { message: 'Invalid Access Token' } } }]);
    const client = await connectedClient();
    const result = await client.callTool({ name: 'datto_edr_agents_list', arguments: {} });
    expect(result.isError).toBe(true);
    expect((result.content as Content)[0].text).toMatch(/^Error: Datto EDR rejected the API token \(401\)/);
  });

  it('reports missing credentials as a tool error', async () => {
    const client = await connectedClient();
    const result = await client.callTool({ name: 'datto_edr_agents_list', arguments: {} });
    expect(result.isError).toBe(true);
    expect((result.content as Content)[0].text).toMatch(/Set DATTO_EDR_URL and DATTO_EDR_API_TOKEN/);
  });

  it('rejects unknown tools', async () => {
    const client = await connectedClient();
    const result = await client.callTool({ name: 'datto_edr_nope', arguments: {} });
    expect(result.isError).toBe(true);
  });
});
