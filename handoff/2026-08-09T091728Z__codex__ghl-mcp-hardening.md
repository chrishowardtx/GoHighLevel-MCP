# GHL MCP hardening handoff

Timestamp: 2026-08-09T09:17:28Z

Owner: Codex

Repository: `chrishowardtx/GoHighLevel-MCP`

Branch: `codex/ghl-mcp-hardening-20260809`

Durable checkout: `/Users/cjh/Projects/tools/ghl-mcp-owner`

Implementation commit: `e938bba3db0281fc1fb58553062f8035142becbc`

Endpoint-status follow-up: `013021ace2672ead513bc9954b63237d3cf88c2e`

Pull request: https://github.com/chrishowardtx/GoHighLevel-MCP/pull/2

## WORKING NOW

- The owner-controlled GitHub fork is the writable authority. The dirty checkout at
  `/Users/cjh/Projects/tools/ghl-mcp` was not edited.
- The four currently connected profiles still launch from the old clean worktree. It remains intact;
  no live profile command has been repointed yet.
- `getSurveySubmissions` now follows the official current contract:
  `GET /surveys/submissions`, required `locationId` query, endpoint `Version: v3`.
- The new endpoint reads preserve the original shared-interceptor status. A live snapshots denial is
  reported as HTTP 403 rather than being incorrectly wrapped as HTTP 500.
- Agency mode remains locally read-only and exposes exactly six tools:
  `search_locations`, `get_location`, `agency_get_company`, `agency_search_users`,
  `agency_get_snapshots`, and `agency_capability_report`.
- Location profiles expose 107 explicitly allowlisted read tools by default. Mutation tools are hidden
  and locally rejected before dispatch. The only opt-in is the explicit launcher argument
  `--allow-mutations`; cross-location and cross-company arguments remain blocked even then.
- Every profile pins `https://services.leadconnectorhq.com`, clears cross-profile credential and scope
  variables, and sets hard-coded expected company/location identity values. Startup reads the returned
  company/location resource and fails closed on mismatch.
- No credential value was printed, copied, or persisted.

## Official API authority checked

- Survey submissions: https://marketplace.gohighlevel.com/docs/ghl/surveys/get-surveys-submissions/
- Company: https://marketplace.gohighlevel.com/docs/ghl/companies/get-company/
- Users search: https://marketplace.gohighlevel.com/docs/ghl/users/search-users/
- Snapshots: https://marketplace.gohighlevel.com/docs/ghl/snapshots/get-custom-snapshots/
- Scope matrix: https://marketplace.gohighlevel.com/docs/Authorization/Scopes/

The current documentation labels these endpoint contracts `v3`. Company, users, locations, and
snapshots are implemented as harmless GET reads with endpoint-specific v3 headers where applicable.

## Verification receipt

- Focused guardrail tests: 25 passed, 0 failed.
- Type check: passed (`npm run lint`).
- Build: passed (`npm run build`).
- Shell syntax: passed (`bash -n launcher-profile.sh`).
- Full inherited suite: 100 passed, 42 failed, 142 total. The failure count is unchanged from the
  pre-existing baseline (82 passed, 42 failed, 124 total); the 18 newly added tests account for the
  increased pass count. The inherited stale client mocks and old tool-count assertions remain red.
- Live harmless-read MCP probes against the durable checkout:
  - agency: startup identity matched; 6 tools; company supported; locations supported (3 visible);
    users supported (1 visible); snapshots unsupported with the original HTTP 403 preserved.
  - NowLanded: startup location/company identity matched; 107 tools; mutation call blocked locally.
  - RestoreRadar: startup location/company identity matched; 107 tools; mutation call blocked locally.
  - Hattie: startup location/company identity matched; 107 tools; mutation call blocked locally.
  - NowLanded survey-submission probe: `GET /surveys/submissions` returned HTTP 200 with zero records;
    no submission contents were printed.

## BROKEN NOW

- The agency token receives HTTP 403 `Forbidden resource` from the official `GET /snapshots/`
  endpoint. The capability report records snapshots as unsupported without failing the other reads.
- The inherited suite still has the same 42 pre-existing failures; the whole suite is not green.

## NOT PROVEN

- The four user-scope MCP commands have not yet been repointed to this durable checkout.
- A fresh Claude/Codex process has not yet been verified against the repointed commands.
- Snapshot inventory cannot be claimed working with the current agency token/scope.
- Mutation-enabled mode was unit-tested only. It was deliberately not activated or exercised live.

## Safety / deployment disposition

- No sends, deletes, snapshot loads, workflow changes, account merges, CRM writes, or VitalRecover work
  occurred.
- No production deployment is required; this is a local MCP server and launcher change. Local profile
  cutover is intentionally pending review.
- Keep `/Users/cjh/Projects/_worktrees/ghl-mcp/ghl-mcp--agency-server--20260808` until all four commands
  are repointed and reverified from the durable checkout.

## Exact next action

Review and merge pull request 2 into the owner fork. After merge, rebuild the durable checkout,
repoint all four user-scope MCP commands to
`/Users/cjh/Projects/tools/ghl-mcp-owner/launcher-profile.sh`, then verify agency tool/capability output
and all three exact location identities before retiring the old worktree.
