# AgentCoder

AI agent interpreter — monitor and control Claude Code, Codex, and other AI agents running in tmux from any device.

- **Live:** `agentcoder.space` (custom domain) + `agentcoder.freeappstore.online`
- **Dev:** `pnpm install && pnpm dev`
- **Build:** `pnpm build` (web) / `pnpm build:bridge` (CLI)
- **Deploy:** `git push origin main` (auto-deploys to R2 via GitHub Actions)
- **Tests:** 44 total — `cd bridge && npx vitest run` (32) + `cd web && npx vitest run` (12)

## Architecture

```
bridge/          Node.js CLI — TUI dashboard, tmux polling, FAS Room WebSocket
├── src/cli.ts       CLI entry (login, start, status)
├── src/tui.ts       ANSI TUI with session/window picker
├── src/index.ts     Bridge class (events, watchlist, target overrides)
├── src/tmux.ts      Smart pane detection, state detection, screen capture
├── src/room-client.ts  WebSocket client for FAS Rooms
└── dist/            Pre-built (committed for npx compatibility)

web/             React PWA — terminal view, agent tabs, translation, compose
├── src/App.tsx          Main app (ConnectBridge, StatusBar, TranslationPanel, SessionView)
├── src/terminal-view.tsx  Raw output with Claude Code syntax highlighting
├── src/use-bridge.ts      Room message handling, per-agent buffers
├── src/use-translator.ts  Anthropic API via fas.proxy.fetch
├── src/profile-page.tsx   Settings (keys, prefs, profile)
├── src/parse-translation.ts  JSON extraction from AI responses
└── src/types.ts           Shared types
```

## SDK modules used

- `fas.auth` — GitHub OAuth (SSO)
- `fas.rooms` — WebSocket relay between bridge and web UI
- `fas.proxy` — Anthropic API calls with user key injection
- `fas.keys` — user API key vault (Anthropic, OpenAI, Google AI)
- `fas.kv` — user preferences (auto-translate, delay)

## Key design decisions

- **Bridge sends full screen snapshots** (not diffs) — web UI replaces per-agent
- **Smart pane detection:** `tmux list-panes -s` finds Claude by window name or `✳` in pane title
- **CLI login:** localhost HTTP server → browser redirect (not fetch — Chrome PNA blocks fetch to localhost)
- **TUI:** zero deps (raw ANSI + readline), no chalk/ink
- **API key optional:** terminal view, commands, state detection all work without key. Key only enables AI summaries + compose.
- **Task completion:** detects busy→ready transition, auto-summarizes if key available
- **Per-agent buffers:** each agent has its own output buffer, switchable via tabs (web) or Tab key (TUI)
- **Custom domain:** `agentcoder.space` served via FAS host worker (D1 route: slug=agentcoder, zone=space)

## Distribution

```bash
npx github:freeappstore-online/agentcoder login
npx github:freeappstore-online/agentcoder start --session <id>
```

`bridge/dist/` is committed to the repo so npx works without a build step. `ws` is in root `package.json` dependencies so npm installs it.

## Config & secrets

- No `.env.production` (compliance check fails)
- User API keys: managed via `fas.keys.manage()` → FAS platform key vault page
- User prefs: stored in `fas.kv` under key `prefs`
- CLI credentials: `~/.agentcoder/credentials.json` (token + sessionId)

## Infra

- FAS host worker: routes for `agentcoder.space/*` and `www.agentcoder.space/*` in wrangler.toml
- FAS backend: `agentcoder.space` in origins.ts allowlist (CORS + return_to)
- D1 routes table: row (slug=agentcoder, zone=space, r2_prefix=apps/agentcoder)
- GitHub Actions: deploy.yml → R2, compliance.yml → checks

## MCP

```json
{
  "mcpServers": {
    "freeappstore": {
      "command": "npx",
      "args": ["mcp-remote", "https://mcp.freeappstore.online/mcp"]
    }
  }
}
```
