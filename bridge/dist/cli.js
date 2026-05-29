#!/usr/bin/env node
import {
  Bridge
} from "./chunk-NQCOW6MU.js";

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
  picking = false;
  pickerCursor = 0;
  pickerSessions = [];
  onWatchChanged = null;
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
  setPeers(peers) {
    this.state.peers = peers;
    this.render();
  }
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
    if (added && !this.hasAnyWatched() && !this.picking) {
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
  start(onWatchChanged) {
    this.onWatchChanged = onWatchChanged;
    process.stdout.write(HIDE_CURSOR);
    if (!this.hasAnyWatched() && this.state.sessions.size > 0) {
      this.openPicker();
    }
    this.render();
    this.renderTimer = setInterval(() => this.render(), 1e3);
    return new Promise((resolve) => {
      this.actionResolve = resolve;
      if (process.stdin.isTTY) {
        readline.emitKeypressEvents(process.stdin);
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on("keypress", this.onKeypress);
      }
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
    this.pickerSessions = [...this.state.sessions.keys()].sort();
    this.render();
  }
  closePicker() {
    this.picking = false;
    const watched = this.getWatched();
    this.onWatchChanged?.(watched);
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
  };
  handlePickerKey(key) {
    const ch = (key.name || "").toLowerCase();
    const total = this.pickerSessions.length;
    if (total === 0) return;
    if (ch === "up" || ch === "k") {
      this.pickerCursor = (this.pickerCursor - 1 + total) % total;
    } else if (ch === "down" || ch === "j") {
      this.pickerCursor = (this.pickerCursor + 1) % total;
    } else if (ch === "space") {
      const name = this.pickerSessions[this.pickerCursor];
      const session = this.state.sessions.get(name);
      if (session) session.watched = !session.watched;
    } else if (ch === "return") {
      this.closePicker();
      return;
    } else if (ch === "a") {
      const allWatched = this.pickerSessions.every(
        (n) => this.state.sessions.get(n)?.watched
      );
      for (const n of this.pickerSessions) {
        const s = this.state.sessions.get(n);
        if (s) s.watched = !allWatched;
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
    for (let i = 0; i < this.pickerSessions.length; i++) {
      const name = this.pickerSessions[i];
      const session = this.state.sessions.get(name);
      const isSelected = i === this.pickerCursor;
      const check = session.watched ? c(GREEN, "\u25C9") : c(DIM, "\u25CB");
      const label = isSelected ? c(INVERSE + WHITE, ` ${name} `) : c(WHITE, ` ${name}`);
      const stateLabel = session.state === "busy" ? c(BLUE, "busy") : session.state === "ready" ? c(GREEN, "ready") : c(DIM, "idle");
      lines.push(`  ${check} ${label}  ${stateLabel}`);
    }
    lines.push("");
    lines.push(
      `  ${c(DIM, "\u2191\u2193")} ${c(GRAY, "navigate")}    ${c(DIM, "space")} ${c(GRAY, "toggle")}    ${c(DIM, "a")} ${c(GRAY, "all")}    ${c(DIM, "enter")} ${c(GRAY, "confirm")}`
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
        const dot = s.state === "busy" ? c(BLUE, "\u25CF") : s.state === "ready" ? c(GREEN, "\u25CF") : c(YELLOW, "\u25CB");
        const stateText = s.state === "busy" ? c(BLUE, "busy") : s.state === "ready" ? c(GREEN, "ready") : c(YELLOW, "waiting");
        const age = formatAge(Date.now() - s.lastActivity);
        const name = s.name.length > 20 ? s.name.slice(0, 19) + "\u2026" : s.name.padEnd(20);
        const sent = s.bytesSent > 0 ? c(DIM, formatBytes(s.bytesSent)) : "";
        lines.push(`  ${dot} ${c(WHITE, name)} ${stateText.padEnd(18)} ${c(DIM, age)}  ${sent}`);
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
    lines.push(`  ${c(DIM, "w")} ${c(GRAY, "watch")}    ${c(DIM, "q")} ${c(GRAY, "quit")}    ${c(DIM, "Ctrl+C")} ${c(GRAY, "stop")}`);
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
var APP_URL = "https://agentcoder.freeappstore.online";
function loadCredentials() {
  if (!existsSync(CREDS_FILE)) return null;
  try {
    return JSON.parse(readFileSync(CREDS_FILE, "utf-8"));
  } catch {
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
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
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
    let sessionId = "";
    let token = "";
    let apiBase;
    let watchList;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--session" && args[i + 1]) {
        sessionId = args[++i];
      } else if (args[i] === "--token" && args[i + 1]) {
        token = args[++i];
      } else if (args[i] === "--api" && args[i + 1]) {
        apiBase = args[++i];
      } else if (args[i] === "--watch" && args[i + 1]) {
        watchList = args[++i].split(",").map((s) => s.trim()).filter(Boolean);
      }
    }
    if (!sessionId || !token) {
      const saved = loadCredentials();
      if (saved) {
        sessionId = sessionId || saved.sessionId;
        token = token || saved.token;
      }
    }
    if (!token) {
      console.error("Not logged in. Run: agentcoder login");
      process.exit(1);
    }
    if (!sessionId) {
      console.error("Error: --session <id> is required");
      console.error("Use the same session ID shown in the web UI.");
      process.exit(1);
    }
    saveCredentials({ token, sessionId });
    const tui = new Tui(sessionId);
    if (watchList) tui.setInitialWatch(watchList);
    const bridge = new Bridge({ token, sessionId, apiBase, watchList }, {
      onConnected: () => tui.setConnected(true),
      onDisconnected: () => tui.setConnected(false),
      onPeers: (peers) => tui.setPeers(peers),
      onSessions: (names) => tui.discoverSessions(names),
      onSessionState: (agent, state) => tui.updateSession(agent, state),
      onOutput: (agent, bytes) => tui.recordOutput(agent, bytes),
      onCommand: (from, agent, text) => tui.recordCommand(from, agent, text),
      onControl: (from, action2) => tui.recordControl(from, action2)
    });
    bridge.start();
    const action = await tui.start((watched) => bridge.setWatchList(watched));
    tui.stop();
    bridge.stop();
    if (action === "quit") process.exit(0);
  } else {
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
  }
}
main();
