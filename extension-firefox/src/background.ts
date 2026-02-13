/**
 * Firefox extension background script.
 *
 * Key differences from Chrome extension:
 * - No chrome.debugger API - uses native messaging debug bridge instead
 * - No chrome.tabCapture - Recording uses getDisplayMedia() with user picker
 * - No offscreen documents - Recording is handled via popup
 *
 * This extension handles:
 * 1. WebSocket connection to relay server for coordination
 * 2. Screen recording via popup (getDisplayMedia)
 * 3. Debug bridge via native messaging (connects to Firefox RDP/BiDi)
 */

declare const process: { env: { PLAYWRITER_PORT: string } }

import browser from 'webextension-polyfill'
import type {
  ExtensionState,
  RecordingState,
  RecordingInfo,
  PopupMessage,
  PopupResponse,
} from './types'
import { DebuggerProxy, debuggerProxy } from './debugger-proxy'

const RELAY_HOST = '127.0.0.1'
const RELAY_PORT = Number(process.env.PLAYWRITER_PORT) || 19988

// Extension state
let state: ExtensionState = {
  recording: { isRecording: false },
  connectionState: 'idle',
}

// Active recording info (not serializable, kept separate)
let activeRecording: RecordingInfo | null = null

// WebSocket connection to relay server
let ws: WebSocket | null = null
let connectionPromise: Promise<void> | null = null

// Recording chunk buffer for when WebSocket isn't ready
const recordingChunkBuffer: Array<{ tabId: number; data?: number[]; final?: boolean }> = []

/**
 * Logger that also sends to relay server.
 */
const logger = {
  log: (...args: unknown[]) => {
    console.log('[Playwriter Firefox]', ...args)
    sendLogToRelay('log', args)
  },
  debug: (...args: unknown[]) => {
    console.debug('[Playwriter Firefox]', ...args)
    sendLogToRelay('debug', args)
  },
  warn: (...args: unknown[]) => {
    console.warn('[Playwriter Firefox]', ...args)
    sendLogToRelay('warn', args)
  },
  error: (...args: unknown[]) => {
    console.error('[Playwriter Firefox]', ...args)
    sendLogToRelay('error', args)
  },
}

function sendLogToRelay(level: string, args: unknown[]): void {
  if (ws?.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({
        method: 'log',
        params: { level, args: args.map(arg => String(arg)) },
      }))
    } catch {
      // Ignore errors during logging
    }
  }
}

/**
 * Send a message through WebSocket to relay server.
 */
function sendMessage(message: unknown): void {
  if (ws?.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(message))
    } catch (error) {
      console.debug('[Playwriter Firefox] Error sending message:', error)
    }
  }
}

/**
 * Flush buffered recording chunks when WebSocket becomes ready.
 */
function flushRecordingChunkBuffer(): void {
  if (recordingChunkBuffer.length === 0) return

  logger.debug(`Flushing ${recordingChunkBuffer.length} buffered recording chunks`)

  while (recordingChunkBuffer.length > 0) {
    const chunk = recordingChunkBuffer.shift()!
    const { tabId, data, final } = chunk

    // Send metadata message
    sendMessage({
      method: 'recordingData',
      params: { tabId, final },
    })

    // Send binary data if not final
    if (data && !final && ws?.readyState === WebSocket.OPEN) {
      const buffer = new Uint8Array(data)
      ws.send(buffer)
    }
  }
}

/**
 * Ensure WebSocket connection to relay server.
 */
async function ensureConnection(): Promise<void> {
  if (ws?.readyState === WebSocket.OPEN) {
    return
  }

  if (connectionPromise) {
    return connectionPromise
  }

  connectionPromise = connect()

  try {
    await connectionPromise
  } finally {
    connectionPromise = null
  }
}

/**
 * Connect to relay server.
 */
async function connect(): Promise<void> {
  logger.debug(`Connecting to relay server at ws://${RELAY_HOST}:${RELAY_PORT}...`)

  // Check if server is available
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await fetch(`http://${RELAY_HOST}:${RELAY_PORT}`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(2000)
      })
      logger.debug('Relay server is available')
      break
    } catch {
      if (attempt === 4) {
        throw new Error('Relay server not available')
      }
      logger.debug(`Server not available, retrying... (attempt ${attempt + 1}/5)`)
      await new Promise(r => setTimeout(r, 1000))
    }
  }

  // Connect WebSocket
  const relayUrl = `ws://${RELAY_HOST}:${RELAY_PORT}/extension-firefox`
  const socket = new WebSocket(relayUrl)

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      socket.close()
      reject(new Error('WebSocket connection timeout'))
    }, 5000)

    socket.onopen = () => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      logger.debug('WebSocket connected')
      flushRecordingChunkBuffer()
      resolve()
    }

    socket.onerror = (event) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(new Error('WebSocket connection failed'))
    }

    socket.onclose = (event) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(new Error(`WebSocket closed: ${event.reason || event.code}`))
    }
  })

  ws = socket

  ws.onmessage = async (event: MessageEvent) => {
    try {
      const message = JSON.parse(event.data as string)

      if (message.method === 'ping') {
        sendMessage({ method: 'pong' })
        return
      }

      // Handle debug bridge commands
      if (message.method?.startsWith('debugBridge.')) {
        const response = await handleDebugCommand(message)
        sendMessage(response)
        return
      }

      // Handle recording commands from relay server
      if (message.method === 'startRecording') {
        // Firefox requires user interaction - send response indicating popup needed
        sendMessage({
          id: message.id,
          result: {
            success: false,
            error: 'Firefox requires user interaction for screen recording. Click the extension popup to start recording.',
            requiresPopup: true,
          },
        })
        return
      }

      if (message.method === 'stopRecording') {
        const result = await handleStopRecording()
        sendMessage({ id: message.id, result })
        return
      }

      if (message.method === 'isRecording') {
        sendMessage({
          id: message.id,
          result: {
            isRecording: state.recording.isRecording,
            tabId: state.recording.tabId,
            startedAt: state.recording.startedAt,
          },
        })
        return
      }

      if (message.method === 'cancelRecording') {
        const result = await handleCancelRecording()
        sendMessage({ id: message.id, result })
        return
      }

      logger.debug('Unhandled message:', message.method)
    } catch (error) {
      logger.error('Error handling message:', error)
    }
  }

  ws.onclose = (event) => {
    logger.warn(`WebSocket closed: code=${event.code} reason=${event.reason || 'none'}`)
    ws = null
    state.connectionState = 'idle'

    // Cancel any active recording
    if (activeRecording) {
      cleanupRecording()
    }
  }

  ws.onerror = (event) => {
    logger.error('WebSocket error:', event)
  }

  state.connectionState = 'connected'
}

/**
 * Maintain WebSocket connection loop.
 */
async function maintainConnection(): Promise<void> {
  while (true) {
    if (ws?.readyState === WebSocket.OPEN) {
      await new Promise(r => setTimeout(r, 1000))
      continue
    }

    try {
      await ensureConnection()
    } catch (error) {
      logger.debug('Connection attempt failed:', error)
      state.connectionState = 'idle'
    }

    await new Promise(r => setTimeout(r, 3000))
  }
}

/**
 * Handle stop recording request.
 */
async function handleStopRecording(): Promise<{ success: boolean; tabId?: number; duration?: number; error?: string }> {
  if (!activeRecording) {
    return { success: false, error: 'No active recording' }
  }

  const { tabId, startedAt, recorder, stream } = activeRecording
  const duration = Date.now() - startedAt

  try {
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    }
    if (stream) {
      stream.getTracks().forEach(track => track.stop())
    }

    cleanupRecording()
    return { success: true, tabId, duration }
  } catch (error) {
    logger.error('Failed to stop recording:', error)
    cleanupRecording()
    return { success: false, error: String(error) }
  }
}

/**
 * Handle cancel recording request.
 */
async function handleCancelRecording(): Promise<{ success: boolean; error?: string }> {
  if (!activeRecording) {
    return { success: true }
  }

  const { tabId, recorder, stream } = activeRecording

  try {
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    }
    if (stream) {
      stream.getTracks().forEach(track => track.stop())
    }

    // Notify relay server
    sendMessage({
      method: 'recordingCancelled',
      params: { tabId },
    })

    cleanupRecording()
    return { success: true }
  } catch (error) {
    logger.error('Failed to cancel recording:', error)
    cleanupRecording()
    return { success: false, error: String(error) }
  }
}

/**
 * Clean up recording state.
 */
function cleanupRecording(): void {
  activeRecording = null
  state.recording = { isRecording: false }
  updateIcon(false)
}

/**
 * Update extension icon based on recording state.
 */
function updateIcon(isRecording: boolean): void {
  const iconPath = isRecording
    ? {
        '16': 'icons/icon-green-16.png',
        '32': 'icons/icon-green-32.png',
        '48': 'icons/icon-green-48.png',
        '128': 'icons/icon-green-128.png',
      }
    : {
        '16': 'icons/icon-gray-16.png',
        '32': 'icons/icon-gray-32.png',
        '48': 'icons/icon-gray-48.png',
        '128': 'icons/icon-gray-128.png',
      }

  browser.browserAction.setIcon({ path: iconPath })
  browser.browserAction.setTitle({
    title: isRecording ? 'Recording... Click to stop' : 'Click to start recording',
  })
}

/**
 * Start recording from popup.
 * Called when user clicks the popup button.
 */
export async function startRecordingFromPopup(
  stream: MediaStream,
  tabId: number
): Promise<{ success: boolean; error?: string }> {
  if (activeRecording) {
    return { success: false, error: 'Recording already in progress' }
  }

  try {
    await ensureConnection()

    const mimeType = 'video/webm;codecs=vp8'
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 2500000,
    })

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        event.data.arrayBuffer().then((buffer) => {
          const data = Array.from(new Uint8Array(buffer))

          if (ws?.readyState === WebSocket.OPEN) {
            sendMessage({
              method: 'recordingData',
              params: { tabId, final: false },
            })
            ws.send(new Uint8Array(data))
          } else {
            recordingChunkBuffer.push({ tabId, data, final: false })
          }
        })
      }
    }

    recorder.onstop = () => {
      // Send final marker
      if (ws?.readyState === WebSocket.OPEN) {
        sendMessage({
          method: 'recordingData',
          params: { tabId, final: true },
        })
      } else {
        recordingChunkBuffer.push({ tabId, final: true })
      }
    }

    recorder.onerror = (event) => {
      logger.error('MediaRecorder error:', event)
      cleanupRecording()
    }

    const startedAt = Date.now()
    activeRecording = { tabId, startedAt, stream, recorder }

    // Start recording with timeslice for chunked data
    recorder.start(1000)

    state.recording = { isRecording: true, startedAt, tabId }
    updateIcon(true)

    logger.debug('Recording started for tab:', tabId)
    return { success: true }
  } catch (error) {
    logger.error('Failed to start recording:', error)
    return { success: false, error: String(error) }
  }
}

/**
 * Handle messages from popup.
 */
browser.runtime.onMessage.addListener(
  (message: unknown): Promise<PopupResponse> | undefined => {
    const msg = message as PopupMessage

    if (msg.action === 'getStatus') {
      return Promise.resolve({
        success: true,
        isRecording: state.recording.isRecording,
      })
    }

    if (msg.action === 'stopRecording') {
      return handleStopRecording().then((result) => ({
        success: result.success,
        error: result.error,
      }))
    }

    return undefined
  }
)

// Debug bridge state
let debugBridgeConnected = false

/**
 * Initialize debug bridge connection.
 */
async function initDebugBridge(): Promise<void> {
  try {
    debuggerProxy.on('connected', () => {
      logger.debug('Debug bridge connected to Firefox')
      debugBridgeConnected = true
      // Notify relay server
      sendMessage({
        method: 'debugBridgeStatus',
        params: { connected: true, protocol: debuggerProxy.getProtocol() },
      })
    })

    debuggerProxy.on('disconnected', () => {
      logger.debug('Debug bridge disconnected')
      debugBridgeConnected = false
      sendMessage({
        method: 'debugBridgeStatus',
        params: { connected: false },
      })
    })

    debuggerProxy.on('error', (error) => {
      logger.error('Debug bridge error:', error)
    })

    debuggerProxy.on('console', (data) => {
      // Forward console logs to relay server
      sendMessage({
        method: 'consoleMessage',
        params: data,
      })
    })

    logger.debug('Debug bridge initialized')
  } catch (error) {
    logger.error('Failed to initialize debug bridge:', error)
  }
}

/**
 * Handle debug commands from relay server.
 */
async function handleDebugCommand(message: any): Promise<any> {
  const { method, params, id } = message

  try {
    switch (method) {
      case 'debugBridge.connect': {
        const result = await debuggerProxy.connect({
          protocol: params?.protocol || 'bidi',
          port: params?.port,
          host: params?.host,
        })
        return { id, result: { success: true, ...result } }
      }

      case 'debugBridge.disconnect': {
        await debuggerProxy.disconnect()
        return { id, result: { success: true } }
      }

      case 'debugBridge.listTabs': {
        const tabs = await debuggerProxy.listTabs()
        return { id, result: { success: true, tabs } }
      }

      case 'debugBridge.evaluate': {
        const result = await debuggerProxy.evaluate(params.tabId, params.expression)
        return { id, result: { success: true, value: result } }
      }

      case 'debugBridge.navigate': {
        await debuggerProxy.navigate(params.tabId, params.url)
        return { id, result: { success: true } }
      }

      case 'debugBridge.reload': {
        await debuggerProxy.reload(params.tabId)
        return { id, result: { success: true } }
      }

      case 'debugBridge.screenshot': {
        const screenshot = await debuggerProxy.screenshot(params.tabId)
        return { id, result: { success: true, screenshot } }
      }

      case 'debugBridge.status': {
        return {
          id,
          result: {
            success: true,
            connected: debuggerProxy.isConnected(),
            protocol: debuggerProxy.getProtocol(),
          },
        }
      }

      default:
        return { id, error: `Unknown debug command: ${method}` }
    }
  } catch (error) {
    return { id, error: String(error) }
  }
}

// Initialize debug bridge
initDebugBridge()

// Start connection maintenance loop
maintainConnection()

// Update icons on startup
updateIcon(false)

logger.debug(`Firefox extension started. Relay: ${RELAY_HOST}:${RELAY_PORT}`)

// Export for popup and debugging
;(globalThis as any).startRecordingFromPopup = startRecordingFromPopup
;(globalThis as any).debuggerProxy = debuggerProxy
