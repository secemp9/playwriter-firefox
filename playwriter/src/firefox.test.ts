/**
 * Firefox-specific tests for Playwriter.
 *
 * These tests verify that Firefox support works correctly with Playwright's native
 * Juggler protocol. Firefox does NOT use the CDP relay (no chrome.debugger equivalent),
 * but the extension can still be used for screen recording.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { firefox, BrowserContext, Browser } from '@xmorse/playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  setupTestContext,
  cleanupTestContext,
  isFirefoxTest,
  isChromiumTest,
  type TestContext,
} from './test-utils.js'
import { startPlayWriterCDPRelayServer, type RelayServer } from './cdp-relay.js'
import { createFileLogger } from './create-logger.js'
import { killPortProcess } from './kill-port.js'

const TEST_PORT_BROWSER = 19985
const TEST_PORT_RELAY = 19986

// Skip Firefox Native Support Tests - Playwright/Firefox version compatibility issue
// The Playwright version has Browser.setContrast which isn't supported by the bundled Firefox
// TODO: Re-enable when Playwright and Firefox versions are compatible
describe.skip('Firefox Native Support Tests', () => {
  let browserContext: BrowserContext | null = null
  let browser: Browser | null = null

  beforeAll(async () => {
    browser = await firefox.launch({
      headless: !process.env.HEADFUL,
      firefoxUserPrefs: {
        'devtools.debugger.remote-enabled': true,
        'devtools.chrome.enabled': true,
      },
    })
    browserContext = await browser.newContext()
    console.log('Firefox browser launched for tests')
  }, 120000)

  afterAll(async () => {
    if (browserContext) {
      await browserContext.close()
    }
    if (browser) {
      await browser.close()
    }
  })

  const getBrowserContext = () => {
    if (!browserContext) throw new Error('Browser not initialized')
    return browserContext
  }

  it('should connect to Firefox using native Playwright support', async () => {
    const browserContext = getBrowserContext()
    expect(browserContext).toBeDefined()

    // Verify we can get pages
    const pages = browserContext.pages()
    expect(pages).toBeDefined()
  })

  it('should be able to create new pages', async () => {
    const browserContext = getBrowserContext()
    const page = await browserContext.newPage()

    expect(page).toBeDefined()
    expect(page.isClosed()).toBe(false)

    await page.close()
  })

  it('should navigate to URLs correctly', async () => {
    const browserContext = getBrowserContext()
    const page = await browserContext.newPage()

    await page.goto('data:text/html,<h1>Hello Firefox</h1>')
    const title = await page.title()
    expect(title).toBe('')  // data URLs have empty titles

    const content = await page.textContent('h1')
    expect(content).toBe('Hello Firefox')

    await page.close()
  })

  it('should execute JavaScript in page', async () => {
    const browserContext = getBrowserContext()
    const page = await browserContext.newPage()

    await page.goto('data:text/html,<div id="test">Initial</div>')

    const result = await page.evaluate(() => {
      const el = document.getElementById('test')
      if (el) {
        el.textContent = 'Modified'
      }
      return el?.textContent
    })

    expect(result).toBe('Modified')
    await page.close()
  })

  it('should handle forms correctly', async () => {
    const browserContext = getBrowserContext()
    const page = await browserContext.newPage()

    const html = `
      <html>
      <body>
        <form id="testForm">
          <input type="text" id="name" name="name">
          <input type="email" id="email" name="email">
          <button type="submit">Submit</button>
        </form>
      </body>
      </html>
    `
    await page.goto(`data:text/html,${encodeURIComponent(html)}`)

    await page.fill('#name', 'Test User')
    await page.fill('#email', 'test@example.com')

    const nameValue = await page.inputValue('#name')
    const emailValue = await page.inputValue('#email')

    expect(nameValue).toBe('Test User')
    expect(emailValue).toBe('test@example.com')

    await page.close()
  })

  it('should capture screenshots', async () => {
    const browserContext = getBrowserContext()
    const page = await browserContext.newPage()

    await page.goto('data:text/html,<h1 style="color: red;">Screenshot Test</h1>')

    const screenshot = await page.screenshot()
    expect(screenshot).toBeInstanceOf(Buffer)
    expect(screenshot.length).toBeGreaterThan(0)

    await page.close()
  })

  it('should handle multiple pages', async () => {
    const browserContext = getBrowserContext()

    const page1 = await browserContext.newPage()
    const page2 = await browserContext.newPage()
    const page3 = await browserContext.newPage()

    await page1.goto('data:text/html,Page 1')
    await page2.goto('data:text/html,Page 2')
    await page3.goto('data:text/html,Page 3')

    const pages = browserContext.pages()
    expect(pages.length).toBeGreaterThanOrEqual(3)

    await page1.close()
    await page2.close()
    await page3.close()
  })

  it('should handle color scheme query', async () => {
    const browserContext = getBrowserContext()
    const page = await browserContext.newPage()

    await page.goto('data:text/html,<div id="result"></div>')

    // Firefox should report system color scheme
    const colorScheme = await page.evaluate(() => {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    })

    // Should be either 'dark' or 'light' depending on system settings
    expect(['dark', 'light']).toContain(colorScheme)

    await page.close()
  })

  it('should properly report browser type as firefox', async () => {
    expect(isFirefoxTest()).toBe(true)
    expect(isChromiumTest()).toBe(false)
  })
})

// Tests for Firefox relay server endpoints
describe.skipIf(isChromiumTest())('Firefox Relay Server Integration', () => {
  let relayServer: RelayServer | null = null

  beforeAll(async () => {
    await killPortProcess({ port: TEST_PORT_RELAY }).catch(() => {})

    const localLogPath = path.join(process.cwd(), 'relay-server-firefox.log')
    const logger = createFileLogger({ logFilePath: localLogPath })
    relayServer = await startPlayWriterCDPRelayServer({ port: TEST_PORT_RELAY, logger })
    console.log(`Relay server started on port ${TEST_PORT_RELAY}`)
  }, 30000)

  afterAll(async () => {
    if (relayServer) {
      relayServer.close()
    }
  })

  it('should have relay server running', async () => {
    // Basic health check
    const response = await fetch(`http://127.0.0.1:${TEST_PORT_RELAY}/`, {
      signal: AbortSignal.timeout(2000),
    })
    expect(response.ok).toBe(true)
  })

  it('should return Firefox debug status (no extension connected)', async () => {
    // When running tests without the extension actually connected,
    // we should get a response indicating no connection
    const response = await fetch(`http://127.0.0.1:${TEST_PORT_RELAY}/firefox/debug/status`, {
      signal: AbortSignal.timeout(2000),
    })
    expect(response.ok).toBe(true)

    const data = await response.json() as { extensionConnected?: boolean }
    // Without the extension being loaded and connected, these should be false
    expect(data).toHaveProperty('extensionConnected')
    expect(typeof data.extensionConnected).toBe('boolean')
  })

  it('should handle Firefox version endpoint', async () => {
    const response = await fetch(`http://127.0.0.1:${TEST_PORT_RELAY}/version`, {
      signal: AbortSignal.timeout(2000),
    })
    expect(response.ok).toBe(true)

    const data = await response.json() as { version?: string }
    expect(data).toHaveProperty('version')
  })
})
