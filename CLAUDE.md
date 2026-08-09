# ghl-mcp

GoHighLevel MCP server (stdio + http). Wired live as the user-scope MCP server `ghl-mcp-server`,
launched via `launcher.sh`.

## What matters when working here

- **`launcher.sh` is self-locating** (resolves paths from its own directory). It used to hardcode
  `~/ghl-mcp`, which stopped existing in the 2026-06-29 reorg and silently broke the MCP server
  until 2026-08-08. Keep it relative — do not reintroduce an absolute home path.
- After changing `src/`, run `npm run build` — the launcher execs `dist/server.js`, so source edits
  alone change nothing.
- Smoke test without restarting Claude Code:
  `printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' | ./launcher.sh`
- **Credentials:** `.env` (chmod 600, gitignored) plus per-tenant `.env.agency` / `.env.nowlanded`.
  Several `.env.bak.*` copies are on disk. A prior portfolio audit flagged plaintext keys here as a
  rotation risk — do not print them, do not commit them, and do not add new copies.
- `README.md` is upstream's and opens with a pitch for a hosted version. Ignore it; this is the
  local fork that serves the portfolio.
