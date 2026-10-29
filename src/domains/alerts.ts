import { z } from 'zod';
import { defineDomain, defineTool } from '../utils/tooling.js';
import { assertIdSegment, buildFilter, countWhere, idShape, listPage, listShape, mergeWhere, timeRange, type Where } from '../utils/filter.js';

// Alerts older than 30 days live in a separate archive table (Get-ICAlert).
const ARCHIVE_MODEL = 'Alertsarchive';

const alertFilterShape = {
  start_time: z.string().optional().describe('Only alerts created at or after this ISO date/time'),
  end_time: z.string().optional().describe('Only alerts created at or before this ISO date/time'),
  include_archived: z.boolean().optional().describe('Include alerts marked archived (default false)'),
  archive_table: z.boolean().optional().describe('Query the alert archive table (alerts older than 30 days) instead of live alerts'),
};

type AlertFilterArgs = {
  start_time?: string;
  end_time?: string;
  include_archived?: boolean;
  archive_table?: boolean;
  where?: Where;
};

export function alertWhere(args: AlertFilterArgs): Where | undefined {
  const archivedClause = args.include_archived || args.archive_table ? undefined : { archived: false };
  return mergeWhere(timeRange('createdOn', args.start_time, args.end_time), archivedClause, args.where);
}

const tools = [
  defineTool({
    name: 'datto_edr_alerts_list',
    description: 'List Datto EDR alerts, newest first (GET /api/Alerts). Filter by creation date range and archived state; filter by severity, host, organization, status or any other property through "where" (see datto_edr_api_models {"model":"Alerts"} for this instance\'s field names). Set archive_table for alerts older than 30 days.',
    shape: { ...alertFilterShape, ...listShape },
    handler: async (args, client) =>
      listPage(client, args.archive_table ? ARCHIVE_MODEL : 'Alerts', buildFilter(args, alertWhere(args), 'createdOn DESC')),
  }),
  defineTool({
    name: 'datto_edr_alerts_get',
    description: 'Get one Datto EDR alert by id (GET /api/Alerts/{id}).',
    shape: {
      ...idShape,
      archive_table: z.boolean().optional().describe('Look the id up in the alert archive table'),
    },
    handler: async ({ id, archive_table }, client) =>
      client.get(`${archive_table ? ARCHIVE_MODEL : 'Alerts'}/${assertIdSegment(id)}`),
  }),
  defineTool({
    name: 'datto_edr_alerts_count',
    description: 'Count alerts matching the same filters as datto_edr_alerts_list (GET /api/Alerts/count).',
    shape: { ...alertFilterShape, where: listShape.where },
    handler: async (args, client) =>
      countWhere(client, args.archive_table ? ARCHIVE_MODEL : 'Alerts', alertWhere(args)),
  }),
  defineTool({
    name: 'datto_edr_alert_details_list',
    description: 'List enriched alert records (GET /api/AlertDetails), which join alert, host and file/rule context. Use "where" to filter (e.g. by alert id or hostname) and "fields" to keep the response small.',
    shape: listShape,
    handler: async (args, client) => listPage(client, 'AlertDetails', buildFilter(args, args.where)),
  }),
];

export const alertsHandler = defineDomain(tools);
