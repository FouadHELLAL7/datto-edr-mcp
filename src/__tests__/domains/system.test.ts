import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { systemHandler } from '../../domains/system.js';
import { clearSwaggerCache } from '../../utils/swagger.js';
import { clearEnv, filterOf, jsonOf, mockFetch, setEnvCreds } from '../helpers.js';

beforeEach(() => { setEnvCreds(); clearSwaggerCache(); });
afterEach(() => { clearEnv(); vi.unstubAllGlobals(); });

const SWAGGER = {
  paths: {
    '/Agents': { get: {} },
    '/Agents/{id}': { get: {}, patch: {} },
    '/Alerts': { get: {} },
  },
  definitions: {
    Agent: { properties: { hostname: { type: 'string' }, heartbeat: { type: 'string', format: 'date-time' } } },
  },
};

describe('system domain', () => {
  it('test_connection calls Version and reports the host', async () => {
    const { calls } = mockFetch([{ body: { version: '5.0.0' } }]);
    const result = jsonOf(await systemHandler.handleCall('datto_edr_test_connection', {}));
    expect(calls[0].url.pathname).toBe('/api/Version');
    expect(result).toEqual({ connected: true, instance: 'acme.infocyte.com', version: { version: '5.0.0' } });
  });

  it('api_models lists models and describes one model', async () => {
    mockFetch([{ body: SWAGGER }]);
    const all = jsonOf(await systemHandler.handleCall('datto_edr_api_models', {}));
    expect(all).toMatchObject({ count: 2, models: ['Agents', 'Alerts'] });

    const agents = jsonOf(await systemHandler.handleCall('datto_edr_api_models', { model: 'agents' }));
    expect(agents).toMatchObject({
      definition: 'Agent',
      properties: { hostname: 'string', heartbeat: 'date-time' },
      paths: { '/Agents': ['GET'], '/Agents/{id}': ['GET', 'PATCH'] },
    });

    await expect(systemHandler.handleCall('datto_edr_api_models', { model: 'Nope' })).rejects.toThrow(/not found/);
  });

  it('raw_request is GET-only and JSON-encodes object query values', async () => {
    const { calls } = mockFetch([{ body: [] }]);
    await systemHandler.handleCall('datto_edr_raw_request', {
      path: '/api/AlertDetails',
      query: { filter: { where: { hostname: 'pc1' }, limit: 5 } },
    });
    expect(calls[0].method).toBe('GET');
    expect(calls[0].url.pathname).toBe('/api/AlertDetails');
    expect(filterOf(calls[0])).toEqual({ where: { hostname: 'pc1' }, limit: 5 });
  });

  it.each([
    ['../explorer', /Invalid path/],
    ['https://evil.example.com/x', /Invalid path/],
    ['Agents?access_token=x', /Invalid path/],
    ['credentials', /credential\/token/],
    ['AccessTokens', /credential\/token/],
  ])('raw_request refuses %s', async (path, pattern) => {
    const { calls } = mockFetch([{ body: [] }]);
    await expect(systemHandler.handleCall('datto_edr_raw_request', { path })).rejects.toThrow(pattern);
    expect(calls).toHaveLength(0);
  });

  it('raw_request refuses an access_token query parameter', async () => {
    mockFetch([{ body: [] }]);
    await expect(systemHandler.handleCall('datto_edr_raw_request', { path: 'Agents', query: { access_token: 'x' } }))
      .rejects.toThrow(/added automatically/);
  });

  it('audit log filters by user', async () => {
    const { calls } = mockFetch([{ body: [] }]);
    await systemHandler.handleCall('datto_edr_audit_log_list', { user_id: 'u1' });
    expect(calls[0].url.pathname).toBe('/api/useractivities');
    expect(filterOf(calls[0]).where).toEqual({ userId: 'u1' });
  });
});
