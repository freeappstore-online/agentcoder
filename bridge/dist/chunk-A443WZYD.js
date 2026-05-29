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
    const base = this.apiBase.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
    const url = `${base}/v1/apps/${encodeURIComponent(this.appId)}/rooms/${encodeURIComponent(this.roomId)}?token=${encodeURIComponent(this.token)}`;
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.on("open", () => {
      this.reconnectAttempt = 0;
      this.setState("open");
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
    socket.on("error", () => {
    });
  }
  scheduleReconnect() {
    if (this.reconnectTimer || this.closed) return;
    const backoff = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.reconnectAttempt);
    const jitter = Math.random() * 1e3;
    this.reconnectAttempt++;
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
function getTarget(sessionName) {
  return `${sessionName}:0.0`;
}
function sessionExists(name) {
  try {
    execFileSync("tmux", ["has-session", "-t", name], { timeout: 3e3, stdio: "pipe" });
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
  if (screen.includes("ctrl+c to interrupt")) return false;
  const lines = screen.split("\n").slice(-15);
  const tail = lines.join("\n");
  if (tail.includes("bypass permissions") || tail.includes("? for shortcuts") || /❯\s*$/.test(tail) || /❯ .*↵ send/.test(tail)) {
    return true;
  }
  return false;
}
function isClaudeProcessing(screen) {
  if (screen.includes("ctrl+c to interrupt")) return true;
  return /Working|Thinking|Reading|Searching|Running|Editing|Writing/.test(screen);
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
  // null = watch nothing until set
  constructor(config, events = {}) {
    this.config = config;
    this.events = events;
    if (config.watchList) {
      this.watchSet = new Set(config.watchList);
    }
    this.room = new RoomClient(
      "agentcoder",
      config.sessionId,
      config.token,
      config.apiBase
    );
  }
  config;
  events;
  room;
  lastScreens = /* @__PURE__ */ new Map();
  pollTimer = null;
  heartbeatTimer = null;
  startTime = Date.now();
  msgSeq = 0;
  watchSet = null;
  start() {
    this.room.onConnectionState((s) => {
      if (s === "open") this.events.onConnected?.();
      else if (s === "closed") this.events.onDisconnected?.();
    });
    this.room.onMessage((msg) => {
      this.handleMessage(msg);
    });
    this.pollTimer = setInterval(() => this.pollSessions(), POLL_INTERVAL);
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), HEARTBEAT_INTERVAL);
    setTimeout(() => this.sendHeartbeat(), 1e3);
    this.room.onPeers((peers) => {
      this.events.onPeers?.(peers.map((p) => p.login));
      this.sendHeartbeat();
      this.replayCurrentScreens();
    });
  }
  setWatchList(names) {
    this.watchSet = new Set(names);
  }
  replayCurrentScreens() {
    if (!this.watchSet) return;
    for (const session of this.watchSet) {
      const screen = this.lastScreens.get(session);
      if (screen?.trim()) {
        this.sendOutput(session, screen);
        const state = detectState(screen);
        this.events.onSessionState?.(session, state);
        this.room.send({ type: "status", agent: session, state });
      }
    }
  }
  stop() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.room.close();
  }
  handleMessage(msg) {
    const data = msg.data;
    if (!data || !data.type) return;
    switch (data.type) {
      case "command": {
        this.events.onCommand?.(msg.from.login, data.agent, data.text);
        if (sessionExists(data.agent)) {
          const target = getTarget(data.agent);
          sendKeys(target, data.text);
          sendSpecialKey(target, "Enter");
        }
        break;
      }
      case "control": {
        const { agent, action } = data;
        this.events.onControl?.(msg.from.login, action);
        if (!sessionExists(agent)) break;
        const target = getTarget(agent);
        switch (action) {
          case "interrupt":
            sendSpecialKey(target, "C-c");
            break;
          case "resync": {
            const screen = captureScreen(target);
            this.sendOutput(agent, screen);
            break;
          }
          case "stop":
            sendSpecialKey(target, "C-c");
            break;
        }
        break;
      }
    }
  }
  pollSessions() {
    const allSessions = listSessions();
    this.events.onSessions?.(allSessions);
    const sessions = this.watchSet ? allSessions.filter((s) => this.watchSet.has(s)) : [];
    for (const session of sessions) {
      const target = getTarget(session);
      const screen = captureScreen(target);
      const lastScreen = this.lastScreens.get(session);
      if (screen !== lastScreen) {
        this.lastScreens.set(session, screen);
        if (screen.trim()) {
          this.sendOutput(session, screen);
        }
        const state = detectState(screen);
        this.events.onSessionState?.(session, state);
        this.room.send({
          type: "status",
          agent: session,
          state
        });
      }
    }
  }
  sendOutput(agent, content) {
    this.events.onOutput?.(agent, content.length);
    const msgId = String(++this.msgSeq);
    if (content.length <= CHUNK_SIZE) {
      this.room.send({
        type: "output",
        agent,
        session: msgId,
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
          session: msgId,
          content: chunks[i],
          seq: i,
          total: chunks.length
        });
      }
    }
  }
  sendHeartbeat() {
    const allSessions = listSessions();
    const watched = this.watchSet ? allSessions.filter((s) => this.watchSet.has(s)) : [];
    this.room.send({
      type: "heartbeat",
      agents: watched,
      uptime: Math.round((Date.now() - this.startTime) / 1e3)
    });
  }
};

export {
  Bridge
};
