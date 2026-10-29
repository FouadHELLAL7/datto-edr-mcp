import { describe, it, expect } from 'vitest';
import { assertIdSegment, buildFilter, mergeWhere, timeRange } from '../utils/filter.js';
import { parseSwagger } from '../utils/swagger.js';

describe('LoopBack filter helpers', () => {
  it('mergeWhere drops empty clauses and ANDs the rest', () => {
    expect(mergeWhere()).toBeUndefined();
    expect(mergeWhere(undefined, {})).toBeUndefined();
    expect(mergeWhere({ a: 1 })).toEqual({ a: 1 });
    expect(mergeWhere({ a: 1 }, undefined, { b: 2 })).toEqual({ and: [{ a: 1 }, { b: 2 }] });
  });

  it('buildFilter applies defaults, caps the limit and always keeps id in fields', () => {
    expect(buildFilter({})).toEqual({ limit: 50, skip: 0 });
    expect(buildFilter({ limit: 5000, skip: 10 }).limit).toBe(1000);
    expect(buildFilter({ fields: ['hostname'] }).fields).toEqual(['hostname', 'id']);
    expect(buildFilter({}, { a: 1 }, 'createdOn DESC')).toEqual({ limit: 50, skip: 0, where: { a: 1 }, order: 'createdOn DESC' });
    expect(buildFilter({ order: 'id ASC' }, undefined, 'createdOn DESC').order).toBe('id ASC');
  });

  it('timeRange builds gte/lte/between clauses in UTC ISO form', () => {
    expect(timeRange('createdOn')).toBeUndefined();
    expect(timeRange('createdOn', '2026-01-01')).toEqual({ createdOn: { gte: '2026-01-01T00:00:00.000Z' } });
    expect(timeRange('createdOn', undefined, '2026-01-02T00:00:00Z')).toEqual({ createdOn: { lte: '2026-01-02T00:00:00.000Z' } });
    expect(timeRange('createdOn', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z')).toEqual({
      createdOn: { between: ['2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z'] },
    });
    expect(() => timeRange('createdOn', 'yesterday-ish')).toThrow(/not a valid date/);
  });

  it('assertIdSegment rejects path tricks', () => {
    expect(assertIdSegment('3f2c1b7e-0000-4000-8000-000000000001')).toBe('3f2c1b7e-0000-4000-8000-000000000001');
    expect(() => assertIdSegment('../users')).toThrow();
    expect(() => assertIdSegment('a/b')).toThrow();
    expect(() => assertIdSegment('a?x=1')).toThrow();
  });
});

describe('parseSwagger', () => {
  it('extracts model roots and methods', () => {
    const catalog = parseSwagger({
      paths: {
        '/Agents': { get: {}, post: {} },
        '/Agents/{id}': { get: {}, parameters: [] as unknown as Record<string, unknown> },
        '/Organizations/count': { get: {} },
      },
      definitions: { Agent: { properties: { hostname: { type: 'string' } } } },
    });
    expect(catalog.models).toEqual(['Agents', 'Organizations']);
    expect(catalog.paths['/Agents']).toEqual(['GET', 'POST']);
    expect(catalog.paths['/Agents/{id}']).toEqual(['GET']);
  });
});
