import { createMCPClient } from './mcp-client.js'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { chromium } from 'playwright-core'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

import { spawn } from 'node:child_process'

const execAsync = promisify(exec)

function js(strings: TemplateStringsArray, ...values: any[]): string {
    return strings.reduce(
        (result, str, i) => result + str + (values[i] || ''),
        '',
    )
}

async function killProcessOnPort(port: number): Promise<void> {
    try {
        const { stdout } = await execAsync(`lsof -ti:${port}`)
        const pid = stdout.trim()
        if (pid) {
            await execAsync(`kill -9 ${pid}`)
            console.log(`Killed process ${pid} on port ${port}`)
            await new Promise((resolve) => setTimeout(resolve, 500))
        }
    } catch (error) {
        // No process running on port or already killed
    }
}

describe('MCP Server Tests', () => {
    let client: Awaited<ReturnType<typeof createMCPClient>>['client']
    let cleanup: (() => Promise<void>) | null = null
    let browserContext: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | null = null
    let userDataDir: string
    let relayServerProcess: any

    beforeAll(async () => {
        await killProcessOnPort(19988)

        // Build extension
        console.log('Building extension...')
        await execAsync('pnpm build', { cwd: '../extension' })
        console.log('Extension built')

        // Start Relay Server manually
        relayServerProcess = spawn('pnpm', ['tsx', 'src/start-relay-server.ts'], {
            cwd: process.cwd(),
            stdio: 'inherit'
        })
        
        // Wait for port 19988 to be ready
        await new Promise<void>((resolve, reject) => {
             let retries = 0
             const interval = setInterval(async () => {
                 try {
                     const { stdout } = await execAsync('lsof -ti:19988')
                     if (stdout.trim()) {
                         clearInterval(interval)
                         resolve()
                     }
                 } catch {
                     // ignore
                 }
                 retries++
                 if (retries > 30) {
                     clearInterval(interval)
                     reject(new Error('Relay server failed to start'))
                 }
             }, 1000)
        })
        
        const result = await createMCPClient()
        client = result.client
        cleanup = result.cleanup

        userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-test-'))
        const extensionPath = path.resolve('../extension/dist')

        browserContext = await chromium.launchPersistentContext(userDataDir, {
            headless: false,
            args: [
                `--disable-extensions-except=${extensionPath}`,
                `--load-extension=${extensionPath}`,
            ],
        })

        // Wait for service worker and connect
        let serviceWorker = browserContext.serviceWorkers()[0]
        if (!serviceWorker) {
            serviceWorker = await browserContext.waitForEvent('serviceworker')
        }

        // Create a page to attach to
        const page = await browserContext.newPage()
        await page.goto('about:blank')
        
        // Connect the tab
        await serviceWorker.evaluate(async () => {
             // @ts-ignore
             await globalThis.toggleExtensionForActiveTab()
        })

    }, 120000) // 2 minutes timeout

    afterAll(async () => {
        if (browserContext) {
            await browserContext.close()
        }
        if (relayServerProcess) {
            relayServerProcess.kill()
        }
        await killProcessOnPort(19988)
        
        if (userDataDir) {
             try {
                fs.rmSync(userDataDir, { recursive: true, force: true })
            } catch (e) {
                console.error('Failed to cleanup user data dir:', e)
            }
        }
        if (cleanup) {
            await cleanup()
            cleanup = null
        }
    })

    it('should execute code and capture console output', async () => {
        await client.callTool({
            name: 'execute',
            arguments: {
                code: js`
          const newPage = await context.newPage();
          state.page = newPage;
          if (!state.pages) state.pages = [];
          state.pages.push(newPage);
        `,
            },
        })

        const result = await client.callTool({
            name: 'execute',
            arguments: {
                code: js`
          await state.page.goto('https://news.ycombinator.com');
          const title = await state.page.title();
          console.log('Page title:', title);
          return { url: state.page.url(), title };
        `,
            },
        })
        expect(result.content).toMatchInlineSnapshot(`
          [
            {
              "text": "Console output:
          [log] Page title: Hacker News

          Return value:
          {
            "url": "https://news.ycombinator.com/",
            "title": "Hacker News"
          }",
              "type": "text",
            },
          ]
        `)
        expect(result.content).toBeDefined()
    }, 30000)

    it('should get accessibility snapshot of hacker news', async () => {
        await client.callTool({
            name: 'execute',
            arguments: {
                code: js`
          const newPage = await context.newPage();
          state.page = newPage;
          if (!state.pages) state.pages = [];
          state.pages.push(newPage);
        `,
            },
        })

        const result = await client.callTool({
            name: 'execute',
            arguments: {
                code: js`
          await state.page.goto('https://news.ycombinator.com/item?id=1', { waitUntil: 'networkidle' });
          const snapshot = await state.page._snapshotForAI();
          return snapshot;
        `,
            },
        })

        const initialData =
            typeof result === 'object' && result.content?.[0]?.text
                ? tryJsonParse(result.content[0].text)
                : result
        await expect(initialData).toMatchFileSnapshot(
            'snapshots/hacker-news-initial-accessibility.md',
        )
        expect(result.content).toBeDefined()
        expect(initialData).toContain('table')
        expect(initialData).toContain('Hacker News')
    }, 30000)

    it('should get accessibility snapshot of shadcn UI', async () => {
        await client.callTool({
            name: 'execute',
            arguments: {
                code: js`
          const newPage = await context.newPage();
          state.page = newPage;
          if (!state.pages) state.pages = [];
          state.pages.push(newPage);
        `,
            },
        })

        const snapshot = await client.callTool({
            name: 'execute',
            arguments: {
                code: js`
          await state.page.goto('https://ui.shadcn.com/', { waitUntil: 'networkidle' });
          const snapshot = await state.page._snapshotForAI();
          return snapshot;
        `,
            },
        })

        const data =
            typeof snapshot === 'object' && snapshot.content?.[0]?.text
                ? tryJsonParse(snapshot.content[0].text)
                : snapshot
        await expect(data).toMatchFileSnapshot('snapshots/shadcn-ui-accessibility.md')
        expect(snapshot.content).toBeDefined()
        expect(data).toContain('shadcn')
    }, 30000)

    it('should close all created pages', async () => {
        const result = await client.callTool({
            name: 'execute',
            arguments: {
                code: js`
          if (state.pages && state.pages.length > 0) {
            for (const page of state.pages) {
              await page.close();
            }
            const closedCount = state.pages.length;
            state.pages = [];
            return { closedCount };
          }
          return { closedCount: 0 };
        `,
            },
        })

    })

    it('should handle new pages and toggling', async () => {
        if (!browserContext) throw new Error('Browser not initialized')
        
        // Find the correct service worker by URL
        const extensionPath = path.resolve('../extension/dist')
        let serviceWorker = browserContext.serviceWorkers().find(sw => sw.url().startsWith('chrome-extension://'))
        
        if (!serviceWorker) {
            serviceWorker = await browserContext.waitForEvent('serviceworker', {
                predicate: (sw) => sw.url().startsWith('chrome-extension://')
            })
        }

        // 1. Create a new page
        const page = await browserContext.newPage()
        const testUrl = 'https://example.com/'
        await page.goto(testUrl)
        await page.bringToFront()
        
        // 2. Enable extension on this new tab
        // Since it's a new page, extension is not connected yet
        const result = await serviceWorker.evaluate(async () => {
            // @ts-ignore
            return await globalThis.toggleExtensionForActiveTab()
        })
        expect(result.isConnected).toBe(true)

        // 3. Verify we can connect via direct CDP and see the page
        const randomId = Math.random().toString(36).substring(7)
        const cdpUrl = `ws://localhost:19988/cdp/${randomId}`
        let directBrowser = await chromium.connectOverCDP(cdpUrl)
        let contexts = directBrowser.contexts()
        let pages = contexts[0].pages()
        
        // Find our page
        let foundPage = pages.find(p => p.url() === testUrl)
        expect(foundPage).toBeDefined()
        expect(foundPage?.url()).toBe(testUrl)
        
        await directBrowser.close()

        // 4. Disable extension on this tab
        const resultDisabled = await serviceWorker.evaluate(async () => {
            // @ts-ignore
            return await globalThis.toggleExtensionForActiveTab()
        })
        expect(resultDisabled.isConnected).toBe(false)

        // 5. Try to connect/use the page. 
        // connecting to relay will succeed, but listing pages should NOT show our page
        // OR if we try to send command to the previous targetId (via session), it should fail
        
        // Connect to relay again
        directBrowser = await chromium.connectOverCDP(cdpUrl)
        contexts = directBrowser.contexts()
        pages = contexts[0].pages() // this calls Target.getTargets internally via contexts() or pages()? 
        // Actually contexts() just returns what it knows.
        // If relay sent detachedFromTarget, the page should be gone from the context.
        
        foundPage = pages.find(p => p.url() === testUrl)
        expect(foundPage).toBeUndefined()
        
        // Also try to send a command to the old target ID if possible? 
        // Hard to do with high-level Playwright API on the browser object.
        // We can try to use a raw CDPSession on the browser target if we knew how to route it.
        // But checking it's gone is good enough for "connection disabled".
        
        await directBrowser.close()

        // 6. Re-enable extension
        const resultEnabled = await serviceWorker.evaluate(async () => {
            // @ts-ignore
            return await globalThis.toggleExtensionForActiveTab()
        })
        expect(resultEnabled.isConnected).toBe(true)

        // 7. Verify page is back
        // Note: targetId might have changed! Fetch it again just in case, or rely on relay to update routing.
        // But relay routing is based on `sessionId`. New session ID generated on attach.
        // The URL path param `targetId` is just a label.
        
        directBrowser = await chromium.connectOverCDP(cdpUrl)
        // Wait a bit for targets to populate
        await new Promise(r => setTimeout(r, 500))
        
        contexts = directBrowser.contexts()
        // pages() might need a moment if target attached event comes in
        if (contexts[0].pages().length === 0) {
             await new Promise(r => setTimeout(r, 1000))
        }
        pages = contexts[0].pages()
        
        foundPage = pages.find(p => p.url() === testUrl)
        expect(foundPage).toBeDefined()
        expect(foundPage?.url()).toBe(testUrl)
        
        await directBrowser.close()
        await page.close()
    })
})
function tryJsonParse(str: string) {
    try {
        return JSON.parse(str)
    } catch {
        return str
    }
}
