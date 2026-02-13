import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Playwriter Chrome extension IDs - used for validation and Chrome flag commands
export const EXTENSION_IDS = [
  'jfeammnjpkecdekppnclgkkffahnhfhe', // Production (Chrome Web Store)
  'pebbngnfojnignonigcnkdilknapkgid', // Dev extension (stable ID from manifest key)
]

// Playwriter Firefox extension IDs - UUID format as required by Firefox
// Firefox uses UUIDs for extension identification
export const FIREFOX_EXTENSION_IDS = [
  'playwriter@anthropic.com', // Production (Firefox Add-ons)
  '{deadbeef-dead-beef-dead-beefdeadbeef}', // Dev extension (stable ID for development)
]

// Combined extension IDs for both browsers
export const ALL_EXTENSION_IDS = [...EXTENSION_IDS, ...FIREFOX_EXTENSION_IDS]

export function getCdpUrl({
  port = 19988,
  host = '127.0.0.1',
  token,
  extensionId,
}: {
  port?: number
  host?: string
  token?: string
  extensionId?: string | null
} = {}) {
  const id = `${Math.random().toString(36).substring(2, 15)}_${Date.now()}`
  const params = new URLSearchParams()
  if (token) {
    params.set('token', token)
  }
  if (extensionId) {
    params.set('extensionId', extensionId)
  }
  const queryString = params.toString()
  const suffix = queryString ? `?${queryString}` : ''
  return `ws://${host}:${port}/cdp/${id}${suffix}`
}

// Use ~/.playwriter for logs so each OS user gets their own dir (avoids permission errors on shared machines, see #44)
const LOG_BASE_DIR = path.join(os.homedir(), '.playwriter')
export const LOG_FILE_PATH = process.env.PLAYWRITER_LOG_FILE_PATH || path.join(LOG_BASE_DIR, 'relay-server.log')
export const LOG_CDP_FILE_PATH = process.env.PLAYWRITER_CDP_LOG_FILE_PATH || path.join(path.dirname(LOG_FILE_PATH), 'cdp.jsonl')

const packageJsonPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json')
export const VERSION = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')).version as string

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
