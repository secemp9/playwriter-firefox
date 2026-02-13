/**
 * Browser type definitions and capability constants for multi-browser support.
 *
 * Chrome/Chromium: Full feature support via CDP relay and chrome.debugger API
 * Firefox: Native Playwright support (Juggler protocol), limited extension capabilities
 */

/**
 * Supported browser types.
 */
export type BrowserType = 'chromium' | 'firefox'

/**
 * Browser capabilities that vary between browser types.
 */
export interface BrowserCapabilities {
  /** Whether CDP relay via extension is supported */
  cdpRelay: boolean
  /** Whether tab capture is supported for screen recording */
  tabCapture: boolean
  /** Whether offscreen documents are supported (for MediaRecorder) */
  offscreenDocument: boolean
  /** Whether audio capture is supported during screen recording */
  audioCapture: boolean
  /** Default video output format */
  videoFormat: 'mp4' | 'webm'
  /** Whether recording requires user interaction each time */
  recordingRequiresInteraction: boolean
  /** Whether the browser has native Playwright protocol support */
  nativePlaywrightSupport: boolean
  /** Extension manifest version supported */
  manifestVersion: 2 | 3
  /** Whether chrome.debugger API is available */
  debuggerApi: boolean
  /** Whether chrome.identity API is available */
  identityApi: boolean
}

/**
 * Chromium browser capabilities.
 * Full feature support via CDP relay and Chrome extension APIs.
 */
export const CHROMIUM_CAPABILITIES: BrowserCapabilities = {
  cdpRelay: true,
  tabCapture: true,
  offscreenDocument: true,
  audioCapture: true,
  videoFormat: 'mp4',
  recordingRequiresInteraction: false,
  nativePlaywrightSupport: false,
  manifestVersion: 3,
  debuggerApi: true,
  identityApi: true,
}

/**
 * Firefox browser capabilities.
 * Limited extension capabilities, uses native Playwright Firefox support (Juggler protocol).
 */
export const FIREFOX_CAPABILITIES: BrowserCapabilities = {
  cdpRelay: false,
  tabCapture: false,
  offscreenDocument: false,
  audioCapture: false,
  videoFormat: 'webm',
  recordingRequiresInteraction: true,
  nativePlaywrightSupport: true,
  manifestVersion: 2,
  debuggerApi: false,
  identityApi: false,
}

/**
 * Get capabilities for a specific browser type.
 */
export function getBrowserCapabilities(browserType: BrowserType): BrowserCapabilities {
  switch (browserType) {
    case 'chromium':
      return CHROMIUM_CAPABILITIES
    case 'firefox':
      return FIREFOX_CAPABILITIES
    default:
      return CHROMIUM_CAPABILITIES
  }
}

/**
 * Get the current browser type from environment variable.
 * Defaults to 'chromium' if not specified.
 */
export function getCurrentBrowserType(): BrowserType {
  const envBrowserType = process.env.PLAYWRITER_BROWSER_TYPE?.toLowerCase()
  if (envBrowserType === 'firefox') {
    return 'firefox'
  }
  return 'chromium'
}

/**
 * Check if the current browser type is Firefox.
 */
export function isFirefox(): boolean {
  return getCurrentBrowserType() === 'firefox'
}

/**
 * Check if the current browser type is Chromium-based.
 */
export function isChromium(): boolean {
  return getCurrentBrowserType() === 'chromium'
}
