import { Page, Locator } from 'playwright-core'
import { createPatch } from 'diff'
import { formatHtmlForPrompt } from './htmlrewrite.js'

export interface GetCleanHTMLOptions {
  locator: Locator | Page
  search?: string | RegExp
  showDiffSinceLastCall?: boolean
  includeStyles?: boolean
  maxAttrLen?: number
  maxContentLen?: number
}

// Store last HTML snapshots per locator/page for diffing
const lastHtmlSnapshots: WeakMap<Page, Map<string, string>> = new WeakMap()

function isPage(obj: any): obj is Page {
  return obj && typeof obj.content === 'function' && typeof obj.goto === 'function'
}

function isRegExp(value: any): value is RegExp {
  return (
    typeof value === 'object' && value !== null && typeof value.test === 'function' && typeof value.exec === 'function'
  )
}

function getSnapshotKey(locator: Locator | Page): string {
  if (isPage(locator)) {
    return '__page__'
  }
  // For locators, use a string representation
  return (locator as any)._selector || '__locator__'
}

export async function getCleanHTML(options: GetCleanHTMLOptions): Promise<string> {
  const {
    locator,
    search,
    showDiffSinceLastCall = false,
    includeStyles = false,
    maxAttrLen = 200,
    maxContentLen = 500,
  } = options

  // Get raw HTML
  let rawHtml: string
  let page: Page

  if (isPage(locator)) {
    page = locator
    rawHtml = await locator.content()
  } else {
    page = locator.page()
    rawHtml = await locator.innerHTML()
  }

  // Clean the HTML using formatHtmlForPrompt
  const cleanedHtml = await formatHtmlForPrompt({
    html: rawHtml,
    keepStyles: includeStyles,
    maxAttrLen,
    maxContentLen,
  })

  // Sanitize to remove unpaired surrogates that break JSON encoding
  let htmlStr = cleanedHtml.toWellFormed?.() ?? cleanedHtml

  // Handle diffing
  if (showDiffSinceLastCall) {
    let pageSnapshots = lastHtmlSnapshots.get(page)
    if (!pageSnapshots) {
      pageSnapshots = new Map()
      lastHtmlSnapshots.set(page, pageSnapshots)
    }

    const snapshotKey = getSnapshotKey(locator)
    const previousSnapshot = pageSnapshots.get(snapshotKey)

    if (!previousSnapshot) {
      pageSnapshots.set(snapshotKey, htmlStr)
      return 'No previous snapshot available. This is the first call for this locator. Full snapshot stored for next diff.'
    }

    const patch = createPatch('html', previousSnapshot, htmlStr, 'previous', 'current', {
      context: 3,
    })

    pageSnapshots.set(snapshotKey, htmlStr)

    if (patch.split('\n').length <= 4) {
      return 'No changes detected since last snapshot'
    }
    return patch
  }

  // Store snapshot for future diffs
  let pageSnapshots = lastHtmlSnapshots.get(page)
  if (!pageSnapshots) {
    pageSnapshots = new Map()
    lastHtmlSnapshots.set(page, pageSnapshots)
  }
  pageSnapshots.set(getSnapshotKey(locator), htmlStr)

  // Handle search
  if (search) {
    const lines = htmlStr.split('\n')
    const matches: string[] = []

    for (const line of lines) {
      let isMatch = false
      if (isRegExp(search)) {
        isMatch = search.test(line)
      } else {
        isMatch = line.includes(search)
      }

      if (isMatch) {
        matches.push(line)
        if (matches.length >= 10) break
      }
    }

    if (matches.length === 0) {
      return 'No matches found'
    }

    return matches.join('\n')
  }

  return htmlStr
}
