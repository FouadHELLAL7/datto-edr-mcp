# Datto EDR MCP Server

A Model Context Protocol (MCP) server for **Datto EDR** (formerly Infocyte). It lets AI
assistants search agents, triage alerts, review target groups, organizations and locations,
follow scans and tasks, read rules and extensions, and — only with explicit confirmation —
scan or isolate a host.

It is built, packaged and configured the same way as the WYRE-AI MSP servers
(`autotask-mcp`, `itglue-mcp`, `datto-rmm-mcp`, `huntress-mcp`): same stdio / Streamable HTTP
transports, same `/mcp` and `/health` endpoints on port 8080, same `AUTH_MODE=gateway`
header injection and `X-Gateway-S2S` service-to-service check. See
[docs/REFERENCE_NOTES.md](docs/REFERENCE_NOTES.md).

## Quick Start

```bash
git clone https://github.com/FouadHELLAL7/datto-edr-mcp.git
cd datto-edr-mcp
npm install
npm run build
```

Claude Desktop / Claude Code (stdio):

```json
{
  "mcpServers": {
    "datto-edr": {
      "command": "node",
      "args": ["/path/to/datto-edr-mcp/dist/index.js"],
      "env": {
        "DATTO_EDR_URL": "https://yourcompany.infocyte.com",
        "DATTO_EDR_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

Claude Code CLI:

```bash
claude mcp add datto-edr -e DATTO_EDR_URL=https://yourcompany.infocyte.com -e DATTO_EDR_API_TOKEN=your-api-token -- node /path/to/datto-edr-mcp/dist/index.js
```

Then ask: *"Test the Datto EDR connection"*, *"Which agents haven't checked in for 14 days?"*,
*"Show me today's alerts"*.

## Features

- **36 tools** across 7 domains, all prefixed `datto_edr_`
- **LoopBack filtering**: every list tool takes `where`, `limit`, `skip`, `order`, `fields`
- **Pagination**: default 50, max 1000 (the API's cap), responses include `hasMore` / `nextSkip`
- **API discovery**: `datto_edr_api_models` reads the instance's own `/explorer/swagger.json`
- **Safe writes**: scan / isolate / restore / response tools are marked `⚠ HIGH-IMPACT` with
  `destructiveHint`, do nothing without `confirm: true`, and disappear with `DATTO_EDR_READ_ONLY=true`
- **Errors that explain themselves**: 401 (bad/expired token), 403 (role), 404, 429 (retried with
  `Retry-After` / backoff), timeouts, unreachable host
- **Token hygiene**: sent only in the `Authorization` header, never in URLs, logs or tool output
- **Gateway ready**: stateless Streamable HTTP, per-request credentials, fail-closed S2S auth
- **All logs on stderr**, so stdio JSON-RPC is never corrupted

## Table of Contents

- [Installation](#installation)
- [Getting a Datto EDR API token](#getting-a-datto-edr-api-token)
- [Configuration](#configuration)
- [Gateway mode](#gateway-mode)
- [Tools](#tools)
- [Docker Deployment](#docker-deployment)
- [Development](#development)
- [Testing](#testing)
- [What to test against a live instance](#what-to-test-against-a-live-instance)
- [License](#license)

## Installation

### Option 1: MCPB Bundle (Claude Desktop)

Download `datto-edr-mcp.mcpb` from the latest [release](https://github.com/FouadHELLAL7/datto-edr-mcp/releases)
and open it with Claude Desktop, or build it yourself with `npm run pack:mcpb`. Claude Desktop
asks for the instance URL and token (stored as a sensitive value).

### Option 2: Docker

```bash
docker pull ghcr.io/fouadhellal7/datto-edr-mcp:latest
```

See [Docker Deployment](#docker-deployment).

### Option 3: From Source

```bash
npm install
npm run build
node dist/index.js        # stdio
```

Requires Node.js 20 or later.

## Getting a Datto EDR API token

1. Sign in to Datto EDR.
2. Admins: **Profile > Admin > Users & Tokens > API Tokens**. Other users: **Profile > My Settings > API Tokens**.
3. Click **Create new token**, enter a description, click **Create**.
4. Click the hash to copy it. It is shown **once**; store it in your password manager.

Tokens expire one year after creation and need a user with administrator, analyst or external
analyst access. The instance URL is the address you open in the browser, for example
`https://yourcompany.infocyte.com` (without `/api`). Its API explorer is at
`https://yourcompany.infocyte.com/explorer/`.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `DATTO_EDR_URL` | — | Instance base URL, e.g. `https://yourcompany.infocyte.com` (stdio, or HTTP with `AUTH_MODE=env`) |
| `DATTO_EDR_API_TOKEN` | — | API token (stdio, or HTTP with `AUTH_MODE=env`) |
| `MCP_TRANSPORT` | `stdio` | `stdio` or `http` |
| `AUTH_MODE` | `env` | HTTP credential source: `env` or `gateway` (image and Compose set `gateway`) |
| `CONDUIT_S2S_SECRET` | — | **Required for HTTP.** Shared secret for the `X-Gateway-S2S` header. Generate with `openssl rand -hex 32` |
| `MCP_ALLOW_INSECURE_DEV` | — | `1` starts HTTP without a secret, local only (binds `127.0.0.1`) |
| `MCP_HTTP_PORT` | `8080` | HTTP port |
| `MCP_HTTP_HOST` | `127.0.0.1` | HTTP bind address (image sets `0.0.0.0`) |
| `DATTO_EDR_READ_ONLY` | `false` | `true` hides and blocks all write tools |
| `DATTO_EDR_ALLOWED_HOSTS` | — | Comma-separated host suffixes the instance URL must match, e.g. `.infocyte.com`. Recommended in gateway mode |
| `DATTO_EDR_TIMEOUT_MS` | `30000` | Per-request timeout |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` (always written to stderr) |

## Gateway mode

Add this server to your MCP gateway exactly like the WYRE connectors:

| | Value |
| --- | --- |
| Image | `ghcr.io/fouadhellal7/datto-edr-mcp:<version>` |
| Transport | Streamable HTTP, stateless, JSON responses |
| MCP endpoint | `POST http://<host>:8080/mcp` |
| Health | `GET http://<host>:8080/health` (also `/healthz`), unauthenticated liveness |
| Container env | `AUTH_MODE=gateway`, `CONDUIT_S2S_SECRET=<per-vendor secret>` (others are image defaults) |

Headers on every `/mcp` request:

| Header | Content |
| --- | --- |
| `X-Gateway-S2S` | `t=<unix seconds>,v1=<hex HMAC-SHA256(CONDUIT_S2S_SECRET, "t=<unix seconds>")>` (300 s skew) |
| `X-Datto-EDR-URL` | Tenant's instance URL, e.g. `https://yourcompany.infocyte.com` |
| `X-Datto-EDR-API-Token` | Tenant's API token |

Behaviour, identical to the WYRE servers:

- No/invalid `X-Gateway-S2S` → `401`. Missing `X-Datto-EDR-*` header in gateway mode → `401`,
  with **no fallback** to environment credentials.
- Each request gets a fresh MCP server inside an AsyncLocalStorage credential scope, so tenants
  never share a token.
- The process refuses to start HTTP when `CONDUIT_S2S_SECRET` is empty or a placeholder
  (`changeme`, `secret`, ...), unless `MCP_ALLOW_INSECURE_DEV=1`.

Because the instance URL arrives in a header, set `DATTO_EDR_ALLOWED_HOSTS=.infocyte.com` (or
your own domains) on the container so the server only ever calls Datto EDR hosts.

## Tools

Call `datto_edr_navigate` with a domain for a guided list; every tool is always callable.

| Domain | Tool | What it does | API |
| --- | --- | --- | --- |
| navigation | `datto_edr_navigate` | List the tools of a domain | — |
| navigation | `datto_edr_status` | Credentials configured? read-only? (no API call) | — |
| system | `datto_edr_test_connection` | Live connection/token check, API version | `GET Version` |
| system | `datto_edr_api_models` | List models / show a model's properties and paths | `GET /explorer/swagger.json` |
| system | `datto_edr_raw_request` | Read-only escape hatch (GET only; credential/token models refused) | `GET <path>` |
| system | `datto_edr_audit_log_list` | User activity / audit log | `GET useractivities` |
| agents | `datto_edr_agents_list` | Search agents: hostname (exact/contains), IP, active, authorized, last seen | `GET Agents` |
| agents | `datto_edr_agents_get` | One agent | `GET Agents/{id}` |
| agents | `datto_edr_agents_count` | Count agents with the same filters | `GET Agents/count` |
| alerts | `datto_edr_alerts_list` | Alerts newest first: date range, archived, archive table, `where` for severity/host/etc. | `GET Alerts`, `Alertsarchive` |
| alerts | `datto_edr_alerts_get` | One alert | `GET Alerts/{id}` |
| alerts | `datto_edr_alerts_count` | Count alerts | `GET Alerts/count` |
| alerts | `datto_edr_alert_details_list` | Enriched alert records | `GET AlertDetails` |
| targets | `datto_edr_target_groups_list` / `_get` | Target groups | `GET targets` |
| targets | `datto_edr_addresses_list` | Discovered hosts per target group | `GET Addresses` |
| organizations | `datto_edr_organizations_list` / `_get` | Organizations (tenants) | resolved from swagger |
| organizations | `datto_edr_locations_list` / `_get` | Locations | resolved from swagger |
| organizations | `datto_edr_integrations_list` | Integrations | resolved from swagger |
| scans | `datto_edr_scans_list` / `_get` | Scans | `GET scans` |
| scans | `datto_edr_tasks_list` / `_get` | User tasks (scan/response progress) | `GET usertasks` |
| scans | `datto_edr_task_items_list` | Per-host results of a task | `GET userTaskItems` |
| scans | `datto_edr_jobs_list` | Background jobs | `GET jobs` |
| scans | `datto_edr_scan_host` | ⚠ Scan one host (needs `confirm: true`) | `POST targets/scan` |
| scans | `datto_edr_run_response` | ⚠ Run a response extension on one host | `POST targets/scan` |
| scans | `datto_edr_isolate_host` | ⚠ Isolate a host ("Host Isolation" extension) | `POST targets/scan` |
| scans | `datto_edr_restore_host` | ⚠ Undo isolation ("Host Isolation Restore") | `POST targets/scan` |
| rules | `datto_edr_rules_list` / `_get` | Detection rules | `GET rules` |
| rules | `datto_edr_extensions_list` / `_get` | Collection and response extensions | `GET extensions` |
| rules | `datto_edr_action_types_list` | Action types | `GET ActionTypes` |

Every endpoint was verified against the official InfocyteHUNTAPI PowerShell module, the Datto
EDR help, or other public clients ([docs/DATTO_EDR_API.md](docs/DATTO_EDR_API.md)).
Organizations, Locations and Integrations have no public client, so those tools look the model
up in the instance's swagger at call time instead of guessing a path. Closing alerts is not
implemented because no verified endpoint exists.

**Filtering example** (alerts from one day with high severity, only some fields):

```json
{
  "start_time": "2026-10-28T00:00:00Z",
  "end_time": "2026-10-29T00:00:00Z",
  "where": { "severity": "high" },
  "fields": ["id", "name", "hostname", "createdOn"],
  "limit": 100
}
```

Field names differ between instance versions; check them with
`datto_edr_api_models {"model": "Alerts"}`.

## Docker Deployment

```bash
cp .env.example .env
# Set CONDUIT_S2S_SECRET. Leave it empty in the example; never commit a real value.
docker compose up -d
curl http://localhost:8080/health
```

HTTP, gateway mode (what the gateway runs):

```bash
docker run -d -p 127.0.0.1:8080:8080 -e CONDUIT_S2S_SECRET=$(openssl rand -hex 32) -e DATTO_EDR_ALLOWED_HOSTS=.infocyte.com ghcr.io/fouadhellal7/datto-edr-mcp:latest
```

HTTP, single tenant (credentials from env):

```bash
docker run -d -p 127.0.0.1:8080:8080 -e AUTH_MODE=env -e CONDUIT_S2S_SECRET=... -e DATTO_EDR_URL=https://yourcompany.infocyte.com -e DATTO_EDR_API_TOKEN=... ghcr.io/fouadhellal7/datto-edr-mcp:latest
```

stdio (for Claude Desktop through Docker):

```json
{
  "mcpServers": {
    "datto-edr": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "MCP_TRANSPORT=stdio", "-e", "DATTO_EDR_URL", "-e", "DATTO_EDR_API_TOKEN", "ghcr.io/fouadhellal7/datto-edr-mcp:latest"],
      "env": {
        "DATTO_EDR_URL": "https://yourcompany.infocyte.com",
        "DATTO_EDR_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

## Development

```bash
npm install
npm run dev          # tsup --watch
npm run lint         # tsc --noEmit + destructive-warning lint
npm run build
npm start            # stdio
# HTTP refuses to start until CONDUIT_S2S_SECRET is set
MCP_TRANSPORT=http CONDUIT_S2S_SECRET=$(openssl rand -hex 32) node dist/http.js
# Local HTTP only, without a service-to-service secret (always binds 127.0.0.1)
MCP_TRANSPORT=http MCP_ALLOW_INSECURE_DEV=1 node dist/http.js
```

MCP Inspector:

```bash
npx @modelcontextprotocol/inspector -e DATTO_EDR_URL=https://yourcompany.infocyte.com -e DATTO_EDR_API_TOKEN=your-api-token node dist/index.js
```

`DATTO_EDR_ALLOW_HTTP=1` allows an `http://` instance URL, for local mock APIs only.

## Testing

```bash
npm test
npm run test:coverage
```

The suite (vitest, mocked `fetch`) covers the client (auth header, retries, error mapping,
token redaction, URL validation), every domain tool's request and filter, the write-tool
confirm and read-only gates, MCP tool listing, and the HTTP transport (health, S2S, gateway
header isolation). CI also builds the Docker image and smoke-tests it in HTTP and stdio mode.

## What to test against a live instance

No real Datto EDR token was available while building this server. Run these with a token
(read-only first):

1. `datto_edr_test_connection` — token and URL work.
2. `datto_edr_api_models` — swagger is readable; note the real names of the Organizations,
   Locations and Integrations models and the Agent/Alert property names.
3. `datto_edr_agents_list` with `hostname_contains` — confirms the `ilike` operator
   (if it errors, use `where: {"hostname": {"like": "%name%"}}`), and `last_seen_before`
   confirms the `heartbeat` field.
4. `datto_edr_alerts_list` with a date range, then `datto_edr_alert_details_list`.
5. `datto_edr_organizations_list`, `datto_edr_locations_list`, `datto_edr_integrations_list`.
6. `datto_edr_extensions_list {"name":"Host Isolation"}` — the isolation extension exists.
7. Only on a test machine: `datto_edr_isolate_host` with `confirm: true`, follow it with
   `datto_edr_tasks_get`, then `datto_edr_restore_host`.

## License

Apache-2.0
