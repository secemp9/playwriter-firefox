import fs from 'node:fs'
import os from 'node:os'
import type { BrowserType } from './browser-types.js'

/**
 * Get the current browser type from environment variable.
 * Defaults to 'chromium' if not specified.
 */
export function getBrowserType(): BrowserType {
  const envBrowserType = process.env.PLAYWRITER_BROWSER_TYPE?.toLowerCase()
  if (envBrowserType === 'firefox') {
    return 'firefox'
  }
  return 'chromium'
}

// Function to get the browser executable path
// Can be overridden by environment variable PLAYWRITER_BROWSER_PATH
// Respects PLAYWRITER_BROWSER_TYPE for Firefox vs Chrome selection
export function getBrowserExecutablePath(): string {
  // Check environment variable first
  const envPath = process.env.PLAYWRITER_BROWSER_PATH
  if (envPath && fs.existsSync(envPath)) {
    return envPath
  }

  // Check browser type and find appropriate executable
  const browserType = getBrowserType()
  if (browserType === 'firefox') {
    return findFirefoxExecutablePath()
  }

  // Fall back to finding Chrome
  return findChromeExecutablePath()
}

// Original Chrome finding logic
function findChromeExecutablePath(): string {
  const osPlatform = os.platform()
  const paths = (() => {
    if (osPlatform === 'darwin') {
      return [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '~/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      ]
    }
    if (osPlatform === 'win32') {
      return [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
      ].filter(Boolean)
    }
    // Linux
    return [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
    ]
  })()

  for (const path of paths) {
    const resolvedPath = path.startsWith('~') ? path.replace('~', os.homedir()) : path
    if (fs.existsSync(resolvedPath)) {
      return resolvedPath
    }
  }

  throw new Error(
    'Could not find Chrome executable. Please install Google Chrome or set PLAYWRITER_BROWSER_PATH environment variable.',
  )
}

// Firefox executable path finding logic
export function findFirefoxExecutablePath(): string {
  const osPlatform = os.platform()
  const paths = (() => {
    if (osPlatform === 'darwin') {
      return [
        '/Applications/Firefox.app/Contents/MacOS/firefox',
        '/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox',
        '/Applications/Firefox Nightly.app/Contents/MacOS/firefox',
        '~/Applications/Firefox.app/Contents/MacOS/firefox',
      ]
    }
    if (osPlatform === 'win32') {
      return [
        'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
        'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe',
        `${process.env.LOCALAPPDATA}\\Mozilla Firefox\\firefox.exe`,
        `${process.env.PROGRAMFILES}\\Mozilla Firefox\\firefox.exe`,
        `${process.env['PROGRAMFILES(X86)']}\\Mozilla Firefox\\firefox.exe`,
      ].filter(Boolean)
    }
    // Linux
    return [
      '/usr/bin/firefox',
      '/usr/bin/firefox-esr',
      '/snap/bin/firefox',
      '/usr/lib/firefox/firefox',
      '/opt/firefox/firefox',
    ]
  })()

  for (const path of paths) {
    const resolvedPath = path.startsWith('~') ? path.replace('~', os.homedir()) : path
    if (fs.existsSync(resolvedPath)) {
      return resolvedPath
    }
  }

  throw new Error(
    'Could not find Firefox executable. Please install Mozilla Firefox or set PLAYWRITER_BROWSER_PATH environment variable.',
  )
}
