import { z } from 'zod';
import { defineDomain, defineTool } from '../utils/tooling.js';
import { assertIdSegment, buildFilter, countWhere, idShape, isoDate, listPage, listShape, mergeWhere, type Where } from '../utils/filter.js';

const agentFilterShape = {
  hostname: z.string().optional().describe('Exact hostname'),
  hostname_contains: z.string().optional().describe('Case-insensitive hostname substring (LoopBack ilike)'),
  ip: z.string().optional().describe('Exact IP address (ipstring)'),
  active: z.boolean().optional().describe('true = agent currently active/online'),
  authorized: z.boolean().optional().describe('true = agent approved/authorized'),
  last_seen_after: z.string().optional().describe('Only agents with a heartbeat at or after this ISO date/time'),
  last_seen_before: z.string().optional().describe('Only agents whose last heartbeat is at or before this ISO date/time (stale agents)'),
};

type AgentFilterArgs = {
  hostname?: string;
  hostname_contains?: string;
  ip?: string;
  active?: boolean;
  authorized?: boolean;
  last_seen_after?: string;
  last_seen_before?: string;
  where?: Where;
};

export function agentWhere(args: AgentFilterArgs): Where | undefined {
  const clauses: Where[] = [];
  if (args.hostname) clauses.push({ hostname: args.hostname });
  if (args.hostname_contains) clauses.push({ hostname: { ilike: `%${args.hostname_contains}%` } });
  if (args.ip) clauses.push({ ipstring: args.ip });
  if (args.active !== undefined) clauses.push({ active: args.active });
  if (args.authorized !== undefined) clauses.push({ authorized: args.authorized });
  if (args.last_seen_after) clauses.push({ heartbeat: { gte: isoDate(args.last_seen_after, 'last_seen_after') } });
  if (args.last_seen_before) clauses.push({ heartbeat: { lte: isoDate(args.last_seen_before, 'last_seen_before') } });
  return mergeWhere(...clauses, args.where);
}

const tools = [
  defineTool({
    name: 'datto_edr_agents_list',
    description: 'List or search Datto EDR endpoint agents (GET /api/Agents). Filter by hostname, IP, active/authorized state and last heartbeat; add any other property (OS, version, isolation state...) through "where" after checking field names with datto_edr_api_models {"model":"Agents"}. Paged with limit/skip.',
    shape: { ...agentFilterShape, ...listShape },
    handler: async (args, client) => listPage(client, 'Agents', buildFilter(args, agentWhere(args))),
  }),
  defineTool({
    name: 'datto_edr_agents_get',
    description: 'Get one Datto EDR agent by id (GET /api/Agents/{id}).',
    shape: idShape,
    handler: async ({ id }, client) => client.get(`Agents/${assertIdSegment(id)}`),
  }),
  defineTool({
    name: 'datto_edr_agents_count',
    description: 'Count agents matching the same filters as datto_edr_agents_list (GET /api/Agents/count). Useful for "how many agents are offline" questions.',
    shape: {
      ...agentFilterShape,
      where: listShape.where,
    },
    handler: async (args, client) => countWhere(client, 'Agents', agentWhere(args)),
  }),
];

export const agentsHandler = defineDomain(tools);
