# AgentCoder

**Control your AI coding agents from anywhere, on any device.**

Monitor Claude Code, Codex, and other AI agents running in tmux sessions on your machine — from your phone, tablet, or another computer. See what they're doing, get plain-English summaries, and send commands.

**Live at:** [agentcoder.space](https://agentcoder.space)

## How it works

```
Your machine                          Any device
┌──────────────┐     FAS Room      ┌──────────────┐
│  tmux        │◄──────────────────│  Web UI      │
│  ├─ claude   │   (WebSocket)     │  Terminal    │
│  ├─ codex    │──────────────────►│  Translation │
│  └─ gemini   │                   │  Commands    │
│              │                   │              │
│  Bridge CLI  │                   │  Phone/iPad  │
└──────────────┘                   └──────────────┘
```

1. **Bridge CLI** runs on your machine, watches tmux sessions
2. **FAS Room** relays data in real-time via WebSocket
3. **Web UI** shows terminal output, agent states, and (optionally) AI summaries

## Features

### Bridge CLI (runs on your machine)

- **TUI dashboard** — live status, session list, activity feed
- **Session picker** — choose which tmux sessions to monitor (↑↓ navigate, space toggle, → expand windows)
- **Smart pane detection** — auto-finds Claude Code panes in multi-window sessions by window name or `✳` title
- **Agent switching** — Tab to cycle between watched agents
- **Login via browser** — `agentcoder login` opens GitHub OAuth, token saved locally
- **Zero dependencies** — TUI uses raw ANSI + readline, no chalk/ink/blessed

### Web UI (works on any device)

- **Terminal view** — raw tmux output with Claude Code syntax highlighting (tool calls, diffs, status symbols)
- **Agent tabs** — switch between multiple watched sessions, each with its own buffer
- **Send commands** — type text and hit Enter to send to the agent's terminal
- **Ctrl+C** — interrupt the agent remotely
- **Voice input** — speak commands on mobile via VoiceTextArea
- **Connection status** — room connected, bridge online, agent state (ready/busy/waiting)
- **Task completion** — detects when agent finishes (busy → ready) and triggers summary
- **Copy-to-clipboard** — setup commands with session ID pre-filled

### AI Translation Layer (optional — requires Anthropic API key)

- **Auto-translate** — new terminal output is summarized in plain English
- **Task completion summaries** — when agent finishes, auto-generate "what happened"
- **Catch-up mode** — "summarize what happened" button for when you return
- **AI compose** — Cmd+Enter rewrites your message into the right terminal command
- **Configurable** — auto-translate on/off, delay (1/3/5/10s) in Settings

### Works without an API key

Everything works without adding any API key:
- Terminal view streams in real-time
- Send commands and Ctrl+C
- Agent state detection (ready/busy/waiting)
- Multi-session monitoring with agent tabs
- Task completion detection

The AI key only adds: translation summaries, AI compose, and auto-summarize on completion.

### Settings / Profile

- User profile (GitHub avatar, handle)
- API key management (Anthropic, OpenAI, Google AI) via FAS key vault
- Preferences (auto-translate, delay) stored per-user
- Sign out

## Quick start

### 1. Sign in
Visit [agentcoder.space](https://agentcoder.space) and sign in with GitHub.

### 2. Start the bridge
```bash
npx github:freeappstore-online/agentcoder login
npx github:freeappstore-online/agentcoder start --session <id>
```

The session ID is shown on the web UI's connect screen.

### 3. Pick sessions
The TUI opens a session picker — select which tmux sessions to monitor.

### 4. Connect the web UI
Enter the same session ID on the web UI and click Connect.

## CLI reference

```
agentcoder login                     Sign in via browser
agentcoder start --session <id>      Start bridge
agentcoder start --session <id> --watch claude,blo
agentcoder status                    Show saved credentials
agentcoder help                      Show usage
```

### TUI keyboard shortcuts

| Key | Action |
|-----|--------|
| Tab | Switch between watched agents |
| w | Open session picker |
| ↑↓ | Navigate picker |
| → | Expand session windows |
| ← | Collapse |
| space | Toggle session/window |
| a | Toggle all |
| enter | Confirm selection |
| q | Quit |

## Architecture

- **Bridge** (`bridge/`) — Node.js CLI, connects to FAS Room via `ws`, polls tmux with `execFileSync`
- **Web UI** (`web/`) — React PWA on `@freeappstore/sdk`, Vite + Tailwind
- **Transport** — FAS Rooms (WebSocket on Cloudflare Durable Objects)
- **Hosting** — R2 via FAS host worker, custom domain `agentcoder.space`
- **Auth** — GitHub OAuth via FAS SDK
- **AI** — Anthropic API via `fas.proxy.fetch()` (user's own key, injected server-side)

## Development

```bash
pnpm install
pnpm dev          # web UI at localhost:5173
pnpm build        # type-check + production build
pnpm build:bridge # bridge CLI

# Tests (39 total)
cd bridge && npx vitest run   # 29 tests
cd web && npx vitest run      # 10 tests
```

## License

MIT
