// src/room-client.ts
import WebSocket from "ws";
var RECONNECT_BASE_MS = 1e3;
var RECONNECT_MAX_MS = 3e4;
var API_BASE = "wss://api.freeappstore.online";
var RoomClient = class {
  constructor(appId, roomId, token, apiBase = API_BASE) {
    this.appId = appId;
    this.roomId = roomId;
    this.token = token;
    this.apiBase = apiBase;
    this.connect();
  }
  appId;
  roomId;
  token;
  apiBase;
  socket = null;
  listeners = [];
  stateListeners = [];
  peerListeners = [];
  _peers = [];
  connectionState = "connecting";
  reconnectAttempt = 0;
  reconnectTimer = null;
  closed = false;
  get state() {
    return this.connectionState;
  }
  get peers() {
    return this._peers;
  }
  send(data) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ kind: "msg", data }));
  }
  onMessage(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }
  onConnectionState(listener) {
    this.stateListeners.push(listener);
    listener(this.connectionState);
    return () => {
      this.stateListeners = this.stateListeners.filter((l) => l !== listener);
    };
  }
  onPeers(listener) {
    this.peerListeners.push(listener);
    return () => {
      this.peerListeners = this.peerListeners.filter((l) => l !== listener);
    };
  }
  close() {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
    this.setState("closed");
  }
  connect() {
    if (this.closed) return;
    this.setState("connecting");
    const url = `${this.apiBase}/v1/apps/${encodeURIComponent(this.appId)}/rooms/${encodeURIComponent(this.roomId)}?token=${encodeURIComponent(this.token)}`;
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.on("open", () => {
      this.reconnectAttempt = 0;
      this.setState("open");
      console.log(`[bridge] Connected to room ${this.roomId}`);
    });
    socket.on("message", (raw) => {
      try {
        const parsed = JSON.parse(raw.toString());
        if (parsed.kind === "msg") {
          for (const l of this.listeners) {
            l({ from: parsed.from, data: parsed.data, at: parsed.at });
          }
        } else if (parsed.kind === "peers") {
          this._peers = parsed.peers;
          for (const l of this.peerListeners) l(this._peers);
        } else if (parsed.kind === "error") {
          console.warn(`[bridge] Room error: ${parsed.error}`);
        }
      } catch {
      }
    });
    socket.on("close", () => {
      if (this.socket === socket) this.socket = null;
      if (this.closed) return;
      this.setState("closed");
      this.scheduleReconnect();
    });
    socket.on("error", (err) => {
      console.error(`[bridge] WebSocket error:`, err.message);
      this.setState("error");
    });
  }
  scheduleReconnect() {
    if (this.reconnectTimer || this.closed) return;
    const backoff = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.reconnectAttempt);
    const jitter = Math.random() * 1e3;
    this.reconnectAttempt++;
    console.log(`[bridge] Reconnecting in ${Math.round(backoff / 1e3)}s...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closed) this.connect();
    }, backoff + jitter);
  }
  setState(state) {
    if (this.connectionState === state) return;
    this.connectionState = state;
    for (const l of this.stateListeners) l(state);
  }
};

// src/tmux.ts
import { execFileSync } from "child_process";
function stripAnsi(str) {
  return str.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    ""
  );
}
function tmux(...args) {
  try {
    return execFileSync("tmux", args, { encoding: "utf-8", timeout: 5e3 });
  } catch {
    return "";
  }
}
function sessionExists(name) {
  try {
    execFileSync("tmux", ["has-session", "-t", name], { timeout: 3e3 });
    return true;
  } catch {
    return false;
  }
}
function listSessions() {
  const output = tmux("list-sessions", "-F", "#{session_name}");
  return output.trim().split("\n").filter(Boolean);
}
function captureScreen(target, lines = 500) {
  const raw = tmux("capture-pane", "-p", "-J", "-S", `-${lines}`, "-t", target);
  return stripAnsi(raw);
}
function sendKeys(target, text) {
  tmux("send-keys", "-t", target, "-l", text);
}
function sendSpecialKey(target, key) {
  tmux("send-keys", "-t", target, key);
}
function isClaudeReady(screen) {
  const lines = screen.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return false;
  const last = lines[lines.length - 1].trim();
  return last.includes("\u276F");
}
function isClaudeProcessing(screen) {
  const lower = screen.toLowerCase();
  return lower.includes("ctrl+c to interrupt") || lower.includes("thinking") || lower.includes("writing") || lower.includes("reading") || lower.includes("editing");
}
function detectState(screen) {
  if (isClaudeProcessing(screen)) return "busy";
  if (isClaudeReady(screen)) return "ready";
  return "waiting";
}

// src/index.ts
var CHUNK_SIZE = 3500;
var HEARTBEAT_INTERVAL = 3e4;
var POLL_INTERVAL = 2e3;
var Bridge = class {
  constructor(config) {
    this.config = config;
    this.room = new RoomClient(
      "agentcoder",
      config.sessionId,
      config.token,
      config.apiBase
    );
  }
  config;
  room;
  outputBuffer = "";
  // Rolling buffer for catch-up
  maxBufferSize = 5e5;
  // 500KB
  lastScreens = /* @__PURE__ */ new Map();
  pollTimer = null;
  heartbeatTimer = null;
  startTime = Date.now();
  start() {
    console.log(`[bridge] Starting bridge for session: ${this.config.sessionId}`);
    this.room.onMessage((msg) => {
      this.handleMessage(msg.data);
    });
    this.pollTimer = setInterval(() => this.pollSessions(), POLL_INTERVAL);
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), HEARTBEAT_INTERVAL);
    setTimeout(() => this.sendHeartbeat(), 1e3);
    this.room.onPeers((peers) => {
      console.log(`[bridge] Peers: ${peers.map((p) => p.login).join(", ")}`);
    });
    console.log("[bridge] Bridge started. Monitoring tmux sessions...");
  }
  stop() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.room.close();
    console.log("[bridge] Bridge stopped.");
  }
  handleMessage(msg) {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case "command": {
        console.log(`[bridge] Command for ${msg.agent}: ${msg.text.slice(0, 80)}...`);
        if (sessionExists(msg.agent)) {
          sendKeys(msg.agent, msg.text);
          sendSpecialKey(msg.agent, "Enter");
        } else {
          console.warn(`[bridge] Session ${msg.agent} not found`);
        }
        break;
      }
      case "control": {
        const { agent, action } = msg;
        switch (action) {
          case "interrupt":
            if (sessionExists(agent)) {
              sendSpecialKey(agent, "C-c");
              console.log(`[bridge] Sent Ctrl+C to ${agent}`);
            }
            break;
          case "resync": {
            const screen = captureScreen(agent);
            this.sendOutput(agent, screen);
            break;
          }
          case "stop":
            if (sessionExists(agent)) {
              sendSpecialKey(agent, "C-c");
              console.log(`[bridge] Stopping ${agent}`);
            }
            break;
        }
        break;
      }
    }
  }
  pollSessions() {
    const sessions = listSessions();
    for (const session of sessions) {
      const screen = captureScreen(session);
      const lastScreen = this.lastScreens.get(session);
      if (screen !== lastScreen) {
        this.lastScreens.set(session, screen);
        if (screen.trim()) {
          this.appendBuffer(screen);
          this.sendOutput(session, screen);
        }
        const state = detectState(screen);
        this.room.send({
          type: "status",
          agent: session,
          state
        });
      }
    }
  }
  sendOutput(agent, content) {
    if (content.length <= CHUNK_SIZE) {
      this.room.send({
        type: "output",
        agent,
        session: "",
        content,
        seq: 0
      });
    } else {
      const chunks = [];
      for (let i = 0; i < content.length; i += CHUNK_SIZE) {
        chunks.push(content.slice(i, i + CHUNK_SIZE));
      }
      for (let i = 0; i < chunks.length; i++) {
        this.room.send({
          type: "output",
          agent,
          session: "",
          content: chunks[i],
          seq: i,
          total: chunks.length
        });
      }
    }
  }
  sendHeartbeat() {
    const sessions = listSessions();
    this.room.send({
      type: "heartbeat",
      agents: sessions,
      uptime: Math.round((Date.now() - this.startTime) / 1e3)
    });
  }
  appendBuffer(content) {
    this.outputBuffer += content;
    if (this.outputBuffer.length > this.maxBufferSize) {
      this.outputBuffer = this.outputBuffer.slice(-this.maxBufferSize);
    }
  }
};

export {
  Bridge
};
