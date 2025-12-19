import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { xdgData } from 'xdg-basedir'

export function getCdpUrl({ port = 19988, host = '127.0.0.1' }: { port?: number; host?: string } = {}) {
  const id = `${Math.random().toString(36).substring(2, 15)}_${Date.now()}`
  return `ws://${host}:${port}/cdp/${id}`
}

export function getDataDir(): string {
  const dataDir = xdgData || path.join(os.homedir(), '.local', 'share')
  return path.join(dataDir, 'playwriter')
}

export function ensureDataDir(): string {
  const dataDir = getDataDir()
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }
  return dataDir
}

function getLogsDir(): string {
  return path.join(getDataDir(), 'logs')
}

function getLogFilePath(): string {
  if (process.env.PLAYWRITER_LOG_PATH) {
    return process.env.PLAYWRITER_LOG_PATH
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  return path.join(getLogsDir(), `relay-server-${timestamp}.log`)
}

export const LOG_FILE_PATH = getLogFilePath()

// export function getDidPromptReviewPath(): string {
//   return path.join(getDataDir(), 'did-prompt-review')
// }

// export function hasReviewedPrompt(): boolean {
//   return fs.existsSync(getDidPromptReviewPath())
// }

// export function markPromptReviewed(): void {
//   ensureDataDir()
//   fs.writeFileSync(getDidPromptReviewPath(), new Date().toISOString())
// }
