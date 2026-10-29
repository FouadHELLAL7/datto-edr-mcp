# Reference notes: WYRE-AI MCP servers

Studied (shallow clones, October 2026): `WYRE-AI/autotask-mcp`, `WYRE-AI/itglue-mcp`,
`WYRE-AI/datto-rmm-mcp`, `WYRE-AI/huntress-mcp`, `WYRE-AI/msp-claude-plugins`.

`huntress-mcp` is the closest match (security product, domain-based tool layout, thin
SDK-backed handlers) and is the template this repo mirrors file for file. Where the other
repos differ, the difference is noted.

## Project layout

| Item | Reference convention | This repo |
| --- | --- | --- |
| Source | `src/` with `index.ts` (stdio), `http.ts` (HTTP + stdio fallback), `server.ts` (`createServer()`), `s2s-verify.ts` | same |
| Domains | `src/domains/<domain>.ts`, each exporting a `DomainHandler` (`getTools()` + `handleCall()`), lazy-loaded through `src/domains/index.ts`; `src/domains/navigation.ts` holds `DOMAINS` and the navigate/status tools | same |
| Utils | `src/utils/client.ts` (AsyncLocalStorage credentials + client factory), `src/utils/logger.ts`, `src/utils/types.ts` | same, plus `src/utils/filter.ts`, `src/utils/swagger.ts`, `src/utils/tooling.ts` |
| Tests | `src/__tests__/*.test.ts`, `src/__tests__/domains/*.test.ts`, vitest | same |
| Build output | `dist/index.js` (stdio) and `dist/http.js` (HTTP entry), ESM, `#!/usr/bin/env node` banner, built by **tsup** (`tsup.config.ts`, target `node22`) | same |
| Node | `engines.node >=20`, Docker `node:26-alpine`, CI matrix 20.x/22.x | same |
| TypeScript | `target ES2022`, `module ESNext`, `moduleResolution bundler`, `strict`, `rootDir src`, `outDir dist` | same |
| dist in git | **not committed** (`.gitignore` has `dist/`) | same |

autotask-mcp / itglue-mcp / datto-rmm-mcp predate the domain refactor: one large
`mcp-server.ts` / `tool.definitions.ts`, built with plain `tsc`, entry `dist/index.js`.
They also ship optional MCP Apps UI cards (`ui/`, `vite.config.ts`, `scripts/embed-ui.mjs`)
and Cloudflare Worker files (`src/worker.ts`, `wrangler.json`). Neither is needed for a
gateway connector, so this repo leaves them out.

## package.json scripts (huntress-mcp)

```
build        tsup                (prebuild: npm run clean)
dev          tsup --watch
start        node dist/index.js
start:http   MCP_TRANSPORT=http node dist/http.js
test         vitest run
test:watch   vitest
test:coverage vitest run --coverage
lint         tsc --noEmit
clean        rm -rf dist
prepare      npm run build
pack:mcpb    node scripts/pack-mcpb.cjs
validate:mcpb mcpb validate manifest.json
```

CI additionally runs `node scripts/lint-destructive-warnings.mjs src`, which fails when a
tool whose name contains a destructive verb lacks both a `⚠ DESTRUCTIVE` / `⚠ HIGH-IMPACT`
description prefix and `annotations.destructiveHint: true`.

## Transport

- `MCP_TRANSPORT=stdio` (default) or `http`.
- `dist/http.js` starts HTTP when `MCP_TRANSPORT=http`, otherwise imports `./index.js` (stdio).
- HTTP uses `node:http` + `StreamableHTTPServerTransport`, **stateless**
  (`sessionIdGenerator: undefined`, `enableJsonResponse: true`), a fresh `Server` per request.
  The stateless invariant is security-critical: per-request credentials live in an
  AsyncLocalStorage scope that must not outlive the request.
- Port `MCP_HTTP_PORT` (default `8080`); bind `MCP_HTTP_HOST` (default `127.0.0.1`; image sets `0.0.0.0`).
- Endpoints: `POST /mcp`; `GET /health` and `/healthz` (liveness only, unauthenticated, never
  reads credentials, returns `{status:'ok', transport:'http', mode:'gateway'|'standalone', timestamp}`);
  anything else returns 404 JSON listing the endpoints.

## Gateway service-to-service auth (Conduit)

- `CONDUIT_S2S_SECRET` is **required** to start HTTP. Empty → log error and `exit(1)`, unless
  `MCP_ALLOW_INSECURE_DEV=1`, which skips the check and forces a `127.0.0.1` bind.
- Known placeholder values (`changeme`, `secret`, `your-s2s-secret`, ...) are always refused.
- Every `/mcp` request must carry `X-Gateway-S2S: t=<unix>,v1=<hex hmac-sha256(secret, "t=<unix>")>`,
  max 300 s skew, constant-time compare (`src/s2s-verify.ts`, a verbatim port of the gateway's).
- The secret is never logged.

## Auth modes

- `AUTH_MODE=env` (default for the process): credentials from env vars
  (`HUNTRESS_API_KEY` / `HUNTRESS_API_SECRET`, `DATTO_API_KEY` / `DATTO_API_SECRET` / `DATTO_PLATFORM`).
- `AUTH_MODE=gateway`: credentials **must** arrive on every `/mcp` request as headers; missing →
  401 JSON, **no env fallback** (CWE-306). The Dockerfile and docker-compose set `gateway`.
- Header naming pattern: `X-<Vendor>-<Credential-Part>`:
  - Huntress: `X-Huntress-Api-Key`, `X-Huntress-Api-Secret`
  - Datto RMM: `X-Datto-API-Key`, `X-Datto-API-Secret`, `X-Datto-Platform` (non-secret, optional)
  - IT Glue: `X-ITGlue-API-Key`, `X-ITGlue-Region`, `X-ITGlue-Base-URL`
- **Adapted for Datto EDR:** `X-Datto-EDR-URL` (instance base URL, like `X-ITGlue-Base-URL`) and
  `X-Datto-EDR-API-Token`. Env equivalents `DATTO_EDR_URL`, `DATTO_EDR_API_TOKEN`.
- Credential scoping: `runWithCredentials(creds, fn)` wraps request handling in an
  `AsyncLocalStorage`; `getCredentials()` prefers the scoped value, else env. A new API client is
  built per call, never a process-global singleton.

## Logging

`src/utils/logger.ts`: `LOG_LEVEL` = debug|info|warn|error (default info); **every** level goes
through `console.error` (stderr) so stdio JSON-RPC on stdout is never corrupted. Lines are
`<ISO timestamp> [LEVEL] message {json context}`. Secrets are never logged.

## Tool design

- Names: `<vendor>_<domain>_<action>` (snake_case), e.g. `huntress_agents_list`,
  `huntress_incidents_get`. List tools take filters + pagination; get tools take `id`.
- Navigation: `<vendor>_navigate` (stateless discovery: returns the tools of a domain; all tools
  are always listed and callable) and `<vendor>_status` (credential presence + domain list).
- autotask-mcp adds `autotask_router` (intent routing) and `autotask_raw_request` (escape hatch,
  "Prefer typed tools", path relative to the API base, auth added automatically).
- Input schemas: huntress writes JSON Schema by hand; autotask depends on `zod`. This repo writes
  schemas in zod (v4) and emits JSON Schema with `z.toJSONSchema`, and validates arguments with the
  same zod schema before any API call.
- Results: `{ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }`; errors return
  `isError: true` with `Error: <message>` (handler exceptions are caught in `server.ts`).
  `sanitizeResult()` coerces non-string text blocks.
- Read vs write: write/destructive tools carry `⚠ HIGH-IMPACT` / `⚠ DESTRUCTIVE` description
  prefixes and `annotations: { destructiveHint: true }`; reads use `readOnlyHint: true`.
  datto-rmm/itglue add elicitation confirmation for destructive calls; this repo requires an
  explicit `confirm: true` argument instead (works on every client) and supports
  `DATTO_EDR_READ_ONLY=true` to hide write tools entirely.

## Packaging and release

- **Dockerfile**: multi-stage `node:26-alpine` builder (`npm ci --ignore-scripts`, build,
  `npm prune --omit=dev`) → production stage with `apk -U upgrade`, non-root user (uid 1001),
  npm/npx removed, `EXPOSE 8080`, `HEALTHCHECK wget http://localhost:8080/health`,
  `ENV MCP_TRANSPORT=http MCP_HTTP_PORT=8080 MCP_HTTP_HOST=0.0.0.0 AUTH_MODE=gateway`,
  `CMD ["node","dist/http.js"]`, OCI labels incl. `io.modelcontextprotocol.server.name`.
  WYRE builds need a BuildKit `npmrc` secret for their private `@wyre-technology/*` SDKs; this
  repo has no private dependencies, so no secret mount is needed.
- **docker-compose.yml**: gateway service on `127.0.0.1:8080:8080`, `AUTH_MODE=gateway`,
  `CONDUIT_S2S_SECRET=${CONDUIT_S2S_SECRET:?set CONDUIT_S2S_SECRET}`, healthcheck, resource limits,
  optional `dev` profile.
- **Image**: `ghcr.io/<org>/<name>-mcp:<version>` → here `ghcr.io/fouadhellal7/datto-edr-mcp`.
- **GitHub Actions**: `test.yml` / `ci.yml` (lint, destructive-warnings lint, build, test,
  docker build), `release.yml` (WYRE calls a private reusable workflow: semantic-release → Docker
  push → MCP Registry; this repo inlines an equivalent build-and-push to GHCR),
  `mcp-assert.yml` (WYRE-internal reusable, not copied), `claude.yml` / `add-to-project.yml`
  (org-specific, not copied). `dependabot.yml` copied.
- **MCPB bundle**: `manifest.json` (manifest_version 0.3, `server.entry_point dist/index.js`,
  `user_config` for credentials, `sensitive: true` for secrets) + `scripts/pack-mcpb.cjs`
  + `.mcpbignore`.
- **Registry metadata**: `server.json` (schema 2025-12-11, OCI package, env var list) and
  `glama.json`.
- **Deploy templates**: `.do/deploy.template.yaml` (DigitalOcean App Platform) in the older repos;
  Cloudflare `wrangler.json` + `src/worker.ts` in itglue/datto-rmm. Not copied (Cloudflare needs a
  Worker rewrite; the gateway runs the Docker image).
- `.releaserc.json` semantic-release config, `.npmrc` scoped registries (not needed here).

## README structure (huntress-mcp)

Title + one-liner → Quick Start → Features → Table of Contents → Installation (MCPB, Docker,
From Source) → Configuration (env table, HTTP authentication / gateway headers) → Domains
(tool list) → Docker Deployment → Development → Testing → Contributing → License.
