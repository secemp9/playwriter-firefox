import type { Page, Locator } from 'playwright-core'
import type { CDPSession } from './cdp-session.js'
import type { Debugger } from './debugger.js'
import type { Editor } from './editor.js'
import type { StylesResult } from './styles.js'

export declare const page: Page
export declare const getCDPSession: (options: { page: Page }) => Promise<CDPSession>
export declare const createDebugger: (options: { cdp: CDPSession }) => Debugger
export declare const createEditor: (options: { cdp: CDPSession }) => Editor
export declare const getStylesForLocator: (options: { locator: Locator; includeUserAgentStyles?: boolean }) => Promise<StylesResult>
export declare const formatStylesAsText: (styles: StylesResult) => string
export declare const console: { log: (...args: unknown[]) => void }
