import { z } from 'zod';
import { defineDomain, defineTool } from '../utils/tooling.js';
import { assertIdSegment, buildFilter, idShape, listPage, listShape, mergeWhere } from '../utils/filter.js';

const tools = [
  defineTool({
    name: 'datto_edr_rules_list',
    description: 'List Datto EDR detection rules (GET /api/rules).',
    shape: {
      name: z.string().optional().describe('Exact rule name'),
      ...listShape,
    },
    handler: async (args, client) =>
      listPage(client, 'rules', buildFilter(args, mergeWhere(args.name ? { name: args.name } : undefined, args.where))),
  }),
  defineTool({
    name: 'datto_edr_rules_get',
    description: 'Get one detection rule by id (GET /api/rules/{id}).',
    shape: idShape,
    handler: async ({ id }, client) => client.get(`rules/${assertIdSegment(id)}`),
  }),
  defineTool({
    name: 'datto_edr_extensions_list',
    description: 'List Datto EDR extensions (GET /api/extensions): collection extensions and response actions such as "Host Isolation" and "Host Isolation Restore". Extension ids/names feed datto_edr_run_response.',
    shape: {
      name: z.string().optional().describe('Exact extension name, e.g. "Host Isolation"'),
      ...listShape,
    },
    handler: async (args, client) =>
      listPage(client, 'extensions', buildFilter(args, mergeWhere(args.name ? { name: args.name } : undefined, args.where))),
  }),
  defineTool({
    name: 'datto_edr_extensions_get',
    description: 'Get one extension by id (GET /api/extensions/{id}).',
    shape: idShape,
    handler: async ({ id }, client) => client.get(`extensions/${assertIdSegment(id)}`),
  }),
  defineTool({
    name: 'datto_edr_action_types_list',
    description: 'List the response/action types the instance supports (GET /api/ActionTypes).',
    shape: listShape,
    handler: async (args, client) => listPage(client, 'ActionTypes', buildFilter(args, args.where)),
  }),
];

export const rulesHandler = defineDomain(tools);
