import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export type DomainName = 'system' | 'agents' | 'alerts' | 'targets' | 'organizations' | 'scans' | 'rules';

export type CallToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
};

export interface DomainHandler {
  getTools(): Tool[];
  handleCall(
    toolName: string,
    args: Record<string, unknown>,
    extra?: unknown
  ): Promise<CallToolResult>;
}
