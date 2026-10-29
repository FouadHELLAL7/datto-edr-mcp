import { defineDomain, defineTool } from '../utils/tooling.js';
import { assertIdSegment, buildFilter, idShape, listPage, listShape } from '../utils/filter.js';
import { resolveModel } from '../utils/swagger.js';

// Organizations and Locations arrived in Datto EDR in October 2023 and are not
// used by any public API client, so their model names are not hard-coded:
// each call resolves them against the instance's own swagger description.
const ORGANIZATION_MODELS = ['Organizations', 'Organization'];
const LOCATION_MODELS = ['Locations', 'Location'];
const INTEGRATION_MODELS = ['Integrations', 'Integration'];

const resolvedNote = 'The endpoint is looked up in this instance\'s /explorer/swagger.json; if it is missing, the error lists related models to query with datto_edr_raw_request.';

const tools = [
  defineTool({
    name: 'datto_edr_organizations_list',
    description: `List Datto EDR organizations (tenants/customers). ${resolvedNote}`,
    shape: listShape,
    handler: async (args, client) => {
      const model = await resolveModel(client, ORGANIZATION_MODELS, 'organization');
      return listPage(client, model, buildFilter(args, args.where));
    },
  }),
  defineTool({
    name: 'datto_edr_organizations_get',
    description: `Get one Datto EDR organization by id. ${resolvedNote}`,
    shape: idShape,
    handler: async ({ id }, client) => {
      const model = await resolveModel(client, ORGANIZATION_MODELS, 'organization');
      return client.get(`${model}/${assertIdSegment(id)}`);
    },
  }),
  defineTool({
    name: 'datto_edr_locations_list',
    description: `List Datto EDR locations (sites inside organizations). Filter by organization through "where" once you know the field name (datto_edr_api_models). ${resolvedNote}`,
    shape: listShape,
    handler: async (args, client) => {
      const model = await resolveModel(client, LOCATION_MODELS, 'location');
      return listPage(client, model, buildFilter(args, args.where));
    },
  }),
  defineTool({
    name: 'datto_edr_locations_get',
    description: `Get one Datto EDR location by id. ${resolvedNote}`,
    shape: idShape,
    handler: async ({ id }, client) => {
      const model = await resolveModel(client, LOCATION_MODELS, 'location');
      return client.get(`${model}/${assertIdSegment(id)}`);
    },
  }),
  defineTool({
    name: 'datto_edr_integrations_list',
    description: `List configured integrations (RMM, PSA, RocketCyber...). ${resolvedNote}`,
    shape: listShape,
    handler: async (args, client) => {
      const model = await resolveModel(client, INTEGRATION_MODELS, 'integration');
      return listPage(client, model, buildFilter(args, args.where));
    },
  }),
];

export const organizationsHandler = defineDomain(tools);
