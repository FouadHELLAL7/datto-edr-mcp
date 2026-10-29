import { z } from 'zod';
import { confirmShape, defineDomain, defineTool } from '../utils/tooling.js';
import { assertIdSegment, buildFilter, idShape, listPage, listShape, mergeWhere } from '../utils/filter.js';
import type { DattoEdrClient } from '../utils/client.js';

const SCAN_OPTION_KEYS = [
  'process', 'module', 'driver', 'memory', 'account', 'artifact',
  'autostart', 'application', 'installed', 'hook', 'network', 'events',
] as const;
type ScanOptionKey = typeof SCAN_OPTION_KEYS[number];

// Defaults match New-ICScanOptions in the official module: everything on
// except the slow "installed" and "hook" collections.
const DEFAULT_SCAN_OPTIONS: Record<ScanOptionKey, boolean> = {
  process: true, module: true, driver: true, memory: true, account: true, artifact: true,
  autostart: true, application: true, installed: false, hook: false, network: true, events: true,
};

interface ExtensionRef { id: string; name?: string }

const targetShape = {
  target: z.string().min(1).describe('Hostname or IP address of the host'),
  target_group_id: z.string().min(1).describe('Target group id the host belongs to (see datto_edr_target_groups_list)'),
};

const writeAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };

async function resolveExtension(client: DattoEdrClient, id?: string, name?: string): Promise<ExtensionRef> {
  if (id) {
    const ext = await client.get<{ id: string; name?: string }>(`extensions/${assertIdSegment(id)}`);
    return { id: ext?.id ?? id, name: ext?.name };
  }
  const matches = await client.get<Array<{ id: string; name?: string }>>('extensions', {
    filter: { where: { name }, fields: ['id', 'name'], limit: 10 },
  });
  // Invoke-ICResponse takes the last match when several share a name.
  const ext = Array.isArray(matches) ? matches[matches.length - 1] : undefined;
  if (!ext) throw new Error(`No extension named "${name}" exists on this instance (see datto_edr_extensions_list).`);
  return { id: ext.id, name: ext.name ?? name };
}

function scanBody(target: string, targetGroupId: string, options: Record<string, unknown>) {
  return { target, targetGroup: { id: targetGroupId }, options };
}

async function runResponse(
  client: DattoEdrClient,
  args: { target: string; target_group_id: string; confirm?: boolean; extension_id?: string; extension_name?: string; arguments?: Record<string, unknown> },
  action: string,
) {
  const ext = await resolveExtension(client, args.extension_id, args.extension_name);
  const options = {
    ...Object.fromEntries(SCAN_OPTION_KEYS.map(k => [k, false])),
    extensions: [{ id: ext.id, args: args.arguments ?? {}, order: 0 }],
  };
  const body = scanBody(args.target, args.target_group_id, options);
  if (!args.confirm) {
    return {
      executed: false,
      message: `Would ${action} on ${args.target} by running extension "${ext.name ?? ext.id}". Call again with confirm: true to execute.`,
      request: { method: 'POST', path: '/api/targets/scan', body },
    };
  }
  const result = await client.post<{ scanTaskId?: string }>('targets/scan', body);
  return {
    executed: true,
    action,
    target: args.target,
    extension: ext,
    taskId: result?.scanTaskId ?? null,
    next: 'Track progress with datto_edr_tasks_get using taskId.',
    response: result,
  };
}

const tools = [
  defineTool({
    name: 'datto_edr_scans_list',
    description: 'List Datto EDR scans (GET /api/scans), optionally for one target group.',
    shape: {
      target_group_id: z.string().optional().describe('Only scans of this target group (targetId)'),
      ...listShape,
    },
    handler: async (args, client) =>
      listPage(client, 'scans', buildFilter(args, mergeWhere(
        args.target_group_id ? { targetId: args.target_group_id } : undefined,
        args.where,
      ))),
  }),
  defineTool({
    name: 'datto_edr_scans_get',
    description: 'Get one scan by id (GET /api/scans/{id}).',
    shape: idShape,
    handler: async ({ id }, client) => client.get(`scans/${assertIdSegment(id)}`),
  }),
  defineTool({
    name: 'datto_edr_tasks_list',
    description: 'List user tasks (scans, responses, enumerations shown in the task list), newest first (GET /api/usertasks). Use status "Active" for running tasks.',
    shape: {
      status: z.string().optional().describe('Task status, e.g. "Active", "Completed", "Cancelled"'),
      type: z.string().optional().describe('Task type, e.g. "Scan"'),
      include_archived: z.boolean().optional().describe('Include archived tasks (default false)'),
      ...listShape,
    },
    handler: async (args, client) =>
      listPage(client, 'usertasks', buildFilter(args, mergeWhere(
        args.status ? { status: args.status } : undefined,
        args.type ? { type: args.type } : undefined,
        args.include_archived ? undefined : { archived: false },
        args.where,
      ), 'createdOn DESC')),
  }),
  defineTool({
    name: 'datto_edr_tasks_get',
    description: 'Get one user task by id, including status, progress and message (GET /api/usertasks/{id}). Use it to follow a scan or response started by this server.',
    shape: idShape,
    handler: async ({ id }, client) => client.get(`usertasks/${assertIdSegment(id)}`),
  }),
  defineTool({
    name: 'datto_edr_task_items_list',
    description: 'List the per-host items of a user task (GET /api/userTaskItems), e.g. the result of a scan or response on each host.',
    shape: {
      task_id: z.string().min(1).describe('User task id'),
      ...listShape,
    },
    handler: async (args, client) =>
      listPage(client, 'userTaskItems', buildFilter(args, mergeWhere({ userTaskId: args.task_id }, args.where))),
  }),
  defineTool({
    name: 'datto_edr_jobs_list',
    description: 'List background jobs (GET /api/jobs). Pass state "active" for running jobs.',
    shape: {
      state: z.string().optional().describe('Job state, e.g. "active"'),
      ...listShape,
    },
    handler: async (args, client) =>
      listPage(client, 'jobs', buildFilter(args, mergeWhere(args.state ? { state: args.state } : undefined, args.where))),
  }),

  // ---- write actions -------------------------------------------------------
  defineTool({
    name: 'datto_edr_scan_host',
    description: '⚠ HIGH-IMPACT: Start a forensic scan of one host (POST /api/targets/scan). Runs on the endpoint and uses its resources. Requires confirm: true; without it, returns the request it would send. Returns a task id for datto_edr_tasks_get.',
    write: true,
    annotations: writeAnnotations,
    shape: {
      ...targetShape,
      options: z.object(Object.fromEntries(SCAN_OPTION_KEYS.map(k => [k, z.boolean().optional()]))).optional()
        .describe('Collections to turn on/off. Default: all on except "installed" and "hook".'),
      ...confirmShape,
    },
    handler: async (args, client) => {
      const options = { ...DEFAULT_SCAN_OPTIONS, ...(args.options ?? {}), extensions: [] };
      const body = scanBody(args.target, args.target_group_id, options);
      if (!args.confirm) {
        return {
          executed: false,
          message: `Would start a scan of ${args.target}. Call again with confirm: true to execute.`,
          request: { method: 'POST', path: '/api/targets/scan', body },
        };
      }
      const result = await client.post<{ scanTaskId?: string }>('targets/scan', body);
      return {
        executed: true,
        action: 'scan',
        target: args.target,
        taskId: result?.scanTaskId ?? null,
        next: 'Track progress with datto_edr_tasks_get using taskId.',
        response: result,
      };
    },
  }),
  defineTool({
    name: 'datto_edr_run_response',
    description: '⚠ HIGH-IMPACT: Run a response extension (e.g. kill process, isolate, collect evidence) on one host (POST /api/targets/scan with the extension). Identify the extension by id or exact name. Requires confirm: true; without it, returns the request it would send.',
    write: true,
    annotations: writeAnnotations,
    shape: {
      ...targetShape,
      extension_id: z.string().optional().describe('Extension id'),
      extension_name: z.string().optional().describe('Exact extension name (used when extension_id is not given)'),
      arguments: z.record(z.string(), z.unknown()).optional().describe('Arguments passed to the extension'),
      ...confirmShape,
    },
    handler: async (args, client) => {
      if (!args.extension_id && !args.extension_name) throw new Error('Pass extension_id or extension_name.');
      return runResponse(client, args, 'run a response action');
    },
  }),
  defineTool({
    name: 'datto_edr_isolate_host',
    description: '⚠ HIGH-IMPACT: Network-isolate one host by running the "Host Isolation" response extension. The host keeps talking to Datto EDR but loses all other network access until restored (Windows and Linux). Requires confirm: true.',
    write: true,
    annotations: writeAnnotations,
    shape: { ...targetShape, ...confirmShape },
    handler: async (args, client) => runResponse(client, { ...args, extension_name: 'Host Isolation' }, 'isolate the host'),
  }),
  defineTool({
    name: 'datto_edr_restore_host',
    description: '⚠ HIGH-IMPACT: Remove network isolation from one host by running the "Host Isolation Restore" response extension. Requires confirm: true.',
    write: true,
    annotations: writeAnnotations,
    shape: { ...targetShape, ...confirmShape },
    handler: async (args, client) => runResponse(client, { ...args, extension_name: 'Host Isolation Restore' }, 'restore network access'),
  }),
];

export const scansHandler = defineDomain(tools);
