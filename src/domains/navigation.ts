import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainName } from '../utils/types.js';

export const DOMAINS: DomainName[] = ['system', 'agents', 'alerts', 'targets', 'organizations', 'scans', 'rules'];

export function getNavigationTools(): Tool[] {
  return [
    {
      name: 'datto_edr_navigate',
      description: `Discover available Datto EDR tools by domain. Returns tool names and descriptions for the selected domain. All tools are callable at any time — this is a help/discovery aid, not a prerequisite.`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          domain: {
            type: 'string',
            enum: DOMAINS,
            description: `The domain to explore:
- system: connection test, API model discovery, read-only raw requests, audit log
- agents: list/search/get/count endpoint agents
- alerts: list/get/count alerts, alert details, archived alerts
- targets: target groups and their discovered addresses
- organizations: organizations, locations and integrations (resolved from the instance's API description)
- scans: scans, tasks, task items, jobs, and write actions (scan host, isolate, restore, run response)
- rules: detection rules, extensions (collection and response), action types`,
          },
        },
        required: ['domain'],
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
      name: 'datto_edr_status',
      description: 'Check whether Datto EDR credentials are configured and list the available domains. Does not call the API; use datto_edr_test_connection for a live check.',
      inputSchema: { type: 'object' as const, properties: {} },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
  ];
}
