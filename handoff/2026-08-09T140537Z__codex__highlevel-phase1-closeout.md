# HighLevel Phase 1 implementation closeout

Timestamp: 2026-08-09T14:05:37Z

Owner: Codex

Repository: `chrishowardtx/GoHighLevel-MCP`

Durable checkout: `/Users/cjh/Projects/tools/ghl-mcp-owner`

Closeout branch: `codex/ghl-phase1-closeout-20260809`

Integrated main at verification start: `6176588dd1e085c23102730ed75188cd91ce6bd5`

## WORKING NOW

### Durable four-profile MCP

- The owner-controlled fork `chrishowardtx/GoHighLevel-MCP` is the writable authority. Pull requests
  2 through 13 are merged into `main`; the original agency feature is integrated as pull request 1.
- All four user-scope commands now launch from
  `/Users/cjh/Projects/tools/ghl-mcp-owner/launcher-profile.sh`:
  `ghl-agency`, `ghl-restoreradar`, `ghl-hattie`, and `ghl-nowlanded`.
- The old clean worktree at
  `/Users/cjh/Projects/_worktrees/ghl-mcp/ghl-mcp--agency-server--20260808` is retained as a rollback
  reference. The dirty canonical checkout at `/Users/cjh/Projects/tools/ghl-mcp` was not edited,
  reset, cleaned, or overwritten.
- Credentials remain macOS Keychain-backed. No credential value was printed, copied, or persisted.
- The base URL is pinned to `https://services.leadconnectorhq.com`; cross-profile credential and
  scope environment variables are cleared before launch.
- Startup reads and verifies the hard-coded expected company and location identity, and fails closed
  on a company, token, or location mismatch.
- Agency mode is always read-only and exposes six inventory tools for locations, one location,
  company, users, snapshots, and consolidated capability reporting. Company, location, and user reads
  are supported; snapshots remain a clearly reported unsupported capability with HTTP 403.
- Each location profile exposes 107 allowlisted read tools by default. Mutation tools are hidden and
  blocked locally unless the launcher is explicitly invoked with `--allow-mutations`. Cross-company
  and cross-location arguments remain blocked even in opt-in mode.
- `getSurveySubmissions` uses the current official contract: `GET /surveys/submissions`, required
  `locationId` query, and its endpoint-specific `Version: v3` header.

### Cross-account credential boundaries

- NowLanded pull request 1 merged as `e38d812a`; documentation closeout pull request 2 merged as
  `d5ff4548`. The three runtime paths now require an explicit credential-and-location pair:
  - commercial intake: `GHL_PIT_NOWLANDED` with the NowLanded location;
  - Hattie demo booking: `GHL_HATTIE_DEMO_PIT` with the Hattie location.
- Hattie pull request 1 merged as `2f897bcd`; documentation closeout pull request 2 merged as
  `6ee3f03c`. Hattie intake now requires `GHL_HATTIE_PIT` with the Hattie location.
- All four affected runtime files fail closed when either member of the named pair is absent. The
  ownership boundary remains: NowLanded owns sales/commercial intake; Hattie owns product delivery.
- Focused NowLanded tests passed 14/14 plus syntax and diff checks. Hattie's credential-isolation and
  calendar checks passed. No application deployment was performed.

### RestoreRadar additive schema

- No HighLevel App Test/sandbox location was discoverable through the current agency inventory.
  The authorized fallback was used: additive, namespaced configuration only in RestoreRadar location
  `a7Caoa2IgRnZOazJLyAm`.
- The live schema is 68 exact resources with zero planned creates or collisions on repeated dry-run:
  - two `RR |` pipelines;
  - seven contact fields;
  - twenty-eight opportunity fields;
  - one `RR Lead Assignment` custom object, its folder, and eighteen fields;
  - one business field folder and nine business fields;
  - one homeowner-to-assignment association.
- `RR | Homeowner Requests` has the exact six stages: Recorded, Validating, Routing Ready, Provider
  Engaged, Service Scheduled, Outcome Pending.
- `RR | Provider Sales` has the exact eleven stages: Listed, Contacted, Claim Submitted,
  Verification, Claimed, Featured Interest, Checkout Created, Payment Confirmed, Manual Activation,
  Active, Churned.
- Assignment state options are Queued, Sent, Delivered, Acknowledged, Contacted, Accepted, Declined,
  and Expired.
- Projection fields cover stable external IDs, TEST/PRODUCTION markers, consent timestamp/version,
  service/city/ZIP/urgency, explicit attribution and UTM/referrer/landing/click-ID/form-version data,
  source-event/projection versions, Resend references, and Stripe references.
- The manifest and guard reject IP, user-agent, and raw homeowner narrative projection.
- The pre-existing generic `Marketing Pipeline` remains intact. No update or delete endpoint is
  permitted by the schema tool.
- A fresh GET-only communication inventory returned zero workflows, zero surveys, zero survey
  submissions, zero active campaign schedules, and zero email-builder records. No non-GET request
  was observed.

### Unmistakable TEST graph and replay proof

- TEST suffix `20260809T140115Z` applied successfully with exactly seven accepted and completed
  creates: two DND contacts with no email or phone, one provider business, one homeowner opportunity,
  one provider-sales opportunity, one queued assignment, and one homeowner-to-assignment relation.
- The exact same suffix was replayed. The replay returned `APPLIED`, read every graph component back,
  and reported 68 existing schema resources, zero planned creates, zero accepted creates, zero
  completed creates, and zero collisions.
- Both apply and replay reported zero updates, deletes, communications, workflow writes, and snapshot
  loads. They also reported no credentials, projected IP/user-agent, or raw homeowner narrative.
- Local receipts are mode 0600 under `/tmp/rr-ghl-apply.xNOZjg/` and are not repository artifacts:
  `clean-suffix-apply.json`, `clean-suffix-replay.json`, and
  `old-suffix-duplicate-proof.json`.
- A prior TEST-only contract probe exposed and then safely fixed assignment-search ambiguity. Two
  byte-equivalent TEST assignment records remain for suffix `20260809T114603Z`. The merged guard now
  detects them and halts before mutation with zero writes. They were not deleted because deletes are
  explicitly outside this phase.

### Verification

- RestoreRadar schema suite: 124 passed, 0 failed on merged pull request 13 main.
- Focused merged-branch suite: 150 passed, 0 failed.
- Type check, build, shell syntax, diff check, gitleaks scan, and independent contract review passed.
- Full inherited suite: 225 passed, 42 failed. The same three inherited suites account for all 42
  failures: `tests/tools/conversation-tools.test.ts`, `tests/tools/contact-tools.test.ts`, and
  `tests/clients/ghl-api-client.test.ts`. The whole suite is not green and is not represented as green.
- Live identity probes matched company `QrtXvBAldeRz6qcMX1Xt` and the exact profile locations:
  RestoreRadar `a7Caoa2IgRnZOazJLyAm`, Hattie `z8c1C1bHuVV8R3ttsd6o`, and NowLanded
  `Zx79DWMGfKGScgkURSvh`.

## BROKEN NOW

- Agency snapshot inventory is unsupported by the current agency credential and returns HTTP 403.
- The inherited MCP suite still has 42 pre-existing failures.
- Two duplicate, unmistakably TEST-only lead-assignment records from the live contract-discovery run
  remain in RestoreRadar. The current guard sees both and stops before mutation; removal requires a
  separately authorized delete operation.
- Hattie's inherited `package.json`/lockfile drift prevents claiming a clean install or full build.

## NOT PROVEN

- HighLevel sender domains, A2P registration, duplicate-send behavior, DND enforcement during real
  communication, and production test isolation are not proven. Homeowner email/SMS must stay off.
- A dedicated HighLevel sandbox/App Test location is not proven available.
- The campaign/template APIs returned empty collections but did not provide numeric `total` values;
  the zero returned-item counts are exact, while independent numeric-total corroboration is not proven.
- No production homeowner workflow or HighLevel projection consumer exists. The consumer must wait
  for RestoreRadar pull request 139 to integrate its Redis-authoritative persistence/event boundary;
  it must consume the post-persistence outbox and must not browser-dual-write or bypass persistence.
- The NowLanded and Hattie runtime fixes are merged but not deployed.

## Supabase collision boundary

- RestoreRadar pull request 139 remains open and owned by the separate Supabase lane at head
  `c57a12dccf9db1ed8095c958e7e8ab1d560a231b`. Its three GitHub checks are successful, but fresh
  GitHub authority reports `mergeable=false` / `mergeable_state=dirty`; the earlier mergeable handoff
  has drifted and the Supabase lane must resolve the conflict.
- This phase changed none of its 30 files, contracts, tables, functions, secrets, Vercel settings,
  live Supabase state, routing destinations, or Redis authority.
- The coordination partner acknowledged the non-colliding ownership split and reported no planned
  review changes at coordination time. This lane sent the later merge-conflict finding back to that
  partner without editing its branch.

## Official API authority

- Survey submissions: https://marketplace.gohighlevel.com/docs/ghl/surveys/get-surveys-submissions/index.html
- Pipelines: https://marketplace.gohighlevel.com/docs/ghl/opportunities/create-pipeline/index.html
- Contacts: https://marketplace.gohighlevel.com/docs/ghl/contacts/create-contact/
- Opportunities: https://marketplace.gohighlevel.com/docs/ghl/opportunities/create-opportunity/
- Custom objects: https://marketplace.gohighlevel.com/docs/ghl/objects/create-custom-object-schema/
- Object records: https://marketplace.gohighlevel.com/docs/ghl/objects/create-object-record/
- Object search: https://marketplace.gohighlevel.com/docs/ghl/objects/search-object-records/
- Associations and relations: https://marketplace.gohighlevel.com/docs/ghl/associations/create-association/
- Authorization scopes: https://marketplace.gohighlevel.com/docs/Authorization/Scopes/
- Sandbox/App Test accounts: https://marketplace.gohighlevel.com/docs/oauth/SandboxAccount/index.html

## Deployment and file disposition

- MCP implementation, hardening, schema tooling, tests, and contracts are committed, pushed, and
  merged through pull requests 2 through 13. The durable local server was rebuilt and all four local
  profile commands were repointed and verified.
- Cross-account runtime fixes and their repository handoffs are committed, pushed, and merged through
  their repositories' pull-request paths.
- No cloud application deployment is required for the local MCP. The NowLanded and Hattie runtime
  fixes intentionally remain undeployed pending repository-specific environment and release checks.
- The additive HighLevel schema and TEST verification graph are the only live CRM writes. There were
  no sends, deletes, snapshot loads, workflow writes, account merges, production homeowner records,
  live Supabase changes, or VitalRecover work.

## Exact next action

Repair Hattie's inherited lockfile drift and complete its clean install/full build before deploying
either cross-account runtime change. In the Supabase lane, resolve RestoreRadar pull request 139's
current merge conflict, rerun its checks, and integrate it; only after that event boundary is
authoritative should a disabled-by-default HighLevel projection consumer be designed against the
post-persistence outbox. Keep homeowner communications disabled.
