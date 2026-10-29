import { z } from 'zod';
import { defineDomain, defineTool } from '../utils/tooling.js';
import { buildFilter, listPage, listShape, mergeWhere } from '../utils/filter.js';
import { getCatalog } from '../utils/swagger.js';

// Models whose rows hold secrets (scan credentials, API/access tokens,
// passwords). The raw escape hatch refuses them so it cannot be used to read
// another credential through this server.
const SENSITIVE_PATH = /credential|token|password|secret|apikey/i;

function normalizeRawPath(path: string): string {
  const trimmed = path.trim().replace(/^\/+/, '').replace(/^api\//i, '');
  if (!trimmed || trimmed.includes('..') || trimmed.includes('://') || trimmed.includes('\\') || /[?#]/.test(trimmed)) {
    throw new Error('Invalid path. Pass a path relative to /api such as "Agents" or "Agents/count"; put query parameters in "query".');
  }
  if (SENSITIVE_PATH.test(trimmed)) {
    throw new Error('Refusing to read a credential/token model through the raw request tool.');
  }
  return trimmed;
}

const tools = [
  defineTool({
    name: 'datto_edr_test_connection',
    description: 'Test the connection and token against the Datto EDR instance (GET /api/Version). Returns the instance host and API version.',
    shape: {},
    handler: async (_args, client) => {
      const version = await client.get('Version');
      return { connected: true, instance: client.host, version };
    },
  }),
  defineTool({
    name: 'datto_edr_api_models',
    description: 'List the API models this Datto EDR instance exposes (read from its /explorer/swagger.json), or pass "model" to see that model\'s paths and properties. Use it to find filterable field names before building a "where" filter.',
    shape: {
      model: z.string().optional().describe('Model name, e.g. "Agents" or "Alerts". Omit to list all models.'),
    },
    handler: async ({ model }, client) => {
      const catalog = await getCatalog(client);
      if (!model) return { instance: client.host, count: catalog.models.length, models: catalog.models };
      const lower = model.toLowerCase();
      const paths = Object.fromEntries(
        Object.entries(catalog.paths).filter(([p]) => p.replace(/^\/+/, '').split('/')[0].toLowerCase() === lower),
      );
      const definitionKey = Object.keys(catalog.definitions ?? {}).find(k => {
        const k2 = k.toLowerCase();
        return k2 === lower || `${k2}s` === lower || k2 === `${lower}s` || k2 === lower.replace(/ies$/, 'y');
      });
      const properties = definitionKey ? catalog.definitions?.[definitionKey]?.properties ?? {} : {};
      if (Object.keys(paths).length === 0 && !definitionKey) {
        throw new Error(`Model ${model} not found. Call datto_edr_api_models without "model" to list models.`);
      }
      return {
        model,
        definition: definitionKey ?? null,
        properties: Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, v?.format ?? v?.type ?? 'unknown'])),
        paths,
      };
    },
  }),
  defineTool({
    name: 'datto_edr_raw_request',
    description: 'Read-only escape hatch for Datto EDR API endpoints not covered by a typed tool. Prefer typed tools. Sends GET https://<instance>/api/<path>; the token is added automatically. Object values in "query" are JSON-encoded, so pass a LoopBack filter as {"filter":{"where":{...},"limit":50}} or a count as path "Model/count" with {"where":{...}}. Credential and token models are refused.',
    shape: {
      path: z.string().min(1).describe('Path relative to /api, e.g. "Agents", "Agents/count", "AlertDetails", "Cves/CVE-2024-1234"'),
      query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.record(z.string(), z.unknown()), z.array(z.unknown())])).optional()
        .describe('Query parameters, e.g. {"filter":{"where":{"active":true},"limit":10}}'),
    },
    handler: async ({ path, query }, client) => {
      const safePath = normalizeRawPath(path);
      if (query && Object.keys(query).some(k => k.toLowerCase() === 'access_token')) {
        throw new Error('Do not pass access_token; authentication is added automatically.');
      }
      return client.get(safePath, query);
    },
  }),
  defineTool({
    name: 'datto_edr_audit_log_list',
    description: 'List user activity (audit log) entries (GET /api/useractivities).',
    shape: {
      user_id: z.string().optional().describe('Only activity by this user id'),
      ...listShape,
    },
    handler: async (args, client) => {
      const where = mergeWhere(args.user_id ? { userId: args.user_id } : undefined, args.where);
      return listPage(client, 'useractivities', buildFilter(args, where));
    },
  }),
];

export const systemHandler = defineDomain(tools);
