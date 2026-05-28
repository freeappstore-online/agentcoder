#!/usr/bin/env node
import { Bridge } from './index.js'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const CONFIG_DIR = join(homedir(), '.agentcoder')
const CREDS_FILE = join(CONFIG_DIR, 'credentials.json')

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

function printUsage(): void {
  console.log(`
AgentCoder Bridge — relay your tmux sessions to the web UI

USAGE:
  agentcoder start --session <id> --token <fas-token>
  agentcoder start                    (uses saved credentials)
  agentcoder status                   (show connection info)

OPTIONS:
  --session <id>     Session ID (must match the web UI)
  --token <token>    FAS session token
  --api <url>        API base URL (default: wss://api.freeappstore.online)

SETUP:
  1. Sign in at agentcoder.freeappstore.online
  2. Copy your session ID from the connect screen
  3. Run: agentcoder start --session <id> --token <your-fas-token>

The bridge monitors all tmux sessions on this machine and relays
their output to the web UI in real-time.
`)
}

function main(): void {
  const args = process.argv.slice(2)
  const command = args[0]

  if (!command || command === 'help' || command === '--help') {
    printUsage()
    process.exit(0)
  }

  if (command === 'status') {
    const creds = loadCredentials()
    if (creds) {
      console.log(`Session: ${creds.sessionId}`)
      console.log(`Token: ${creds.token.slice(0, 20)}...`)
      console.log(`Config: ${CREDS_FILE}`)
    } else {
      console.log('Not configured. Run: agentcoder start --session <id> --token <token>')
    }
    process.exit(0)
  }

  if (command === 'start') {
    let sessionId = ''
    let token = ''
    let apiBase: string | undefined

    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--session' && args[i + 1]) {
        sessionId = args[++i]!
      } else if (args[i] === '--token' && args[i + 1]) {
        token = args[++i]!
      } else if (args[i] === '--api' && args[i + 1]) {
        apiBase = args[++i]!
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

    if (!sessionId || !token) {
      console.error('Error: --session and --token are required (or save credentials first)')
      console.error('Run: agentcoder start --session <id> --token <fas-token>')
      process.exit(1)
    }

    // Save for next time
    saveCredentials({ token, sessionId })

    const bridge = new Bridge({ token, sessionId, apiBase })

    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log('\nShutting down...')
      bridge.stop()
      process.exit(0)
    })
    process.on('SIGTERM', () => {
      bridge.stop()
      process.exit(0)
    })

    bridge.start()
  } else {
    console.error(`Unknown command: ${command}`)
    printUsage()
    process.exit(1)
  }
}

main()
