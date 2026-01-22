#!/usr/bin/env node

import { cac } from 'cac'
import { VERSION, LOG_FILE_PATH } from './utils.js'
import { ensureRelayServer, RELAY_PORT } from './relay-client.js'

const cli = cac('playwriter')

cli
  .command('', 'Start the MCP server (default)')
  .option('--host <host>', 'Remote relay server host to connect to (or use PLAYWRITER_HOST env var)')
  .option('--token <token>', 'Authentication token (or use PLAYWRITER_TOKEN env var)')
  .option('-e, --eval <code>', 'Execute JavaScript code and exit')
  .option('--timeout <ms>', 'Execution timeout in milliseconds', { default: 5000 })
  .option('-s, --session <name>', 'Session name (required for -e)')
  .action(async (options: { host?: string; token?: string; eval?: string; timeout?: number; session?: string }) => {
    // If -e flag is provided, execute code via relay server
    if (options.eval) {
      await executeCode({
        code: options.eval,
        timeout: options.timeout || 5000,
        sessionId: options.session,
        host: options.host,
        token: options.token,
      })
      return
    }
    
    // Otherwise start the MCP server
    const { startMcp } = await import('./mcp.js')
    await startMcp({
      host: options.host,
      token: options.token,
    })
  })

async function executeCode(options: {
  code: string
  timeout: number
  sessionId?: string
  host?: string
  token?: string
}): Promise<void> {
  const { code, timeout, host, token } = options
  const cwd = process.cwd()
  const sessionId = options.sessionId || process.env.PLAYWRITER_SESSION
  
  // Determine server URL
  const serverHost = host || process.env.PLAYWRITER_HOST || '127.0.0.1'
  const serverUrl = `http://${serverHost}:${RELAY_PORT}`
  
  // Ensure relay server is running (only for local)
  if (!host && !process.env.PLAYWRITER_HOST) {
    await ensureRelayServer({ logger: console })
  }
  
  // Session is required
  if (!sessionId) {
    try {
      const res = await fetch(`${serverUrl}/cli/session/suggest`)
      const { next } = await res.json() as { next: number }
      console.error(`Error: -s/--session is required. Use -s ${next} for a new session.`)
    } catch {
      console.error(`Error: -s/--session is required. Use -s 1 for a new session.`)
    }
    process.exit(1)
  }
  
  // Build request URL with token if provided
  const executeUrl = `${serverUrl}/cli/execute`
  
  try {
    const response = await fetch(executeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token || process.env.PLAYWRITER_TOKEN ? { 'Authorization': `Bearer ${token || process.env.PLAYWRITER_TOKEN}` } : {}),
      },
      body: JSON.stringify({ sessionId, code, timeout, cwd }),
    })
    
    if (!response.ok) {
      const text = await response.text()
      console.error(`Error: ${response.status} ${text}`)
      process.exit(1)
    }
    
    const result = await response.json() as { text: string; images: Array<{ data: string; mimeType: string }>; isError: boolean }
    
    // Print output
    if (result.text) {
      if (result.isError) {
        console.error(result.text)
      } else {
        console.log(result.text)
      }
    }
    
    // Note: images are base64 encoded, we could save them to files if needed
    if (result.images && result.images.length > 0) {
      console.log(`\n${result.images.length} screenshot(s) captured`)
    }
    
    if (result.isError) {
      process.exit(1)
    }
  } catch (error: any) {
    if (error.cause?.code === 'ECONNREFUSED') {
      console.error('Error: Cannot connect to relay server.')
      console.error('The Playwriter relay server should start automatically. Check logs at:')
      console.error(`  ${LOG_FILE_PATH}`)
    } else {
      console.error(`Error: ${error.message}`)
    }
    process.exit(1)
  }
}

// Reset command for CLI
cli
  .command('reset', 'Reset the browser connection for current session')
  .option('-s, --session <name>', 'Session name (required)')
  .option('--host <host>', 'Remote relay server host')
  .action(async (options: { session?: string; host?: string }) => {
    const cwd = process.cwd()
    const sessionId = options.session || process.env.PLAYWRITER_SESSION
    const serverHost = options.host || process.env.PLAYWRITER_HOST || '127.0.0.1'
    const serverUrl = `http://${serverHost}:${RELAY_PORT}`
    
    if (!options.host && !process.env.PLAYWRITER_HOST) {
      await ensureRelayServer({ logger: console })
    }
    
    if (!sessionId) {
      try {
        const res = await fetch(`${serverUrl}/cli/session/suggest`)
        const { next } = await res.json() as { next: number }
        console.error(`Error: -s/--session is required. Use -s ${next} for a new session.`)
      } catch {
        console.error(`Error: -s/--session is required. Use -s 1 for a new session.`)
      }
      process.exit(1)
    }
    
    try {
      const response = await fetch(`${serverUrl}/cli/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, cwd }),
      })
      
      if (!response.ok) {
        const text = await response.text()
        console.error(`Error: ${response.status} ${text}`)
        process.exit(1)
      }
      
      const result = await response.json() as { success: boolean; pageUrl: string; pagesCount: number }
      console.log(`Connection reset successfully. ${result.pagesCount} page(s) available. Current page URL: ${result.pageUrl}`)
    } catch (error: any) {
      console.error(`Error: ${error.message}`)
      process.exit(1)
    }
  })

cli
  .command('serve', 'Start the CDP relay server for remote MCP connections')
  .option('--host <host>', 'Host to bind to', { default: '0.0.0.0' })
  .option('--token <token>', 'Authentication token (or use PLAYWRITER_TOKEN env var)')
  .option('--replace', 'Kill existing server if running')
  .action(async (options: { host: string; token?: string; replace?: boolean }) => {
    const token = options.token || process.env.PLAYWRITER_TOKEN
    const isPublicHost = options.host === '0.0.0.0' || options.host === '::'
    if (isPublicHost && !token) {
      console.error('Error: Authentication token is required when binding to a public host.')
      console.error('Provide --token <token> or set PLAYWRITER_TOKEN environment variable.')
      process.exit(1)
    }

    // Check if server is already running on the port
    const net = await import('node:net')
    const isPortInUse = await new Promise<boolean>((resolve) => {
      const socket = new net.Socket()
      socket.setTimeout(500)
      socket.on('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.on('timeout', () => {
        socket.destroy()
        resolve(false)
      })
      socket.on('error', () => {
        resolve(false)
      })
      socket.connect(RELAY_PORT, '127.0.0.1')
    })

    if (isPortInUse) {
      if (!options.replace) {
        console.log(`Playwriter server is already running on port ${RELAY_PORT}`)
        console.log('Tip: Use --replace to kill the existing server and start a new one.')
        process.exit(0)
      }

      // Kill existing process on the port
      console.log(`Killing existing server on port ${RELAY_PORT}...`)
      const { killPortProcess } = await import('kill-port-process')
      await killPortProcess(RELAY_PORT)
    }

    // Lazy-load heavy dependencies only when serve command is used
    const { createFileLogger } = await import('./create-logger.js')
    const { startPlayWriterCDPRelayServer } = await import('./cdp-relay.js')
    
    const logger = createFileLogger()

    process.title = 'playwriter-serve'

    process.on('uncaughtException', async (err) => {
      await logger.error('Uncaught Exception:', err)
      process.exit(1)
    })

    process.on('unhandledRejection', async (reason) => {
      await logger.error('Unhandled Rejection:', reason)
      process.exit(1)
    })

    const server = await startPlayWriterCDPRelayServer({
      port: RELAY_PORT,
      host: options.host,
      token,
      logger,
    })

    console.log('Playwriter CDP relay server started')
    console.log(`  Host: ${options.host}`)
    console.log(`  Port: ${RELAY_PORT}`)
    console.log(`  Token: ${token ? '(configured)' : '(none)'}`)
    console.log(`  Logs: ${logger.logFilePath}`)
    console.log('')
    console.log(`CDP endpoint: http://${options.host}:${RELAY_PORT}${token ? '?token=<token>' : ''}`)
    console.log('')
    console.log('Press Ctrl+C to stop.')

    process.on('SIGINT', () => {
      console.log('\nShutting down...')
      server.close()
      process.exit(0)
    })

    process.on('SIGTERM', () => {
      console.log('\nShutting down...')
      server.close()
      process.exit(0)
    })
  })

cli.help()
cli.version(VERSION)

cli.parse()
