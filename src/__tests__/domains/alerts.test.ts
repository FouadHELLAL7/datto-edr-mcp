import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { alertsHandler } from '../../domains/alerts.js';
import { clearEnv, filterOf, jsonOf, mockFetch, setEnvCreds } from '../helpers.js';

beforeEach(() => setEnvCreds());
afterEach(() => { clearEnv(); vi.unstubAllGlobals(); });

describe('alerts domain', () => {
  it('list defaults to live, unarchived alerts newest first', async () => {
    const { calls } = mockFetch([{ body: [] }]);
    const result = await alertsHandler.handleCall('datto_edr_alerts_list', {});
    expect(calls[0].url.pathname).toBe('/api/Alerts');
    expect(filterOf(calls[0])).toEqual({ limit: 50, skip: 0, where: { archived: false }, order: 'createdOn DESC' });
    expect(jsonOf(result)).toMatchObject({ count: 0, hasMore: false });
  });

  it('list applies a date range and extra where (e.g. severity)', async () => {
    const { calls } = mockFetch([{ body: [] }]);
    await alertsHandler.handleCall('datto_edr_alerts_list', {
      start_time: '2026-10-01T00:00:00Z',
      end_time: '2026-10-02T00:00:00Z',
      include_archived: true,
      where: { severity: 'high' },
    });
    expect(filterOf(calls[0]).where).toEqual({
      and: [
        { createdOn: { between: ['2026-10-01T00:00:00.000Z', '2026-10-02T00:00:00.000Z'] } },
        { severity: 'high' },
      ],
    });
  });

  it('archive_table queries Alertsarchive without the archived clause', async () => {
    const { calls } = mockFetch([{ body: [] }]);
    await alertsHandler.handleCall('datto_edr_alerts_list', { archive_table: true });
    expect(calls[0].url.pathname).toBe('/api/Alertsarchive');
    expect(filterOf(calls[0]).where).toBeUndefined();
  });

  it('get, count and details hit their endpoints', async () => {
    const { calls } = mockFetch([{ body: { id: 'x' } }, { body: { count: 3 } }, { body: [] }]);
    await alertsHandler.handleCall('datto_edr_alerts_get', { id: 'x' });
    await alertsHandler.handleCall('datto_edr_alerts_count', {});
    await alertsHandler.handleCall('datto_edr_alert_details_list', { fields: ['hostname'] });
    expect(calls.map(c => c.url.pathname)).toEqual(['/api/Alerts/x', '/api/Alerts/count', '/api/AlertDetails']);
    expect(JSON.parse(calls[1].url.searchParams.get('where') ?? '')).toEqual({ archived: false });
    expect(filterOf(calls[2]).fields).toEqual(['hostname', 'id']);
  });
});
