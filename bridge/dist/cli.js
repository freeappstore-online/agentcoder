#!/usr/bin/env node
import {
  Bridge
} from "./chunk-NZPSG6EB.js";

// src/cli.ts
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { createServer } from "http";
import { exec } from "child_process";
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
  exec(`${cmd} "${url}"`);
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
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Private-Network": "true"
        });
        res.end();
        return;
      }
      if (req.method === "POST" && req.url === "/callback") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          try {
            const { token } = JSON.parse(body);
            if (!token) throw new Error("No token");
            res.writeHead(200, {
              "Content-Type": "text/html",
              "Access-Control-Allow-Origin": "*"
            });
            res.end("<html><body><h2>Logged in! You can close this tab.</h2></body></html>");
            server.close();
            resolve(token);
          } catch {
            res.writeHead(400, { "Access-Control-Allow-Origin": "*" });
            res.end("Bad request");
          }
        });
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
    setTimeout(() => {
      server.close();
      reject(new Error("Login timed out (5 minutes). Try again."));
    }, 3e5);
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
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--session" && args[i + 1]) {
        sessionId = args[++i];
      } else if (args[i] === "--token" && args[i + 1]) {
        token = args[++i];
      } else if (args[i] === "--api" && args[i + 1]) {
        apiBase = args[++i];
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
    const bridge = new Bridge({ token, sessionId, apiBase });
    process.on("SIGINT", () => {
      console.log("\nShutting down...");
      bridge.stop();
      process.exit(0);
    });
    process.on("SIGTERM", () => {
      bridge.stop();
      process.exit(0);
    });
    bridge.start();
  } else {
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
  }
}
main();
