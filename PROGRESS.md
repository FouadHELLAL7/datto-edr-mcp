# Progress

Last updated: 2026-10-29

## Done

- Studied the WYRE-AI reference servers; conventions recorded in `docs/REFERENCE_NOTES.md`.
- Researched the Datto EDR / Infocyte LoopBack API; verified endpoints and sources in
  `docs/DATTO_EDR_API.md`.
- Server mirrors `huntress-mcp`: tsup build (`dist/index.js` stdio, `dist/http.js` HTTP),
  stateless Streamable HTTP on `/mcp`, `/health` + `/healthz`, `AUTH_MODE=gateway` with
  `X-Datto-EDR-URL` / `X-Datto-EDR-API-Token`, Conduit `X-Gateway-S2S`, stderr logging.
- 36 tools in 7 domains (system, agents, alerts, targets, organizations, scans, rules),
  zod input schemas, LoopBack filter/pagination, write tools behind `confirm: true` and
  `DATTO_EDR_READ_ONLY`.
- 84 vitest tests (mocked HTTP); `npm run lint`, `npm run build`, `npm test` pass.
- Dockerfile, docker-compose.yml, manifest.json (validated with `mcpb validate`), server.json,
  glama.json, MCPB pack script, GitHub Actions (`test.yml` incl. Docker smoke tests,
  `release.yml` pushing `ghcr.io/fouadhellal7/datto-edr-mcp`), dependabot.
- Verified locally: HTTP server on 8080 (`/health` OK, 401 without S2S, 401 without EDR
  headers, 36 tools with full gateway headers); MCP Inspector CLI against a mock API
  (tools/list, test_connection, agents search, swagger-resolved organizations, isolation
  preview, 401 message).

## Left / known issues

- Docker is not installed on the build machine, so the image build and container smoke tests
  run only in GitHub Actions (`Test` workflow, `docker` job). Check its result on GitHub.
- Not tested against a live Datto EDR instance. See "What to test against a live instance"
  in the README. Items that depend on the live API:
  - real model names for Organizations / Locations / Integrations (resolved from swagger);
  - `ilike` operator support for `hostname_contains`;
  - `heartbeat` field name for the last-seen filters;
  - the "Host Isolation" / "Host Isolation Restore" extensions on current instances.
- No verified endpoint for closing/archiving alerts or the newer native isolation API.
  Add tools once the instance's swagger shows them.
- GHCR package visibility: after the first `Release` run, set the package to public (or give
  the gateway a pull token) in GitHub > Packages.

## Next step

Run the read-only checks from the README against a real instance with a token, then adjust
candidate model names in `src/domains/organizations.ts` or add typed tools for any endpoint the
swagger exposes that is still missing.
