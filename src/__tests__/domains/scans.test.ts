import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { scansHandler } from '../../domains/scans.js';
import { clearEnv, filterOf, jsonOf, mockFetch, setEnvCreds, textOf, type RecordedCall } from '../helpers.js';

beforeEach(() => setEnvCreds());
afterEach(() => { clearEnv(); vi.unstubAllGlobals(); });

const WRITE_TOOLS = ['datto_edr_scan_host', 'datto_edr_run_response', 'datto_edr_isolate_host', 'datto_edr_restore_host'];

describe('scans domain: reads', () => {
  it('scans, tasks, task items and jobs hit their endpoints', async () => {
    const { calls } = mockFetch([{ body: [] }]);
    await scansHandler.handleCall('datto_edr_scans_list', { target_group_id: 'tg1' });
    await scansHandler.handleCall('datto_edr_scans_get', { id: 's1' });
    await scansHandler.handleCall('datto_edr_tasks_list', { status: 'Active' });
    await scansHandler.handleCall('datto_edr_tasks_get', { id: 't1' });
    await scansHandler.handleCall('datto_edr_task_items_list', { task_id: 't1' });
    await scansHandler.handleCall('datto_edr_jobs_list', { state: 'active' });
    expect(calls.map(c => c.url.pathname)).toEqual([
      '/api/scans', '/api/scans/s1', '/api/usertasks', '/api/usertasks/t1', '/api/userTaskItems', '/api/jobs',
    ]);
    expect(filterOf(calls[0]).where).toEqual({ targetId: 'tg1' });
    expect(filterOf(calls[2])).toMatchObject({ where: { and: [{ status: 'Active' }, { archived: false }] }, order: 'createdOn DESC' });
    expect(filterOf(calls[4]).where).toEqual({ userTaskId: 't1' });
    expect(filterOf(calls[5]).where).toEqual({ state: 'active' });
  });
});

describe('scans domain: write actions', () => {
  it('marks every write tool as destructive with a HIGH-IMPACT prefix', () => {
    const tools = scansHandler.getTools().filter(t => WRITE_TOOLS.includes(t.name));
    expect(tools).toHaveLength(4);
    for (const tool of tools) {
      expect(tool.description).toMatch(/^⚠ HIGH-IMPACT/);
      expect(tool.annotations?.destructiveHint).toBe(true);
      expect(tool.annotations?.readOnlyHint).toBe(false);
    }
  });

  it('scan_host without confirm only previews the request', async () => {
    const { calls } = mockFetch([{ body: {} }]);
    const result = jsonOf(await scansHandler.handleCall('datto_edr_scan_host', { target: 'pc1', target_group_id: 'tg1' }));
    expect(calls).toHaveLength(0);
    expect(result).toMatchObject({ executed: false, request: { method: 'POST', path: '/api/targets/scan' } });
  });

  it('scan_host with confirm posts targets/scan with default options', async () => {
    const { calls } = mockFetch([{ body: { scanTaskId: 'task-9' } }]);
    const result = jsonOf(await scansHandler.handleCall('datto_edr_scan_host', {
      target: 'pc1', target_group_id: 'tg1', options: { memory: false }, confirm: true,
    }));
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url.pathname).toBe('/api/targets/scan');
    expect(calls[0].body).toMatchObject({
      target: 'pc1',
      targetGroup: { id: 'tg1' },
      options: { process: true, memory: false, installed: false, hook: false, extensions: [] },
    });
    expect(result).toMatchObject({ executed: true, taskId: 'task-9' });
  });

  it('isolate_host resolves the Host Isolation extension and runs only it', async () => {
    const { calls } = mockFetch((call: RecordedCall) =>
      call.method === 'GET'
        ? { body: [{ id: 'ext-old', name: 'Host Isolation' }, { id: 'ext-iso', name: 'Host Isolation' }] }
        : { body: { scanTaskId: 'task-1' } });
    const result = jsonOf(await scansHandler.handleCall('datto_edr_isolate_host', {
      target: 'pc1', target_group_id: 'tg1', confirm: true,
    }));
    expect(calls[0].url.pathname).toBe('/api/extensions');
    expect(filterOf(calls[0]).where).toEqual({ name: 'Host Isolation' });
    const body = calls[1].body as { options: Record<string, unknown> };
    expect(body.options).toMatchObject({ process: false, network: false, extensions: [{ id: 'ext-iso', args: {}, order: 0 }] });
    expect(result).toMatchObject({ executed: true, taskId: 'task-1', extension: { id: 'ext-iso' } });
  });

  it('restore_host uses the Host Isolation Restore extension', async () => {
    const { calls } = mockFetch((call: RecordedCall) =>
      call.method === 'GET' ? { body: [{ id: 'ext-res', name: 'Host Isolation Restore' }] } : { body: { scanTaskId: 't' } });
    await scansHandler.handleCall('datto_edr_restore_host', { target: 'pc1', target_group_id: 'tg1', confirm: true });
    expect(filterOf(calls[0]).where).toEqual({ name: 'Host Isolation Restore' });
    expect(calls[1].method).toBe('POST');
  });

  it('run_response by id passes arguments and fails clearly for unknown names', async () => {
    const byId = mockFetch((call: RecordedCall) =>
      call.method === 'GET' ? { body: { id: 'ext-1', name: 'Kill Process' } } : { body: { scanTaskId: 't' } });
    await scansHandler.handleCall('datto_edr_run_response', {
      target: 'pc1', target_group_id: 'tg1', extension_id: 'ext-1', arguments: { pid: 42 }, confirm: true,
    });
    expect(byId.calls[0].url.pathname).toBe('/api/extensions/ext-1');
    expect((byId.calls[1].body as { options: { extensions: unknown[] } }).options.extensions).toEqual([{ id: 'ext-1', args: { pid: 42 }, order: 0 }]);

    mockFetch([{ body: [] }]);
    await expect(scansHandler.handleCall('datto_edr_run_response', {
      target: 'pc1', target_group_id: 'tg1', extension_name: 'Nope', confirm: true,
    })).rejects.toThrow(/No extension named "Nope"/);

    await expect(scansHandler.handleCall('datto_edr_run_response', { target: 'pc1', target_group_id: 'tg1' }))
      .rejects.toThrow(/extension_id or extension_name/);
  });

  it('DATTO_EDR_READ_ONLY hides and blocks write tools', async () => {
    process.env.DATTO_EDR_READ_ONLY = 'true';
    const names = scansHandler.getTools().map(t => t.name);
    for (const tool of WRITE_TOOLS) expect(names).not.toContain(tool);
    const { calls } = mockFetch([{ body: {} }]);
    const result = await scansHandler.handleCall('datto_edr_isolate_host', { target: 'pc1', target_group_id: 'tg1', confirm: true });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/DATTO_EDR_READ_ONLY/);
    expect(calls).toHaveLength(0);
  });
});
