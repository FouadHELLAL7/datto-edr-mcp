import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getNavigationTools, DOMAINS } from './domains/navigation.js';
import { getDomainHandler } from './domains/index.js';
import { getCredentials } from './utils/client.js';
import { logger } from './utils/logger.js';
import { isReadOnly } from './utils/tooling.js';
import type { CallToolResult, DomainName } from './utils/types.js';

export const SERVER_NAME = 'datto-edr-mcp';
export const SERVER_VERSION = '1.0.0';

// Belt-and-braces guard: never emit a content block whose text is not a
// string. JSON.stringify(undefined) returns the VALUE undefined, which fails
// MCP client validation on every call.
function sanitizeResult(toolName: string, result: CallToolResult): CallToolResult {
  for (const block of result.content) {
    if (typeof block.text !== 'string') {
      logger.warn('Coerced non-string content text to "null"', { tool: toolName, textType: typeof block.text });
      block.text = 'null';
    }
  }
  return result;
}

function instanceHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export function createServer(): Server {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: {
        tools: {},
        logging: {},
      },
    }
  );

  // Return ALL tools upfront — navigation is a stateless help/discovery tool
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const allTools = [...getNavigationTools()];
    for (const domain of DOMAINS) {
      const handler = await getDomainHandler(domain);
      allTools.push(...handler.getTools());
    }
    return { tools: allTools };
  });

  // Route tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;

    // Navigation: navigate (stateless discovery aid)
    if (name === 'datto_edr_navigate') {
      const domain = (args?.domain as string) as DomainName;
      if (!DOMAINS.includes(domain)) {
        return {
          content: [{ type: 'text' as const, text: `Invalid domain: ${domain}. Valid: ${DOMAINS.join(', ')}` }],
          isError: true,
        };
      }

      const handler = await getDomainHandler(domain);
      const tools = handler.getTools().map(t => `${t.name}: ${t.description}`);

      return {
        content: [{
          type: 'text' as const,
          text: `Domain: ${domain}\n\nAvailable tools:\n${tools.join('\n')}`,
        }],
      };
    }

    // Navigation: status (no API call, never echoes the token)
    if (name === 'datto_edr_status') {
      const creds = getCredentials();
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            connected: !!creds,
            instance: creds ? instanceHost(creds.url) : null,
            readOnly: isReadOnly(),
            domains: DOMAINS,
            status: creds
              ? 'Credentials configured. Call datto_edr_test_connection for a live check.'
              : 'No credentials. Set DATTO_EDR_URL and DATTO_EDR_API_TOKEN (or send the X-Datto-EDR-* headers in gateway mode).',
          }, null, 2),
        }],
      };
    }

    // Domain tool calls — try every domain handler
    for (const domain of DOMAINS) {
      const handler = await getDomainHandler(domain);
      const toolNames = handler.getTools().map(t => t.name);
      if (toolNames.includes(name)) {
        try {
          const result = await handler.handleCall(name, (args || {}) as Record<string, unknown>, extra);
          return sanitizeResult(name, result);
        } catch (error) {
          logger.error('Tool call failed', { tool: name, error: (error as Error).message });
          return {
            content: [{ type: 'text' as const, text: `Error: ${(error as Error).message}` }],
            isError: true,
          };
        }
      }
    }

    return {
      content: [{ type: 'text' as const, text: `Unknown tool: ${name}. Call datto_edr_navigate to see the available tools.` }],
      isError: true,
    };
  });

  return server;
}
