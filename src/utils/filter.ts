import { z } from 'zod';
import { MAX_LIMIT, type DattoEdrClient } from './client.js';

export const DEFAULT_LIMIT = 50;

export type Where = Record<string, unknown>;

export interface LoopbackFilter {
  where?: Where;
  limit: number;
  skip: number;
  order?: string | string[];
  fields?: string[];
}

/** Shared pagination/filter arguments for every list tool. */
export const listShape = {
  limit: z.number().int().min(1).max(MAX_LIMIT).optional()
    .describe(`Max results per page (1-${MAX_LIMIT}, default ${DEFAULT_LIMIT})`),
  skip: z.number().int().min(0).optional()
    .describe('Number of results to skip (use nextSkip from the previous page)'),
  order: z.string().optional()
    .describe('LoopBack order, e.g. "createdOn DESC" or "hostname ASC"'),
  fields: z.array(z.string()).optional()
    .describe('Only return these properties (keeps responses small)'),
  where: z.record(z.string(), z.unknown()).optional()
    .describe('Extra LoopBack where filter, combined with AND, e.g. {"hostname":{"ilike":"%sql%"}}. Operators: eq, neq, gt, gte, lt, lte, between, inq, nin, like, ilike, and, or. Use datto_edr_api_models to see a model\'s properties.'),
};

export const idShape = {
  id: z.string().min(1).describe('Object id (GUID)'),
};

/** AND-combines where clauses, dropping empty ones. */
export function mergeWhere(...clauses: Array<Where | undefined>): Where | undefined {
  const parts = clauses.filter((c): c is Where => !!c && Object.keys(c).length > 0);
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  return { and: parts };
}

export function buildFilter(
  args: { limit?: number; skip?: number; order?: string; fields?: string[] },
  where?: Where,
  defaultOrder?: string,
): LoopbackFilter {
  const fields = args.fields?.length
    ? Array.from(new Set([...args.fields, 'id']))
    : undefined;
  const filter: LoopbackFilter = {
    limit: Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT),
    skip: args.skip ?? 0,
  };
  if (where) filter.where = where;
  const order = args.order ?? defaultOrder;
  if (order) filter.order = order;
  if (fields) filter.fields = fields;
  return filter;
}

/** Validates that a string is a path segment safe to put after /api/. */
export function assertIdSegment(id: string): string {
  if (!/^[A-Za-z0-9._:-]+$/.test(id)) {
    throw new Error(`Invalid id: ${JSON.stringify(id)}`);
  }
  return encodeURIComponent(id);
}

export interface Page<T = unknown> {
  model: string;
  count: number;
  limit: number;
  skip: number;
  hasMore: boolean;
  nextSkip?: number;
  items: T[];
}

/** GET /api/<model>?filter=... and wrap the array in a page envelope. */
export async function listPage(
  client: DattoEdrClient,
  model: string,
  filter: LoopbackFilter,
): Promise<Page> {
  const result = await client.get<unknown>(model, { filter });
  const items = Array.isArray(result) ? result : [];
  const hasMore = items.length === filter.limit;
  return {
    model,
    count: items.length,
    limit: filter.limit,
    skip: filter.skip,
    hasMore,
    ...(hasMore ? { nextSkip: filter.skip + items.length } : {}),
    items,
  };
}

/** GET /api/<model>/count?where=... */
export async function countWhere(client: DattoEdrClient, model: string, where?: Where): Promise<{ model: string; count: number }> {
  const result = await client.get<{ count?: number }>(`${model}/count`, where ? { where } : undefined);
  return { model, count: Number(result?.count ?? 0) };
}

/** Converts an ISO date/time string into the UTC ISO form LoopBack expects. */
export function isoDate(value: string, label: string): string {
  const time = Date.parse(value);
  if (Number.isNaN(time)) throw new Error(`${label} is not a valid date/time: ${value}`);
  return new Date(time).toISOString();
}

/** Builds a {field: {gte, lte}} clause from optional start/end bounds. */
export function timeRange(field: string, start?: string, end?: string): Where | undefined {
  if (!start && !end) return undefined;
  if (start && end) return { [field]: { between: [isoDate(start, 'start_time'), isoDate(end, 'end_time')] } };
  if (start) return { [field]: { gte: isoDate(start, 'start_time') } };
  return { [field]: { lte: isoDate(end as string, 'end_time') } };
}
