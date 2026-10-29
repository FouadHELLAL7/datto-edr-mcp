import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { targetsHandler } from '../../domains/targets.js';
import { rulesHandler } from '../../domains/rules.js';
import { clearEnv, filterOf, mockFetch, setEnvCreds } from '../helpers.js';

beforeEach(() => setEnvCreds());
afterEach(() => { clearEnv(); vi.unstubAllGlobals(); });

describe('targets domain', () => {
  it('target group list/get', async () => {
    const { calls } = mockFetch([{ body: [] }, { body: { id: 'tg1' } }]);
    await targetsHandler.handleCall('datto_edr_target_groups_list', { name: 'Servers' });
    await targetsHandler.handleCall('datto_edr_target_groups_get', { id: 'tg1' });
    expect(calls[0].url.pathname).toBe('/api/targets');
    expect(filterOf(calls[0]).where).toEqual({ name: 'Servers' });
    expect(calls[1].url.pathname).toBe('/api/targets/tg1');
  });

  it('addresses list filters by target group, host and accessibility', async () => {
    const { calls } = mockFetch([{ body: [] }]);
    await targetsHandler.handleCall('datto_edr_addresses_list', {
      target_group_id: 'tg1', ip: '10.0.0.5', accessible: true,
    });
    expect(calls[0].url.pathname).toBe('/api/Addresses');
    expect(filterOf(calls[0]).where).toEqual({ and: [{ targetId: 'tg1' }, { ipstring: '10.0.0.5' }, { accessible: true }] });
  });
});

describe('rules domain', () => {
  it('rules, extensions and action types hit their endpoints', async () => {
    const { calls } = mockFetch([{ body: [] }]);
    await rulesHandler.handleCall('datto_edr_rules_list', {});
    await rulesHandler.handleCall('datto_edr_rules_get', { id: 'r1' });
    await rulesHandler.handleCall('datto_edr_extensions_list', { name: 'Host Isolation' });
    await rulesHandler.handleCall('datto_edr_extensions_get', { id: 'e1' });
    await rulesHandler.handleCall('datto_edr_action_types_list', {});
    expect(calls.map(c => c.url.pathname)).toEqual([
      '/api/rules', '/api/rules/r1', '/api/extensions', '/api/extensions/e1', '/api/ActionTypes',
    ]);
    expect(filterOf(calls[2]).where).toEqual({ name: 'Host Isolation' });
  });
});
