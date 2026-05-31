#!/usr/bin/env node
import {
  Bridge,
  isTmuxAvailable,
  listSessions,
  listWindows
} from "./chunk-BZ2S3VZE.js";

// src/tui.ts
import readline from "readline";
var ESC = "\x1B[";
var RESET = `${ESC}0m`;
var BOLD = `${ESC}1m`;
var DIM = `${ESC}2m`;
var CYAN = `${ESC}36m`;
var GREEN = `${ESC}32m`;
var YELLOW = `${ESC}33m`;
var RED = `${ESC}31m`;
var BLUE = `${ESC}34m`;
var WHITE = `${ESC}37m`;
var GRAY = `${ESC}90m`;
var INVERSE = `${ESC}7m`;
var CLEAR = `${ESC}2J${ESC}H`;
var HIDE_CURSOR = `${ESC}?25l`;
var SHOW_CURSOR = `${ESC}?25h`;
function c(color, text) {
  return `${color}${text}${RESET}`;
}
var BANNER = [
  "  \u2554\u2550\u2557\u2554\u2550\u2557\u2554\u2550\u2557\u2554\u2557\u2554\u2554\u2566\u2557  \u2554\u2550\u2557\u2554\u2550\u2557\u2554\u2566\u2557\u2554\u2550\u2557\u2566\u2550\u2557",
  "  \u2560\u2550\u2563\u2551 \u2566\u2551\u2563 \u2551\u2551\u2551 \u2551   \u2551  \u2551 \u2551 \u2551\u2551\u2551\u2563 \u2560\u2566\u255D",
  "  \u2569 \u2569\u255A\u2550\u255D\u255A\u2550\u255D\u255D\u255A\u255D \u2569   \u255A\u2550\u255D\u255A\u2550\u255D\u2550\u2569\u255D\u255A\u2550\u255D\u2569\u255A\u2550"
];
var MAX_EVENTS = 12;
var Tui = class {
  state;
  renderTimer = null;
  actionResolve = null;
  selectedAgent = null;
  picking = false;
  expanded = null;
  pickerCursor = 0;
  pickerItems = [];
  onWatchChanged = null;
  getWindows = null;
  constructor(roomId) {
    this.state = {
      connected: false,
      roomId,
      peers: [],
      sessions: /* @__PURE__ */ new Map(),
      events: [],
      startTime: Date.now(),
      totalBytesSent: 0
    };
  }
  /** Set initial watch list (from --watch flag) */
  setInitialWatch(names) {
    for (const name of names) {
      const existing = this.state.sessions.get(name);
      if (existing) {
        existing.watched = true;
      } else {
        this.state.sessions.set(name, {
          name,
          state: "waiting",
          lastActivity: Date.now(),
          bytesSent: 0,
          watched: true
        });
      }
    }
  }
  setConnected(connected) {
    this.state.connected = connected;
    this.render();
  }
  setError(reason) {
    this.stop();
    process.stderr.write(`
${c(RED + BOLD, "Error:")} ${reason}

`);
    this.actionResolve?.("quit");
  }
  setPeers(peers) {
    this.state.peers = peers;
    this.render();
  }
  started = false;
  /** Register all discovered sessions (from tmux.listSessions) */
  discoverSessions(names) {
    let added = false;
    for (const name of names) {
      if (!this.state.sessions.has(name)) {
        this.state.sessions.set(name, {
          name,
          state: "waiting",
          lastActivity: Date.now(),
          bytesSent: 0,
          watched: false
        });
        added = true;
      }
    }
    if (added && this.started && !this.hasAnyWatched() && !this.picking) {
      this.openPicker();
    }
  }
  updateSession(name, state) {
    const existing = this.state.sessions.get(name);
    if (existing) {
      existing.state = state;
      existing.lastActivity = Date.now();
    } else {
      this.state.sessions.set(name, {
        name,
        state,
        lastActivity: Date.now(),
        bytesSent: 0,
        watched: false
      });
    }
  }
  recordOutput(agent, bytes) {
    this.state.totalBytesSent += bytes;
    const session = this.state.sessions.get(agent);
    if (session) {
      session.bytesSent += bytes;
      session.lastActivity = Date.now();
    }
    this.addEvent("\u2192", agent, "output", formatBytes(bytes));
  }
  recordCommand(from, agent, text) {
    this.addEvent("\u2190", from, "command", `"${text.slice(0, 40)}${text.length > 40 ? "..." : ""}"`);
  }
  recordControl(from, action) {
    this.addEvent("\u2190", from, action, "");
  }
  /** Returns map of session name → explicit target (or undefined for auto-detect) */
  getWatchedMap() {
    const watched = /* @__PURE__ */ new Map();
    for (const s of this.state.sessions.values()) {
      if (s.watched) watched.set(s.name, s.target);
    }
    return watched;
  }
  getWatched() {
    return [...this.state.sessions.values()].filter((s) => s.watched).map((s) => s.name);
  }
  hasAnyWatched() {
    return [...this.state.sessions.values()].some((s) => s.watched);
  }
  addEvent(direction, source, action, detail) {
    this.state.events.push({ time: Date.now(), direction, source, action, detail });
    if (this.state.events.length > MAX_EVENTS) {
      this.state.events = this.state.events.slice(-MAX_EVENTS);
    }
  }
  start(onWatchChanged, getWindows) {
    this.onWatchChanged = onWatchChanged;
    this.getWindows = getWindows ?? null;
    process.stdout.write(HIDE_CURSOR);
    if (process.stdin.isTTY) {
      readline.emitKeypressEvents(process.stdin);
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on("keypress", this.onKeypress);
    }
    this.started = true;
    if (!this.hasAnyWatched() && this.state.sessions.size > 0) {
      this.openPicker();
    }
    this.render();
    this.renderTimer = setInterval(() => this.render(), 1e3);
    return new Promise((resolve) => {
      this.actionResolve = resolve;
    });
  }
  stop() {
    if (this.renderTimer) {
      clearInterval(this.renderTimer);
      this.renderTimer = null;
    }
    if (process.stdin.isTTY) {
      process.stdin.off("keypress", this.onKeypress);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }
    process.stdout.write(SHOW_CURSOR);
    process.stdout.write(CLEAR);
  }
  openPicker() {
    this.picking = true;
    this.pickerCursor = 0;
    this.expanded = null;
    this.rebuildPickerItems();
    this.render();
  }
  rebuildPickerItems() {
    this.pickerItems = [];
    const sessions = [...this.state.sessions.keys()].sort();
    for (const name of sessions) {
      this.pickerItems.push({ label: name, key: name, indent: false, isClaude: false });
      if (this.expanded === name && this.getWindows) {
        const windows = this.getWindows(name);
        for (const w of windows) {
          const label = `${w.windowName}${w.paneTitle && w.paneTitle !== w.windowName ? ` (${w.paneTitle})` : ""}`;
          this.pickerItems.push({ label, key: `${name}=${w.target}`, indent: true, isClaude: w.isClaude });
        }
      }
    }
    if (this.pickerCursor >= this.pickerItems.length) {
      this.pickerCursor = Math.max(0, this.pickerItems.length - 1);
    }
  }
  closePicker() {
    this.picking = false;
    this.expanded = null;
    const watched = this.getWatched();
    if (watched.length > 0 && (!this.selectedAgent || !watched.includes(this.selectedAgent))) {
      this.selectedAgent = watched[0];
    }
    this.onWatchChanged?.(this.getWatchedMap());
    this.render();
  }
  onKeypress = (_str, key) => {
    if (key.ctrl && key.name === "c") {
      this.actionResolve?.("quit");
      return;
    }
    if (this.picking) {
      this.handlePickerKey(key);
      return;
    }
    const ch = (key.name || "").toLowerCase();
    if (ch === "q") this.actionResolve?.("quit");
    if (ch === "w") this.openPicker();
    if (ch === "tab") {
      const watched = this.getWatched();
      if (watched.length > 0) {
        const idx = this.selectedAgent ? watched.indexOf(this.selectedAgent) : -1;
        this.selectedAgent = watched[(idx + 1) % watched.length];
        this.render();
      }
    }
  };
  handlePickerKey(key) {
    const ch = (key.name || "").toLowerCase();
    const total = this.pickerItems.length;
    if (total === 0) return;
    if (ch === "up" || ch === "k") {
      this.pickerCursor = (this.pickerCursor - 1 + total) % total;
    } else if (ch === "down" || ch === "j") {
      this.pickerCursor = (this.pickerCursor + 1) % total;
    } else if (ch === "right") {
      const cursorEntry = this.pickerItems[this.pickerCursor];
      if (cursorEntry && !cursorEntry.indent) {
        this.expanded = this.expanded === cursorEntry.key ? null : cursorEntry.key;
        this.rebuildPickerItems();
      }
    } else if (ch === "left") {
      if (this.expanded) {
        this.expanded = null;
        this.rebuildPickerItems();
      }
    } else if (ch === "space") {
      const selectedEntry = this.pickerItems[this.pickerCursor];
      if (!selectedEntry) return;
      if (selectedEntry.indent) {
        const [sessionName, target] = selectedEntry.key.split("=");
        const session = this.state.sessions.get(sessionName);
        if (session) {
          session.watched = true;
          session.target = target;
        }
      } else {
        const session = this.state.sessions.get(selectedEntry.key);
        if (session) {
          session.watched = !session.watched;
          if (!session.watched) session.target = void 0;
        }
      }
    } else if (ch === "return") {
      this.closePicker();
      return;
    } else if (ch === "a") {
      const allWatched = [...this.state.sessions.values()].every((s) => s.watched);
      for (const s of this.state.sessions.values()) {
        s.watched = !allWatched;
        if (!s.watched) s.target = void 0;
      }
    } else if (ch === "escape") {
      this.closePicker();
      return;
    }
    this.render();
  }
  render() {
    if (this.picking) {
      this.renderPicker();
    } else {
      this.renderDashboard();
    }
  }
  renderPicker() {
    const lines = [];
    lines.push("");
    for (const line of BANNER) {
      lines.push(c(CYAN, line));
    }
    lines.push("");
    lines.push(`  ${c(WHITE + BOLD, "Select sessions to monitor")}`);
    lines.push("");
    for (let i = 0; i < this.pickerItems.length; i++) {
      const pickerEntry = this.pickerItems[i];
      const isCursor = i === this.pickerCursor;
      if (pickerEntry.indent) {
        const prefix = "    ";
        const marker = pickerEntry.isClaude ? c(GREEN, "\u2733") : c(DIM, "\xB7");
        const label = isCursor ? c(INVERSE + WHITE, ` ${pickerEntry.label} `) : c(GRAY, ` ${pickerEntry.label}`);
        lines.push(`${prefix}${marker} ${label}`);
      } else {
        const session = this.state.sessions.get(pickerEntry.key);
        const check = session.watched ? c(GREEN, "\u25C9") : c(DIM, "\u25CB");
        const arrow = this.expanded === pickerEntry.key ? c(DIM, "\u25BC") : c(DIM, "\u25B8");
        const label = isCursor ? c(INVERSE + WHITE, ` ${pickerEntry.label} `) : c(WHITE, ` ${pickerEntry.label}`);
        const targetHint = session.target ? c(DIM, ` \u2192 ${session.target}`) : "";
        lines.push(`  ${check} ${arrow}${label}${targetHint}`);
      }
    }
    lines.push("");
    lines.push(
      `  ${c(DIM, "\u2191\u2193")} ${c(GRAY, "navigate")}    ${c(DIM, "\u2192")} ${c(GRAY, "expand")}    ${c(DIM, "space")} ${c(GRAY, "toggle")}    ${c(DIM, "a")} ${c(GRAY, "all")}    ${c(DIM, "enter")} ${c(GRAY, "confirm")}`
    );
    lines.push("");
    process.stdout.write(CLEAR + lines.join("\n"));
  }
  renderDashboard() {
    const { connected, roomId, peers, sessions, events, startTime, totalBytesSent } = this.state;
    const lines = [];
    const w = process.stdout.columns || 60;
    lines.push("");
    for (const line of BANNER) {
      lines.push(c(CYAN, line));
    }
    lines.push("");
    const statusDot = connected ? c(GREEN, "\u25CF") : c(RED, "\u25CF");
    const statusText = connected ? c(GREEN, "Connected") : c(RED, "Disconnected");
    const uptime = formatUptime(Date.now() - startTime);
    lines.push(
      `  ${c(DIM, "Room")}    ${c(WHITE + BOLD, roomId)}    ${statusDot} ${statusText}    ${c(DIM, "Up")} ${c(WHITE, uptime)}`
    );
    const peerText = peers.length > 0 ? peers.join(", ") : c(DIM, "none");
    const sentText = totalBytesSent > 0 ? formatBytes(totalBytesSent) : c(DIM, "0");
    lines.push(
      `  ${c(DIM, "Peers")}   ${peerText}    ${c(DIM, "Sent")} ${sentText}`
    );
    lines.push("");
    const watched = [...sessions.values()].filter((s) => s.watched).sort((a, b) => a.name.localeCompare(b.name));
    const unwatched = [...sessions.values()].filter((s) => !s.watched);
    const hr = c(DIM, "\u2500".repeat(Math.min(w - 30, 40)));
    lines.push(`  ${c(CYAN + BOLD, "Watching")} ${c(DIM, `(${watched.length}/${sessions.size})`)}  ${hr}`);
    if (watched.length === 0) {
      lines.push(`  ${c(DIM, "No sessions selected \u2014 press")} ${c(WHITE, "w")} ${c(DIM, "to pick")}`);
    } else {
      for (const s of watched) {
        const isSelected = s.name === this.selectedAgent;
        const dot = s.state === "busy" ? c(BLUE, "\u25CF") : s.state === "ready" ? c(GREEN, "\u25CF") : c(YELLOW, "\u25CB");
        const stateText = s.state === "busy" ? c(BLUE, "busy") : s.state === "ready" ? c(GREEN, "ready") : c(YELLOW, "waiting");
        const age = formatAge(Date.now() - s.lastActivity);
        const rawName = s.name.length > 20 ? s.name.slice(0, 19) + "\u2026" : s.name.padEnd(20);
        const name = isSelected ? c(CYAN + BOLD, rawName) : c(WHITE, rawName);
        const sel = isSelected ? c(CYAN, "\u25B8") : " ";
        const sent = s.bytesSent > 0 ? c(DIM, formatBytes(s.bytesSent)) : "";
        lines.push(`  ${sel}${dot} ${name} ${stateText.padEnd(18)} ${c(DIM, age)}  ${sent}`);
      }
    }
    if (unwatched.length > 0) {
      lines.push(`  ${c(DIM, `  +${unwatched.length} not monitored`)}`);
    }
    lines.push("");
    lines.push(`  ${c(CYAN + BOLD, "Activity")}  ${hr}`);
    if (events.length === 0) {
      lines.push(`  ${c(DIM, "Waiting for activity...")}`);
    } else {
      for (const e of events.slice(-8)) {
        const time = new Date(e.time).toLocaleTimeString("en-US", { hour12: false });
        const dir = e.direction === "\u2192" ? c(GREEN, "\u2192") : c(YELLOW, "\u2190");
        const src = e.source.length > 16 ? e.source.slice(0, 15) + "\u2026" : e.source.padEnd(16);
        const act = e.action.padEnd(10);
        lines.push(`  ${c(DIM, time)}  ${dir} ${c(WHITE, src)} ${c(DIM, act)} ${e.detail}`);
      }
    }
    lines.push("");
    lines.push(`  ${c(DIM, "tab")} ${c(GRAY, "switch agent")}    ${c(DIM, "w")} ${c(GRAY, "watch")}    ${c(DIM, "q")} ${c(GRAY, "quit")}`);
    lines.push("");
    process.stdout.write(CLEAR + lines.join("\n"));
  }
};
function formatUptime(ms) {
  const s = Math.floor(ms / 1e3);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
function formatAge(ms) {
  if (ms < 1e3) return "now";
  const s = Math.floor(ms / 1e3);
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// src/cli.ts
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { createServer } from "http";
import { execFile } from "child_process";
var CONFIG_DIR = join(homedir(), ".agentcoder");
var CREDS_FILE = join(CONFIG_DIR, "credentials.json");
var CLI_AUTH_PORT = 19283;
var APP_URL = "https://agentcoder.space";
function loadCredentials() {
  if (!existsSync(CREDS_FILE)) return null;
  try {
    const parsed = JSON.parse(readFileSync(CREDS_FILE, "utf-8"));
    if (!parsed.token || typeof parsed.token !== "string") return null;
    return parsed;
  } catch {
    console.error(`Warning: credentials file is corrupted (${CREDS_FILE}). Run: agentcoder login`);
    return null;
  }
}
function saveCredentials(creds) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CREDS_FILE, JSON.stringify(creds, null, 2));
}
function openBrowser(url) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  execFile(cmd, [url], () => {
  });
}
function printUsage() {
  console.log(`
AgentCoder Bridge \u2014 relay your tmux sessions to the web UI

USAGE:
  agentcoder login                     Sign in via browser
  agentcoder start --session <id>      Start bridge (uses saved token)
  agentcoder start --session <id> --token <token>
  agentcoder status                    Show connection info

OPTIONS:
  --session <id>     Session ID (must match the web UI)
  --watch <names>    Comma-separated tmux sessions to monitor
  --token <token>    FAS session token (or use 'login' first)
  --api <url>        API base URL (default: wss://api.freeappstore.online)

SETUP:
  1. Run: agentcoder login
  2. Sign in with GitHub in the browser
  3. Run: agentcoder start --session <id>

The bridge monitors all tmux sessions on this machine and relays
their output to the web UI in real-time.
`);
}
function login() {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${CLI_AUTH_PORT}`);
      if (url.pathname === "/callback") {
        const token = url.searchParams.get("token");
        if (!token) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end("<html><body><h2>Missing token.</h2></body></html>");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end('<html><body style="font-family:system-ui;text-align:center;padding:3rem"><h2>Logged in!</h2><p>Return to your terminal. You can close this tab.</p></body></html>');
        server.close();
        resolve(token);
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(CLI_AUTH_PORT, "127.0.0.1", () => {
      const authUrl = `${APP_URL}?cli_auth=1&port=${CLI_AUTH_PORT}`;
      console.log("Opening browser for sign-in...");
      console.log(`If the browser doesn't open, visit:
  ${authUrl}`);
      console.log("Waiting for sign-in...");
      openBrowser(authUrl);
    });
    server.on("error", (err) => {
      reject(new Error(`Could not start auth server on port ${CLI_AUTH_PORT}: ${err.message}`));
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error("Login timed out (5 minutes). Try again."));
    }, 3e5);
    server.on("close", () => clearTimeout(timer));
  });
}
function parseStartArgs(cliArgs) {
  let sessionId = "";
  let token = "";
  let apiBase;
  let watchList;
  const hasValue = (i) => i + 1 < cliArgs.length && !cliArgs[i + 1].startsWith("--");
  for (let i = 1; i < cliArgs.length; i++) {
    if (cliArgs[i] === "--session" && hasValue(i)) {
      sessionId = cliArgs[++i];
    } else if (cliArgs[i] === "--token" && hasValue(i)) {
      token = cliArgs[++i];
    } else if (cliArgs[i] === "--api" && hasValue(i)) {
      apiBase = cliArgs[++i];
    } else if (cliArgs[i] === "--watch" && hasValue(i)) {
      watchList = cliArgs[++i].split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  if (!sessionId || !token) {
    const saved = loadCredentials();
    if (saved) {
      sessionId = sessionId || saved.sessionId;
      token = token || saved.token;
    }
  }
  return { sessionId, token, apiBase, watchList };
}
async function handleStart(cliArgs) {
  const { sessionId, token, apiBase, watchList } = parseStartArgs(cliArgs);
  if (!token) {
    console.error("Not logged in. Run: agentcoder login");
    process.exit(1);
  }
  if (!sessionId) {
    console.error("Error: --session <id> is required");
    console.error("Use the same session ID shown in the web UI.");
    process.exit(1);
  }
  if (!isTmuxAvailable()) {
    console.error("Error: tmux is not installed or not in PATH.");
    console.error("Install it with: brew install tmux (macOS) or apt install tmux (Linux)");
    process.exit(1);
  }
  const sessions = listSessions();
  if (sessions.length === 0) {
    console.error("No tmux sessions found. Start a tmux session first:");
    console.error("  tmux new -s mysession");
    process.exit(1);
  }
  saveCredentials({ token, sessionId });
  const tui = new Tui(sessionId);
  if (watchList) tui.setInitialWatch(watchList);
  const bridge = new Bridge({ token, sessionId, apiBase, watchList }, {
    onConnected: () => tui.setConnected(true),
    onDisconnected: () => tui.setConnected(false),
    onError: (reason) => tui.setError(reason),
    onPeers: (peers) => tui.setPeers(peers),
    onSessions: (names) => tui.discoverSessions(names),
    onSessionState: (agent, state) => tui.updateSession(agent, state),
    onOutput: (agent, bytes) => tui.recordOutput(agent, bytes),
    onCommand: (from, agent, text) => tui.recordCommand(from, agent, text),
    onControl: (from, action2) => tui.recordControl(from, action2)
  });
  bridge.start();
  const action = await tui.start(
    (watched) => bridge.setWatchList(watched),
    (session) => listWindows(session)
  );
  tui.stop();
  bridge.stop();
  if (action === "quit") process.exit(0);
}
async function main() {
  const cliArgs = process.argv.slice(2);
  const command = cliArgs[0];
  if (!command || command === "help" || command === "--help") {
    printUsage();
    process.exit(0);
  }
  if (command === "login") {
    try {
      const token = await login();
      const saved = loadCredentials();
      saveCredentials({ token, sessionId: saved?.sessionId ?? "" });
      console.log("Logged in successfully! Token saved.");
      console.log("Now run: agentcoder start --session <id>");
    } catch (e) {
      console.error(e.message);
      process.exit(1);
    }
    process.exit(0);
  }
  if (command === "status") {
    const creds = loadCredentials();
    if (creds) {
      console.log(`Session: ${creds.sessionId || "(not set)"}`);
      console.log(`Token: ${creds.token.slice(0, 20)}...`);
      console.log(`Config: ${CREDS_FILE}`);
    } else {
      console.log("Not configured. Run: agentcoder login");
    }
    process.exit(0);
  }
  if (command === "start") {
    await handleStart(cliArgs);
  } else {
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
  }
}
main();
export {
  parseStartArgs
};
