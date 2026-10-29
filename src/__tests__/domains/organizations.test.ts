import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { organizationsHandler } from '../../domains/organizations.js';
import { clearSwaggerCache } from '../../utils/swagger.js';
import { clearEnv, filterOf, jsonOf, mockFetch, setEnvCreds, type RecordedCall } from '../helpers.js';

function swaggerWith(...roots: string[]) {
  return { paths: Object.fromEntries(roots.map(r => [`/${r}`, { get: {} }])) };
}

beforeEach(() => { setEnvCreds(); clearSwaggerCache(); });
afterEach(() => { clearEnv(); vi.unstubAllGlobals(); });

describe('organizations domain (swagger-resolved)', () => {
  it('resolves the organizations model from swagger and caches the lookup', async () => {
    const { calls } = mockFetch((call: RecordedCall) =>
      call.url.pathname === '/explorer/swagger.json'
        ? { body: swaggerWith('Agents', 'organizations') }
        : { body: [{ id: 'o1', name: 'Acme' }] });

    const first = await organizationsHandler.handleCall('datto_edr_organizations_list', { limit: 10 });
    await organizationsHandler.handleCall('datto_edr_organizations_get', { id: 'o1' });

    expect(calls.map(c => c.url.pathname)).toEqual([
      '/explorer/swagger.json', '/api/organizations', '/api/organizations/o1',
    ]);
    expect(filterOf(calls[1])).toEqual({ limit: 10, skip: 0 });
    expect(jsonOf(first)).toMatchObject({ model: 'organizations', count: 1 });
  });

  it('resolves locations and integrations', async () => {
    const { calls } = mockFetch((call: RecordedCall) =>
      call.url.pathname === '/explorer/swagger.json'
        ? { body: swaggerWith('Locations', 'Integrations') }
        : { body: [] });
    await organizationsHandler.handleCall('datto_edr_locations_list', {});
    await organizationsHandler.handleCall('datto_edr_locations_get', { id: 'l1' });
    await organizationsHandler.handleCall('datto_edr_integrations_list', {});
    expect(calls.filter(c => c.url.pathname.startsWith('/api')).map(c => c.url.pathname)).toEqual([
      '/api/Locations', '/api/Locations/l1', '/api/Integrations',
    ]);
  });

  it('explains which related models exist when the expected one is missing', async () => {
    mockFetch([{ body: swaggerWith('Agents', 'OrgSettings', 'organizationUsers') }]);
    await expect(organizationsHandler.handleCall('datto_edr_organizations_list', {}))
      .rejects.toThrow(/does not expose a Organizations\/Organization endpoint. Related models: organizationUsers/);
  });

  it('reports when swagger cannot be read', async () => {
    mockFetch([{ status: 404 }]);
    await expect(organizationsHandler.handleCall('datto_edr_locations_list', {}))
      .rejects.toThrow(/Could not read acme.infocyte.com\/explorer\/swagger.json/);
  });
});
