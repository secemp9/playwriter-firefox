/**
 * Screen recording utility for playwriter using chrome.tabCapture.
 * Recording happens in the extension context, so it survives page navigation.
 * 
 * This module communicates with the relay server which forwards commands to the extension.
 */

import type { Page } from 'playwright-core'
import type { StartRecordingResult, StopRecordingResult, IsRecordingResult, CancelRecordingResult } from './protocol.js'

export interface StartRecordingOptions {
  /** Target page to record */
  page: Page
  /** Frame rate (default: 30) */
  frameRate?: number
  /** Video bitrate in bps (default: 2500000 = 2.5 Mbps) */
  videoBitsPerSecond?: number
  /** Audio bitrate in bps (default: 128000 = 128 kbps) */
  audioBitsPerSecond?: number
  /** Include audio from tab (default: false) */
  audio?: boolean
  /** Path to save the video file */
  outputPath: string
  /** Relay server port (default: 19988) */
  relayPort?: number
}

export interface StopRecordingOptions {
  /** Target page that is being recorded */
  page: Page
  /** Relay server port (default: 19988) */
  relayPort?: number
}

export interface RecordingState {
  isRecording: boolean
  startedAt?: number
  tabId?: number
}

function getSessionId(page: Page): string | undefined {
  // The page's _guid is Playwright-internal and doesn't match the extension's sessionId (pw-tab-X).
  // For now, we don't pass sessionId and let the extension use the first connected tab.
  // TODO: Add proper mapping between page and extension tab sessionIds
  return undefined
}

/**
 * Start recording the page.
 * The recording is handled by the extension, so it survives page navigation.
 */
export async function startRecording(options: StartRecordingOptions): Promise<RecordingState> {
  const {
    page,
    frameRate = 30,
    videoBitsPerSecond = 2500000,
    audioBitsPerSecond = 128000,
    audio = false,
    outputPath,
    relayPort = 19988,
  } = options

  const sessionId = getSessionId(page)
  
  const response = await fetch(`http://127.0.0.1:${relayPort}/recording/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      frameRate,
      videoBitsPerSecond,
      audioBitsPerSecond,
      audio,
      outputPath,
    }),
  })

  const result = await response.json() as StartRecordingResult

  if (!result.success) {
    throw new Error(`Failed to start recording: ${result.error}`)
  }

  return {
    isRecording: true,
    startedAt: result.startedAt,
    tabId: result.tabId,
  }
}

/**
 * Stop recording and save to file.
 * Returns the path to the saved video file.
 */
export async function stopRecording(options: StopRecordingOptions): Promise<{ path: string; duration: number; size: number }> {
  const { page, relayPort = 19988 } = options

  const sessionId = getSessionId(page)

  const response = await fetch(`http://127.0.0.1:${relayPort}/recording/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  })

  const result = await response.json() as StopRecordingResult

  if (!result.success) {
    throw new Error(`Failed to stop recording: ${result.error}`)
  }

  return {
    path: result.path,
    duration: result.duration,
    size: result.size,
  }
}

/**
 * Check if recording is currently active on a page.
 */
export async function isRecording(options: { page: Page; relayPort?: number }): Promise<RecordingState> {
  const { page, relayPort = 19988 } = options

  const sessionId = getSessionId(page)

  const response = await fetch(`http://127.0.0.1:${relayPort}/recording/status?sessionId=${sessionId || ''}`)
  const result = await response.json() as IsRecordingResult

  return {
    isRecording: result.isRecording,
    startedAt: result.startedAt,
    tabId: result.tabId,
  }
}

/**
 * Cancel recording without saving.
 */
export async function cancelRecording(options: { page: Page; relayPort?: number }): Promise<void> {
  const { page, relayPort = 19988 } = options

  const sessionId = getSessionId(page)

  const response = await fetch(`http://127.0.0.1:${relayPort}/recording/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  })

  const result = await response.json() as CancelRecordingResult

  if (!result.success) {
    throw new Error(`Failed to cancel recording: ${result.error}`)
  }
}
