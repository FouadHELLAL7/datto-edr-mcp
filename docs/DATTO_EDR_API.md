# Datto EDR (Infocyte) API notes

Sources used to verify every endpoint this server calls:

1. Datto EDR help: *LoopBack API explorer* and *Generating API tokens*
   (`edr.datto.com/help/Content/09-navigating-admin-options/`).
2. **InfocyteHUNTAPI** PowerShell module v2.0.7 (PowerShell Gallery; same code as
   `github.com/Infocyte/PowershellTools/HUNT Powershell Module`, last commit Dec 2024),
   the official Infocyte client.
3. Cortex XSOAR `Packs/Infocyte` integration (uses the module; response extension names).
4. `infocyteapiquery` (PyPI) and the Devo Infocyte collector (`AlertDetails`).

No live instance was available while building, so the instance's own
`/explorer/swagger.json` could not be read. The server reads it at runtime
(`datto_edr_api_models`), and uses it to resolve the newer models that no public client covers.

## Base URL and auth

- Base: `https://<instance>/api/<Model>`; instances are usually `https://<name>.infocyte.com`.
- Explorer: `https://<instance>/explorer/` (LoopBack). Swagger JSON: `/explorer/swagger.json`.
- Token: generated in *Profile > Admin > Users & Tokens > API Tokens* (or *My Settings > API
  Tokens*); shown once; expires after one year; needs administrator, analyst or external-analyst access.
- The official module sends the token two ways, both accepted by LoopBack:
  - reads: `?access_token=<token>` query parameter;
  - writes: `Authorization: <token>` header (raw token, no `Bearer`).
  This server always uses the **`Authorization` header** so the token never appears in URLs or logs.

## Filtering and paging (LoopBack 3)

- `GET /api/<Model>?filter=<json>` where filter = `{ where, limit, skip, order, fields, include }`.
- `GET /api/<Model>/count?where=<json>` returns `{ "count": n }`.
- `GET /api/<Model>/<id>` for one object (ids are GUIDs; file reps are SHA1).
- The module caps `limit` at **1000** ("1000 is max supported by Infocyte API") and orders by `id`.
- Where operators: `eq` (implicit), `neq`, `gt`, `gte`, `lt`, `lte`, `between`, `inq`, `nin`,
  `like`, `nlike`, `ilike`, `nilike`, `regexp`, `and`, `or`.

## Verified endpoints used by tools

| Model / path | Method | Source | Notes |
| --- | --- | --- | --- |
| `Version` | GET | `Set-ICToken` connection test | |
| `Agents`, `Agents/{id}`, `Agents/count` | GET | `Get-ICAgent` | where: `hostname`, `ipstring`, `authorized`, `active` |
| `Alerts`, `Alerts/{id}`, `Alerts/count` | GET | `Get-ICAlert` | time field `createdOn`; default `archived=false` |
| `Alertsarchive` | GET | `Get-ICAlert` | alerts older than 30 days |
| `AlertDetails` | GET | Devo collector, infocyteapiquery tests | joined alert view |
| `targets`, `targets/{id}` | GET | `Get-ICTargetGroup` | target groups |
| `Addresses` | GET | `Get-ICAddress` | where `targetId`, `hostname`, `ipstring`, `accessible` |
| `scans`, `scans/{id}` | GET | `Get-ICScan` | where `targetId` |
| `usertasks`, `usertasks/{id}` | GET | `Get-ICTask` | `status` (`Active`...), `type`, `endedOn`, `archived` |
| `userTaskItems` | GET | `Get-ICTaskItems` | where `userTaskId` |
| `jobs` | GET | `Get-ICJob` | where `state` |
| `useractivities` | GET | `Get-ICAuditLog` | audit log |
| `rules`, `rules/{id}` | GET | `Get-ICRule` | |
| `extensions`, `extensions/{id}` | GET | `Get-ICExtension` | where `name` |
| `ActionTypes` | GET | Datto EDR explorer help page | |
| `targets/scan` | POST | `Invoke-ICScanTarget` / `Invoke-ICResponse` | body `{ target, targetGroup:{id}, options }`, returns `{ scanTaskId }` |

Response extensions used for isolation: `Host Isolation` and `Host Isolation Restore`
(XSOAR `infocyte-isolate-host` / `infocyte-restore-host`).

## Resolved at runtime (not in any public client)

Organizations and Locations were added to Datto EDR in October 2023, and Integrations are
configured in the UI. No public client calls them, so the server does not hard-code their
paths. `datto_edr_organizations_*`, `datto_edr_locations_*` and `datto_edr_integrations_list`
read `/explorer/swagger.json` from the instance and use the first model that exists from a
short candidate list (for example `Organizations`, `Organization`). If none exists, the tool
returns the related model names the instance does expose.

## Not implemented (no verified endpoint)

- Closing / archiving an alert (the module never writes to `Alerts`).
- Native (non-extension) isolation endpoint added with the "Isolated" agent status.
- Agent uninstall (`POST agents/uninstall`) is verified but deliberately left out: it is
  irreversible and was not requested.
