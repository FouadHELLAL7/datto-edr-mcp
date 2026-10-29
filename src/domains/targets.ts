import { z } from 'zod';
import { defineDomain, defineTool } from '../utils/tooling.js';
import { assertIdSegment, buildFilter, idShape, listPage, listShape, mergeWhere } from '../utils/filter.js';

const tools = [
  defineTool({
    name: 'datto_edr_target_groups_list',
    description: 'List Datto EDR target groups (GET /api/targets). Target groups hold the hosts that scans and response actions run against; their ids are needed by datto_edr_scan_host and the response tools.',
    shape: {
      name: z.string().optional().describe('Exact target group name'),
      ...listShape,
    },
    handler: async (args, client) =>
      listPage(client, 'targets', buildFilter(args, mergeWhere(args.name ? { name: args.name } : undefined, args.where))),
  }),
  defineTool({
    name: 'datto_edr_target_groups_get',
    description: 'Get one target group by id (GET /api/targets/{id}).',
    shape: idShape,
    handler: async ({ id }, client) => client.get(`targets/${assertIdSegment(id)}`),
  }),
  defineTool({
    name: 'datto_edr_addresses_list',
    description: 'List discovered host addresses (GET /api/Addresses), optionally within one target group. Shows whether each host was reachable and which agent it maps to.',
    shape: {
      target_group_id: z.string().optional().describe('Only addresses in this target group (targetId)'),
      hostname: z.string().optional().describe('Exact hostname'),
      ip: z.string().optional().describe('Exact IP address (ipstring)'),
      accessible: z.boolean().optional().describe('Only addresses that were (true) or were not (false) accessible'),
      ...listShape,
    },
    handler: async (args, client) => {
      const where = mergeWhere(
        args.target_group_id ? { targetId: args.target_group_id } : undefined,
        args.hostname ? { hostname: args.hostname } : undefined,
        args.ip ? { ipstring: args.ip } : undefined,
        args.accessible !== undefined ? { accessible: args.accessible } : undefined,
        args.where,
      );
      return listPage(client, 'Addresses', buildFilter(args, where));
    },
  }),
];

export const targetsHandler = defineDomain(tools);
