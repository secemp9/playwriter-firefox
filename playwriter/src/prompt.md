# playwriter execute

Control user's Chrome browser via playwright code snippets. Prefer single-line code with semicolons between statements. If you get "Extension not running" error, tell user to click the playwriter extension icon on the tab they want to control.

You can collaborate with the user - they can help with captchas, difficult elements, or reproducing bugs.

## context variables

- `state` - object persisted between calls, use to store data/pages (e.g., `state.myPage = await context.newPage()`)
- `page` - default page the user activated, use this unless working with multiple pages
- `context` - browser context, access all pages via `context.pages()`
- `require` - load node modules (e.g., `require('node:fs')`)
- Node.js globals: `setTimeout`, `setInterval`, `fetch`, `URL`, `Buffer`, `crypto`, etc.

## rules

- **Multiple calls**: use multiple execute calls for complex logic - helps understand intermediate state and isolate which action failed
- **Never close**: never call `browser.close()` or `context.close()`. Only close pages you created or if user asks
- **No bringToFront**: never call unless user asks - it's disruptive and unnecessary, you can interact with background pages
- **Check state after actions**: always verify page state after clicking/submitting (see next section)
- **Clean up listeners**: call `page.removeAllListeners()` at end of message to prevent leaks
- **CDP sessions**: use `getCDPSession({ page })` not `page.context().newCDPSession()` - the latter doesn't work through playwriter relay
- **Wait for load**: use `page.waitForLoadState('load')` not `page.waitForEvent('load')` - waitForEvent times out if already loaded
- **Avoid timeouts**: prefer proper waits over `page.waitForTimeout()` - there are better ways to wait for elements

## checking page state

After any action (click, submit, navigate), verify what happened:

```js
console.log('url:', page.url()); console.log(await accessibilitySnapshot({ page }).then(x => x.split('\n').slice(0, 30).join('\n')));
```

If nothing changed, try `await page.waitForLoadState('networkidle', {timeout: 3000})` or you may have clicked the wrong element.

## accessibility snapshots

```js
await accessibilitySnapshot({ page, search?, contextLines?, showDiffSinceLastCall? })
```

- `search` - string/regex to filter results (returns first 10 matches with context)
- `contextLines` - lines of context around matches (default: 10)
- `showDiffSinceLastCall` - returns diff since last snapshot (useful after actions)

Example output:

```md
- banner [ref=e3]:
    - link "Home" [ref=e5] [cursor=pointer]:
        - /url: /
    - navigation [ref=e12]:
        - link "Docs" [ref=e13] [cursor=pointer]:
            - /url: /docs
```

Use `aria-ref` to interact - **no quotes around the ref value**:

```js
await page.locator('aria-ref=e13').click()
```

Search for specific elements:

```js
const snapshot = await accessibilitySnapshot({ page, search: /button|submit/i })
```

## working with pages

Find a specific page:

```js
const pages = context.pages().filter(x => x.url().includes('localhost'));
if (pages.length !== 1) throw new Error(`Expected 1 page, found ${pages.length}`);
state.targetPage = pages[0];
```

Create new page:

```js
state.newPage = await context.newPage();
await state.newPage.goto('https://example.com');
```

## utility functions

**getLatestLogs** - retrieve captured browser console logs (up to 5000 per page, cleared on navigation):

```js
await getLatestLogs({ page?, count?, search? })
// Examples:
const errors = await getLatestLogs({ search: /error/i, count: 50 })
const pageLogs = await getLatestLogs({ page })
```

For custom log collection across runs, store in state: `state.logs = []; page.on('console', m => state.logs.push(m.text()))`

**waitForPageLoad** - smart load detection that ignores analytics/ads:

```js
await waitForPageLoad({ page, timeout?, pollInterval?, minWait? })
// Returns: { success, readyState, pendingRequests, waitTimeMs, timedOut }
```

**getCDPSession** - send raw CDP commands:

```js
const cdp = await getCDPSession({ page });
const metrics = await cdp.send('Page.getLayoutMetrics');
```

**getLocatorStringForElement** - get stable selector from ephemeral aria-ref:

```js
const selector = await getLocatorStringForElement(page.locator('aria-ref=e14'));
// => "getByRole('button', { name: 'Save' })"
```

**getReactSource** - get React component source location (dev mode only):

```js
const source = await getReactSource({ locator: page.locator('aria-ref=e5') });
// => { fileName, lineNumber, columnNumber, componentName }
```

**getStylesForLocator** - inspect CSS styles applied to an element, like browser DevTools "Styles" panel. Useful for debugging styling issues, finding where a CSS property is defined (file:line), and checking inherited styles. Returns selector, source location, and declarations for each matching rule. ALWAYS read `https://playwriter.dev/resources/styles-api.md` first.

```js
const styles = await getStylesForLocator({ locator: page.locator('.btn'), cdp: await getCDPSession({ page }) });
console.log(formatStylesAsText(styles));
```

**createDebugger** - set breakpoints, step through code, inspect variables at runtime. Useful for debugging issues that only reproduce in browser, understanding code flow, and inspecting state at specific points. Can pause on exceptions, evaluate expressions in scope, and blackbox framework code. ALWAYS read `https://playwriter.dev/resources/debugger-api.md` first.

```js
const cdp = await getCDPSession({ page }); const dbg = createDebugger({ cdp }); await dbg.enable();
const scripts = await dbg.listScripts({ search: 'app' });
await dbg.setBreakpoint({ file: scripts[0].url, line: 42 });
// when paused: dbg.inspectLocalVariables(), dbg.stepOver(), dbg.resume()
```

**createEditor** - view and live-edit page scripts and CSS at runtime. Edits are in-memory (persist until reload). Useful for testing quick fixes, searching page scripts with grep, and toggling debug flags. ALWAYS read `https://playwriter.dev/resources/editor-api.md` first.

```js
const cdp = await getCDPSession({ page }); const editor = createEditor({ cdp }); await editor.enable();
const matches = await editor.grep({ regex: /console\.log/ });
await editor.edit({ url: matches[0].url, oldString: 'DEBUG = false', newString: 'DEBUG = true' });
```

## pinned elements

Users can right-click → "Copy Playwriter Element Reference" to store elements in `globalThis.playwriterPinnedElem1` (increments for each pin). The reference is copied to clipboard:

```js
const el = await page.evaluateHandle(() => globalThis.playwriterPinnedElem1);
await el.click();
```

## page.evaluate

Use `console.log()` to output values to the tool result. For `page.evaluate()`, return values and log outside (console.log inside evaluate runs in browser, not visible):

```js
const title = await page.evaluate(() => document.title);
console.log('Title:', title);

const info = await page.evaluate(() => ({
    url: location.href,
    buttons: document.querySelectorAll('button').length,
}));
console.log(info);
```

## loading files

Fill inputs with file content:

```js
const fs = require('node:fs'); const content = fs.readFileSync('./README.md', 'utf-8'); await page.locator('textarea').fill(content);
```

## capabilities

Examples of what playwriter can do:
- Monitor console logs while user reproduces a bug
- Monitor XHR requests while scrolling infinite scroll to extract data
- Get accessibility snapshot to find elements, then automate interactions
- Debug issues by collecting logs and controlling the page simultaneously
