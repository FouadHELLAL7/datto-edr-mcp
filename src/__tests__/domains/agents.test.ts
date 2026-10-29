import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { agentsHandler } from '../../domains/agents.js';
import { clearEnv, filterOf, jsonOf, mockFetch, setEnvCreds, textOf } from '../helpers.js';

beforeEach(() => setEnvCreds());
afterEach(() => { clearEnv(); vi.unstubAllGlobals(); });

describe('agents domain', () => {
  it('exposes list, get and count tools as read-only', () => {
    const tools = agentsHandler.getTools();
    expect(tools.map(t => t.name)).toEqual(['datto_edr_agents_list', 'datto_edr_agents_get', 'datto_edr_agents_count']);
    for (const tool of tools) expect(tool.annotations?.readOnlyHint).toBe(true);
  });

  it('list builds a LoopBack filter from search arguments and pages', async () => {
    const { calls } = mockFetch([{ body: [{ id: 'a1' }, { id: 'a2' }] }]);
    const result = await agentsHandler.handleCall('datto_edr_agents_list', {
      hostname_contains: 'sql',
      active: false,
      last_seen_before: '2026-10-01T00:00:00Z',
      where: { osVersion: { like: '%Server%' } },
      limit: 2,
      skip: 4,
    });
    expect(calls[0].url.pathname).toBe('/api/Agents');
    expect(filterOf(calls[0])).toEqual({
      limit: 2,
      skip: 4,
      where: {
        and: [
          { hostname: { ilike: '%sql%' } },
          { active: false },
          { heartbeat: { lte: '2026-10-01T00:00:00.000Z' } },
          { osVersion: { like: '%Server%' } },
        ],
      },
    });
    const page = jsonOf(result);
    expect(page).toMatchObject({ model: 'Agents', count: 2, hasMore: true, nextSkip: 6 });
  });

  it('get calls Agents/{id}', async () => {
    const { calls } = mockFetch([{ body: { id: 'abc', hostname: 'pc1' } }]);
    const result = await agentsHandler.handleCall('datto_edr_agents_get', { id: 'abc' });
    expect(calls[0].url.pathname).toBe('/api/Agents/abc');
    expect(jsonOf(result)).toEqual({ id: 'abc', hostname: 'pc1' });
  });

  it('count calls Agents/count with a where parameter', async () => {
    const { calls } = mockFetch([{ body: { count: 7 } }]);
    const result = await agentsHandler.handleCall('datto_edr_agents_count', { active: true });
    expect(calls[0].url.pathname).toBe('/api/Agents/count');
    expect(JSON.parse(calls[0].url.searchParams.get('where') ?? '')).toEqual({ active: true });
    expect(jsonOf(result)).toEqual({ model: 'Agents', count: 7 });
  });

  it('rejects invalid arguments before calling the API', async () => {
    const { calls } = mockFetch([{ body: [] }]);
    const result = await agentsHandler.handleCall('datto_edr_agents_list', { limit: 5000 });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Invalid arguments: limit/);
    expect(calls).toHaveLength(0);
  });

  it('rejects ids that would change the path', async () => {
    mockFetch([{ body: {} }]);
    await expect(agentsHandler.handleCall('datto_edr_agents_get', { id: '../users' })).rejects.toThrow(/Invalid id/);
  });
});
