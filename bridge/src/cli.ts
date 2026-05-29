#!/usr/bin/env node
import { Bridge } from './index.js'
import { Tui } from './tui.js'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { createServer } from 'http'
import { execFile } from 'child_process'

const CONFIG_DIR = join(homedir(), '.agentcoder')
const CREDS_FILE = join(CONFIG_DIR, 'credentials.json')
const CLI_AUTH_PORT = 19283
const APP_URL = 'https://agentcoder.freeappstore.online'

interface Credentials {
  token: string
  sessionId: string
}

function loadCredentials(): Credentials | null {
  if (!existsSync(CREDS_FILE)) return null
  try {
    return JSON.parse(readFileSync(CREDS_FILE, 'utf-8')) as Credentials
  } catch {
    return null
  }
}

function saveCredentials(creds: Credentials): void {
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(CREDS_FILE, JSON.stringify(creds, null, 2))
}

function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start'
    : 'xdg-open'
  execFile(cmd, [url], () => {})
}

function printUsage(): void {
  console.log(`
AgentCoder Bridge — relay your tmux sessions to the web UI

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
`)
}

function login(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${CLI_AUTH_PORT}`)

      if (url.pathname === '/callback') {
        const token = url.searchParams.get('token')
        if (!token) {
          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end('<html><body><h2>Missing token.</h2></body></html>')
          return
        }

        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<html><body style="font-family:system-ui;text-align:center;padding:3rem"><h2>Logged in!</h2><p>Return to your terminal. You can close this tab.</p></body></html>')

        server.close()
        resolve(token)
        return
      }

      res.writeHead(404)
      res.end()
    })

    server.listen(CLI_AUTH_PORT, '127.0.0.1', () => {
      const authUrl = `${APP_URL}?cli_auth=1&port=${CLI_AUTH_PORT}`
      console.log('Opening browser for sign-in...')
      console.log(`If the browser doesn't open, visit:\n  ${authUrl}`)
      console.log('Waiting for sign-in...')
      openBrowser(authUrl)
    })

    server.on('error', (err) => {
      reject(new Error(`Could not start auth server on port ${CLI_AUTH_PORT}: ${err.message}`))
    })

    // Timeout after 5 minutes
    const timer = setTimeout(() => {
      server.close()
      reject(new Error('Login timed out (5 minutes). Try again.'))
    }, 300_000)

    // Clear timeout if login succeeds before it fires
    server.on('close', () => clearTimeout(timer))
  })
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const command = args[0]

  if (!command || command === 'help' || command === '--help') {
    printUsage()
    process.exit(0)
  }

  if (command === 'login') {
    try {
      const token = await login()
      const saved = loadCredentials()
      saveCredentials({ token, sessionId: saved?.sessionId ?? '' })
      console.log('Logged in successfully! Token saved.')
      console.log('Now run: agentcoder start --session <id>')
    } catch (e) {
      console.error((e as Error).message)
      process.exit(1)
    }
    process.exit(0)
  }

  if (command === 'status') {
    const creds = loadCredentials()
    if (creds) {
      console.log(`Session: ${creds.sessionId || '(not set)'}`)
      console.log(`Token: ${creds.token.slice(0, 20)}...`)
      console.log(`Config: ${CREDS_FILE}`)
    } else {
      console.log('Not configured. Run: agentcoder login')
    }
    process.exit(0)
  }

  if (command === 'start') {
    let sessionId = ''
    let token = ''
    let apiBase: string | undefined
    let watchList: string[] | undefined

    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--session' && args[i + 1]) {
        sessionId = args[++i]!
      } else if (args[i] === '--token' && args[i + 1]) {
        token = args[++i]!
      } else if (args[i] === '--api' && args[i + 1]) {
        apiBase = args[++i]!
      } else if (args[i] === '--watch' && args[i + 1]) {
        watchList = args[++i]!.split(',').map((s) => s.trim()).filter(Boolean)
      }
    }

    // Fall back to saved credentials
    if (!sessionId || !token) {
      const saved = loadCredentials()
      if (saved) {
        sessionId = sessionId || saved.sessionId
        token = token || saved.token
      }
    }

    if (!token) {
      console.error('Not logged in. Run: agentcoder login')
      process.exit(1)
    }

    if (!sessionId) {
      console.error('Error: --session <id> is required')
      console.error('Use the same session ID shown in the web UI.')
      process.exit(1)
    }

    // Save for next time
    saveCredentials({ token, sessionId })

    const tui = new Tui(sessionId)
    if (watchList) tui.setInitialWatch(watchList)

    const bridge = new Bridge({ token, sessionId, apiBase, watchList }, {
      onConnected: () => tui.setConnected(true),
      onDisconnected: () => tui.setConnected(false),
      onPeers: (peers) => tui.setPeers(peers),
      onSessions: (names) => tui.discoverSessions(names),
      onSessionState: (agent, state) => tui.updateSession(agent, state),
      onOutput: (agent, bytes) => tui.recordOutput(agent, bytes),
      onCommand: (from, agent, text) => tui.recordCommand(from, agent, text),
      onControl: (from, action) => tui.recordControl(from, action),
    })

    bridge.start()

    const action = await tui.start((watched) => bridge.setWatchList(watched))
    tui.stop()
    bridge.stop()

    if (action === 'quit') process.exit(0)
  } else {
    console.error(`Unknown command: ${command}`)
    printUsage()
    process.exit(1)
  }
}

main()
