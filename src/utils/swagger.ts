import type { DattoEdrClient } from './client.js';

interface SwaggerDoc {
  basePath?: string;
  paths?: Record<string, Record<string, unknown>>;
  definitions?: Record<string, { properties?: Record<string, { type?: string; format?: string; description?: string }> }>;
}

export interface ApiCatalog {
  /** Model path roots (the part after /api/), e.g. "Agents", "Alerts". */
  models: string[];
  /** All paths with their HTTP methods. */
  paths: Record<string, string[]>;
  definitions: SwaggerDoc['definitions'];
}

const CACHE_TTL_MS = 10 * 60 * 1000;
// Keyed by instance base URL. Swagger describes the instance, not the caller,
// so sharing it across tenants of the same instance is safe.
const cache = new Map<string, { expires: number; catalog: ApiCatalog }>();

export function clearSwaggerCache(): void {
  cache.clear();
}

export function parseSwagger(doc: SwaggerDoc): ApiCatalog {
  const paths: Record<string, string[]> = {};
  const models = new Set<string>();
  for (const [path, ops] of Object.entries(doc.paths ?? {})) {
    paths[path] = Object.keys(ops ?? {}).filter(m => m !== 'parameters').map(m => m.toUpperCase());
    const root = path.replace(/^\/+/, '').split('/')[0];
    if (root) models.add(root);
  }
  return { models: [...models].sort((a, b) => a.localeCompare(b)), paths, definitions: doc.definitions ?? {} };
}

export async function getCatalog(client: DattoEdrClient): Promise<ApiCatalog> {
  const hit = cache.get(client.baseUrl);
  if (hit && hit.expires > Date.now()) return hit.catalog;
  const doc = await client.swagger<SwaggerDoc>();
  const catalog = parseSwagger(doc ?? {});
  cache.set(client.baseUrl, { expires: Date.now() + CACHE_TTL_MS, catalog });
  return catalog;
}

/**
 * Picks the first candidate model the instance actually exposes
 * (case-insensitive). Throws with the related models it does expose when none
 * match, so the caller can fall back to datto_edr_raw_request.
 */
export async function resolveModel(client: DattoEdrClient, candidates: string[], keyword: string): Promise<string> {
  let catalog: ApiCatalog;
  try {
    catalog = await getCatalog(client);
  } catch (error) {
    throw new Error(
      `Could not read ${client.host}/explorer/swagger.json to locate the ${keyword} endpoint: ${(error as Error).message}`,
    );
  }
  const byLower = new Map(catalog.models.map(m => [m.toLowerCase(), m]));
  for (const candidate of candidates) {
    const found = byLower.get(candidate.toLowerCase());
    if (found) return found;
  }
  const related = catalog.models.filter(m => m.toLowerCase().includes(keyword.toLowerCase()));
  throw new Error(
    `This Datto EDR instance does not expose a ${candidates.join('/')} endpoint. ` +
      (related.length
        ? `Related models: ${related.join(', ')}. Query them with datto_edr_raw_request.`
        : 'Use datto_edr_api_models to list what it does expose.'),
  );
}
