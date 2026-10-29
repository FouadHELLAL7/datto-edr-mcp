import { z } from 'zod';
import type { Tool, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { getClient, type DattoEdrClient } from './client.js';
import { logger } from './logger.js';
import type { CallToolResult, DomainHandler } from './types.js';

/** Responses above this size are refused with a hint to page or select fields. */
const MAX_RESPONSE_CHARS = 400_000;

export interface ToolDef<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  description: string;
  shape: S;
  /** Write tools are hidden when DATTO_EDR_READ_ONLY=true and need confirm: true. */
  write?: boolean;
  annotations?: ToolAnnotations;
  handler: (args: z.infer<z.ZodObject<S>>, client: DattoEdrClient) => Promise<unknown>;
}

export function defineTool<S extends z.ZodRawShape>(def: ToolDef<S>): ToolDef {
  return def as unknown as ToolDef;
}

export function isReadOnly(): boolean {
  return ['1', 'true', 'yes'].includes((process.env.DATTO_EDR_READ_ONLY ?? '').toLowerCase());
}

export const confirmShape = {
  confirm: z.boolean().optional()
    .describe('Must be true to execute. Without it the tool only describes what it would do.'),
};

export function textResult(value: unknown): CallToolResult {
  const text = JSON.stringify(value ?? null, null, 2) ?? 'null';
  if (text.length > MAX_RESPONSE_CHARS) {
    return {
      content: [{
        type: 'text',
        text: `Response too large (${text.length} characters). Lower "limit", page with "skip", or pass "fields" to select fewer properties.`,
      }],
      isError: true,
    };
  }
  return { content: [{ type: 'text', text }] };
}

export function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

function toInputSchema(shape: z.ZodRawShape): Tool['inputSchema'] {
  const json = z.toJSONSchema(z.object(shape), { io: 'input' }) as Record<string, unknown>;
  delete json.$schema;
  return { ...json, type: 'object' } as Tool['inputSchema'];
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map(i => `${i.path.length ? i.path.join('.') : '(arguments)'}: ${i.message}`)
    .join('; ');
}

/** Builds a DomainHandler from zod-typed tool definitions. */
export function defineDomain(defs: ToolDef[]): DomainHandler {
  const byName = new Map(defs.map(d => [d.name, d]));
  const schemas = new Map(defs.map(d => [d.name, z.object(d.shape)]));

  return {
    getTools(): Tool[] {
      return defs
        .filter(d => !(d.write && isReadOnly()))
        .map(d => ({
          name: d.name,
          description: d.description,
          inputSchema: toInputSchema(d.shape),
          annotations: d.annotations ?? (d.write
            ? { readOnlyHint: false, destructiveHint: true, openWorldHint: true }
            : { readOnlyHint: true, openWorldHint: true }),
        }));
    },

    async handleCall(toolName, args): Promise<CallToolResult> {
      const def = byName.get(toolName);
      const schema = schemas.get(toolName);
      if (!def || !schema) return errorResult(`Unknown tool: ${toolName}`);
      if (def.write && isReadOnly()) {
        return errorResult(`${toolName} is disabled because DATTO_EDR_READ_ONLY is set.`);
      }
      const parsed = schema.safeParse(args ?? {});
      if (!parsed.success) return errorResult(`Invalid arguments: ${formatIssues(parsed.error)}`);
      const client = await getClient();
      logger.info('Tool call', { tool: toolName });
      return textResult(await def.handler(parsed.data, client));
    },
  };
}
