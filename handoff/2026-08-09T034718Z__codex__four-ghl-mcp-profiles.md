# GHL four-profile MCP handoff

Timestamp: 2026-08-09T03:47:18Z

Owner: Codex

Branch: `codex/ghl-agency-server-20260808`

Worktree: `/Users/cjh/Projects/_worktrees/ghl-mcp/ghl-mcp--agency-server--20260808`

## Working now

- Claude user configuration has exactly four named GHL MCP entries, all reporting connected:
  - `ghl-agency`
  - `ghl-nowlanded`
  - `ghl-restoreradar`
  - `ghl-hattie`
- The old duplicate `ghl-mcp-server` entry was removed only after all four replacements passed health checks.
- The agency server exposes exactly two verified read-only tools: `search_locations` and `get_location`.
- Agency mode rejects all other tools locally before API dispatch.
- Each profile reads only its dedicated macOS Keychain service. No credential is stored in the repository or Claude configuration.
- Both launchers and agency configuration pin `https://services.leadconnectorhq.com`; inherited environment state cannot redirect a Keychain-backed token.

## Credential mapping

- `ghl-agency` -> `GHL_AGENCY_API_KEY`
- `ghl-nowlanded` -> `GHL_API_KEY`
- `ghl-restoreradar` -> `GHL_RESTORERADAR_API_KEY`
- `ghl-hattie` -> `GHL_HATTIE_API_KEY`

Do not print, copy into files, or replace these values. The Keychain entries are the authority.

## Source change

- Commit `337a882` (`feat: add isolated GHL agency MCP profile`)
- Added `src/agency-mode.ts`, `src/agency-server.ts`, `launcher-profile.sh`, and focused tests.

## Verification receipt

- Type check/lint: passed.
- Build: passed.
- Focused agency tests: 7 passed, 0 failed.
- Live stdio MCP handshakes: agency 2 tools; each location profile 253 tools.
- Hostile inherited `GHL_BASE_URL` smoke: all four profiles still connected through the pinned official origin.
- Claude MCP health after cleanup: all four named entries connected; obsolete entry absent.
- Full inherited suite remains red: 42 failed, 82 passed, 124 total. The same 42 stale mock/tool-count failures existed before this change; the new suite passes.

## Integration boundary

- The canonical checkout at `/Users/cjh/Projects/tools/ghl-mcp` was already dirty with unrelated work and was not edited.
- Upstream `mastanley13/GoHighLevel-MCP` is read-only for this account, so the local commit was not pushed.
- Claude currently launches the four profiles from this isolated worktree. Do not remove the worktree until the commit is integrated somewhere durable and the four MCP commands are repointed and reverified.
- An already-open Claude session may need MCP reconnect/restart to display the new server names; no machine restart is required.

## Exact next action

Integrate commit `337a882` into a writable GHL MCP repository or fork, rebuild, repoint the four Claude user MCP commands to that durable launcher, confirm all four show connected, and only then remove this worktree.
