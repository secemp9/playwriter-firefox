import type { CDPSession } from './cdp-session.js'
import type { Protocol } from 'devtools-protocol'

export interface BreakpointInfo {
  id: string
  file: string
  line: number
}

export interface LocationInfo {
  url: string
  lineNumber: number
  columnNumber: number
  callstack: Array<{
    functionName: string
    url: string
    lineNumber: number
    columnNumber: number
  }>
  sourceContext: string
}

export interface EvaluateResult {
  value: unknown
}

export interface VariablesResult {
  [scope: string]: Record<string, unknown>
}

export interface ScriptInfo {
  scriptId: string
  url: string
}

/**
 * A class for debugging JavaScript code via Chrome DevTools Protocol.
 * Works with both Node.js (--inspect) and browser debugging.
 *
 * @example
 * ```ts
 * const cdp = await getCDPSessionForPage({ page, wsUrl })
 * const dbg = new Debugger({ cdp })
 *
 * await dbg.setBreakpoint({ file: '/path/to/file.js', line: 42 })
 * // trigger the code path, then:
 * const location = await dbg.getLocation()
 * const vars = await dbg.inspectVariables()
 * await dbg.resume()
 * ```
 */
export class Debugger {
  private cdp: CDPSession
  private debuggerEnabled = false
  private paused = false
  private currentCallFrames: Protocol.Debugger.CallFrame[] = []
  private breakpoints = new Map<string, BreakpointInfo>()
  private scripts = new Map<string, ScriptInfo>()

  /**
   * Creates a new Debugger instance.
   *
   * @param options - Configuration options
   * @param options.cdp - A CDPSession instance for sending CDP commands
   *
   * @example
   * ```ts
   * const cdp = await getCDPSessionForPage({ page, wsUrl })
   * const dbg = new Debugger({ cdp })
   * ```
   */
  constructor({ cdp }: { cdp: CDPSession }) {
    this.cdp = cdp
    this.setupEventListeners()
  }

  private setupEventListeners() {
    this.cdp.on('Debugger.paused', (params) => {
      this.paused = true
      this.currentCallFrames = params.callFrames
    })

    this.cdp.on('Debugger.resumed', () => {
      this.paused = false
      this.currentCallFrames = []
    })

    this.cdp.on('Debugger.scriptParsed', (params) => {
      if (params.url && !params.url.startsWith('chrome') && !params.url.startsWith('devtools')) {
        this.scripts.set(params.scriptId, {
          scriptId: params.scriptId,
          url: params.url,
        })
      }
    })
  }

  /**
   * Enables the debugger and runtime domains. Called automatically by other methods.
   * Also resumes execution if the target was started with --inspect-brk.
   *
   * @example
   * ```ts
   * await dbg.enable()
   * ```
   */
  async enable(): Promise<void> {
    if (this.debuggerEnabled) {
      return
    }
    await this.cdp.send('Debugger.enable')
    await this.cdp.send('Runtime.enable')
    await this.cdp.send('Runtime.runIfWaitingForDebugger')
    this.debuggerEnabled = true
  }

  /**
   * Sets a breakpoint at a specified file and line number.
   * The file path is automatically converted to a file:// URL if needed.
   *
   * @param options - Breakpoint options
   * @param options.file - Absolute file path or URL
   * @param options.line - Line number (1-based)
   * @returns The breakpoint ID for later removal
   *
   * @example
   * ```ts
   * const id = await dbg.setBreakpoint({ file: '/app/src/index.js', line: 42 })
   * // later:
   * await dbg.deleteBreakpoint({ breakpointId: id })
   * ```
   */
  async setBreakpoint({ file, line }: { file: string; line: number }): Promise<string> {
    await this.enable()

    let fileUrl = file
    if (!file.startsWith('file://') && !file.startsWith('http://') && !file.startsWith('https://')) {
      fileUrl = `file://${file.startsWith('/') ? '' : '/'}${file}`
    }

    const response = await this.cdp.send('Debugger.setBreakpointByUrl', {
      lineNumber: line - 1,
      urlRegex: fileUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      columnNumber: 0,
    })

    this.breakpoints.set(response.breakpointId, { id: response.breakpointId, file, line })
    return response.breakpointId
  }

  /**
   * Removes a breakpoint by its ID.
   *
   * @param options - Options
   * @param options.breakpointId - The breakpoint ID returned by setBreakpoint
   *
   * @example
   * ```ts
   * await dbg.deleteBreakpoint({ breakpointId: 'bp-123' })
   * ```
   */
  async deleteBreakpoint({ breakpointId }: { breakpointId: string }): Promise<void> {
    await this.enable()
    await this.cdp.send('Debugger.removeBreakpoint', { breakpointId })
    this.breakpoints.delete(breakpointId)
  }

  /**
   * Returns a list of all active breakpoints set by this debugger instance.
   *
   * @returns Array of breakpoint info objects
   *
   * @example
   * ```ts
   * const breakpoints = dbg.listBreakpoints()
   * // [{ id: 'bp-123', file: '/app/index.js', line: 42 }]
   * ```
   */
  listBreakpoints(): BreakpointInfo[] {
    return Array.from(this.breakpoints.values())
  }

  /**
   * Inspects variables in the current scope.
   * When paused at a breakpoint with scope='local', returns variables from the call frame.
   * Otherwise returns global scope information.
   *
   * @param options - Options
   * @param options.scope - 'local' for call frame variables, 'global' for global scope
   * @returns Variables grouped by scope type
   *
   * @example
   * ```ts
   * // When paused at a breakpoint:
   * const vars = await dbg.inspectVariables({ scope: 'local' })
   * // { local: { myVar: 'hello', count: 42 }, closure: { captured: true } }
   *
   * // Global scope:
   * const globals = await dbg.inspectVariables({ scope: 'global' })
   * // { lexicalNames: [...], globalThis: { ... } }
   * ```
   */
  async inspectVariables({ scope = 'local' }: { scope?: 'local' | 'global' } = {}): Promise<VariablesResult> {
    await this.enable()

    if (scope === 'global' || !this.paused) {
      const response = await this.cdp.send('Runtime.globalLexicalScopeNames', {})
      const globalObjResponse = await this.cdp.send('Runtime.evaluate', {
        expression: 'this',
        returnByValue: true,
      })

      return {
        lexicalNames: response.names as unknown as Record<string, unknown>,
        globalThis: globalObjResponse.result.value as Record<string, unknown>,
      }
    }

    if (this.currentCallFrames.length === 0) {
      throw new Error('No active call frames')
    }

    const frame = this.currentCallFrames[0]
    const result: VariablesResult = {}

    for (const scopeObj of frame.scopeChain) {
      if (scopeObj.type === 'global') {
        continue
      }

      if (!scopeObj.object.objectId) {
        continue
      }

      const objProperties = await this.cdp.send('Runtime.getProperties', {
        objectId: scopeObj.object.objectId,
        ownProperties: true,
        accessorPropertiesOnly: false,
        generatePreview: true,
      })

      const variables: Record<string, unknown> = {}
      for (const prop of objProperties.result) {
        if (prop.value && prop.configurable) {
          variables[prop.name] = this.formatPropertyValue(prop.value)
        }
      }

      result[scopeObj.type] = variables
    }

    return result
  }

  /**
   * Evaluates a JavaScript expression in the current context.
   * When paused at a breakpoint, evaluates in the call frame context (can access local variables).
   * Otherwise evaluates in the global context.
   *
   * @param options - Options
   * @param options.expression - JavaScript expression to evaluate
   * @returns The result value
   *
   * @example
   * ```ts
   * // When paused, can access local variables:
   * const result = await dbg.evaluate({ expression: 'localVar + 1' })
   *
   * // Global context when not paused:
   * const result = await dbg.evaluate({ expression: 'process.env.NODE_ENV' })
   * console.log(result.value) // 'development'
   * ```
   */
  async evaluate({ expression }: { expression: string }): Promise<EvaluateResult> {
    await this.enable()

    const wrappedExpression = `
      try {
        ${expression}
      } catch (e) {
        e;
      }
    `

    let response: Protocol.Debugger.EvaluateOnCallFrameResponse | Protocol.Runtime.EvaluateResponse

    if (this.paused && this.currentCallFrames.length > 0) {
      const frame = this.currentCallFrames[0]
      response = await this.cdp.send('Debugger.evaluateOnCallFrame', {
        callFrameId: frame.callFrameId,
        expression: wrappedExpression,
        objectGroup: 'console',
        includeCommandLineAPI: true,
        silent: false,
        returnByValue: true,
        generatePreview: true,
      })
    } else {
      response = await this.cdp.send('Runtime.evaluate', {
        expression: wrappedExpression,
        objectGroup: 'console',
        includeCommandLineAPI: true,
        silent: false,
        returnByValue: true,
        generatePreview: true,
        awaitPromise: true,
      })
    }

    const value = await this.processRemoteObject(response.result)

    return { value }
  }

  /**
   * Gets the current execution location when paused at a breakpoint.
   * Includes the call stack and surrounding source code for context.
   *
   * @returns Location info with URL, line number, call stack, and source context
   * @throws Error if debugger is not paused
   *
   * @example
   * ```ts
   * const location = await dbg.getLocation()
   * console.log(location.url)          // '/app/src/index.js'
   * console.log(location.lineNumber)   // 42
   * console.log(location.callstack)    // [{ functionName: 'handleRequest', ... }]
   * console.log(location.sourceContext)
   * // '  40: function handleRequest(req) {
   * //   41:   const data = req.body
   * // > 42:   processData(data)
   * //   43: }'
   * ```
   */
  async getLocation(): Promise<LocationInfo> {
    await this.enable()

    if (!this.paused || this.currentCallFrames.length === 0) {
      throw new Error('Debugger is not paused at a breakpoint')
    }

    const frame = this.currentCallFrames[0]
    const { scriptId, lineNumber, columnNumber } = frame.location

    const callstack = this.currentCallFrames.map((f) => ({
      functionName: f.functionName || '(anonymous)',
      url: f.url,
      lineNumber: f.location.lineNumber + 1,
      columnNumber: f.location.columnNumber || 0,
    }))

    let sourceContext = ''
    try {
      const scriptSource = await this.cdp.send('Debugger.getScriptSource', { scriptId })
      const lines = scriptSource.scriptSource.split('\n')
      const startLine = Math.max(0, lineNumber - 3)
      const endLine = Math.min(lines.length - 1, lineNumber + 3)

      for (let i = startLine; i <= endLine; i++) {
        const prefix = i === lineNumber ? '> ' : '  '
        sourceContext += `${prefix}${i + 1}: ${lines[i]}\n`
      }
    } catch {
      sourceContext = 'Unable to retrieve source code'
    }

    return {
      url: frame.url,
      lineNumber: lineNumber + 1,
      columnNumber: columnNumber || 0,
      callstack,
      sourceContext,
    }
  }

  /**
   * Steps over to the next line of code, not entering function calls.
   *
   * @throws Error if debugger is not paused
   *
   * @example
   * ```ts
   * await dbg.stepOver()
   * const newLocation = await dbg.getLocation()
   * ```
   */
  async stepOver(): Promise<void> {
    await this.enable()
    if (!this.paused) {
      throw new Error('Debugger is not paused')
    }
    await this.cdp.send('Debugger.stepOver')
  }

  /**
   * Steps into a function call on the current line.
   *
   * @throws Error if debugger is not paused
   *
   * @example
   * ```ts
   * await dbg.stepInto()
   * const location = await dbg.getLocation()
   * // now inside the called function
   * ```
   */
  async stepInto(): Promise<void> {
    await this.enable()
    if (!this.paused) {
      throw new Error('Debugger is not paused')
    }
    await this.cdp.send('Debugger.stepInto')
  }

  /**
   * Steps out of the current function, returning to the caller.
   *
   * @throws Error if debugger is not paused
   *
   * @example
   * ```ts
   * await dbg.stepOut()
   * const location = await dbg.getLocation()
   * // back in the calling function
   * ```
   */
  async stepOut(): Promise<void> {
    await this.enable()
    if (!this.paused) {
      throw new Error('Debugger is not paused')
    }
    await this.cdp.send('Debugger.stepOut')
  }

  /**
   * Resumes code execution until the next breakpoint or completion.
   *
   * @throws Error if debugger is not paused
   *
   * @example
   * ```ts
   * await dbg.resume()
   * // execution continues
   * ```
   */
  async resume(): Promise<void> {
    await this.enable()
    if (!this.paused) {
      throw new Error('Debugger is not paused')
    }
    await this.cdp.send('Debugger.resume')
  }

  /**
   * Returns whether the debugger is currently paused at a breakpoint.
   *
   * @returns true if paused, false otherwise
   *
   * @example
   * ```ts
   * if (dbg.isPaused()) {
   *   const vars = await dbg.inspectVariables()
   * }
   * ```
   */
  isPaused(): boolean {
    return this.paused
  }

  /**
   * Lists available scripts where breakpoints can be set.
   * Scripts are collected from Debugger.scriptParsed events after enable() is called.
   * Reload the page after enabling to capture all scripts.
   *
   * @param options - Options
   * @param options.search - Optional string to filter scripts by URL (case-insensitive)
   * @returns Array of up to 20 matching scripts with scriptId and url
   *
   * @example
   * ```ts
   * // List all scripts
   * const scripts = dbg.listScripts()
   * // [{ scriptId: '1', url: 'https://example.com/app.js' }, ...]
   *
   * // Search for specific files
   * const handlers = dbg.listScripts({ search: 'handler' })
   * // [{ scriptId: '5', url: 'https://example.com/handlers.js' }]
   * ```
   */
  listScripts({ search }: { search?: string } = {}): ScriptInfo[] {
    const scripts = Array.from(this.scripts.values())
    const filtered = search
      ? scripts.filter((s) => s.url.toLowerCase().includes(search.toLowerCase()))
      : scripts
    return filtered.slice(0, 20)
  }

  private formatPropertyValue(value: Protocol.Runtime.RemoteObject): unknown {
    if (value.type === 'object' && value.subtype !== 'null') {
      return `[${value.subtype || value.type}]`
    }
    if (value.type === 'function') {
      return '[function]'
    }
    if (value.value !== undefined) {
      return value.value
    }
    return `[${value.type}]`
  }

  private async processRemoteObject(obj: Protocol.Runtime.RemoteObject): Promise<unknown> {
    if (obj.type === 'undefined') {
      return undefined
    }

    if (obj.value !== undefined) {
      return obj.value
    }

    if (obj.type === 'object' && obj.objectId) {
      try {
        const props = await this.cdp.send('Runtime.getProperties', {
          objectId: obj.objectId,
          ownProperties: true,
          accessorPropertiesOnly: false,
          generatePreview: true,
        })

        const result: Record<string, unknown> = {}
        for (const prop of props.result) {
          if (prop.value) {
            if (prop.value.type === 'object' && prop.value.objectId && prop.value.subtype !== 'null') {
              try {
                const nestedProps = await this.cdp.send('Runtime.getProperties', {
                  objectId: prop.value.objectId,
                  ownProperties: true,
                  accessorPropertiesOnly: false,
                  generatePreview: true,
                })
                const nestedObj: Record<string, unknown> = {}
                for (const nestedProp of nestedProps.result) {
                  if (nestedProp.value) {
                    nestedObj[nestedProp.name] =
                      nestedProp.value.value !== undefined
                        ? nestedProp.value.value
                        : nestedProp.value.description || `[${nestedProp.value.subtype || nestedProp.value.type}]`
                  }
                }
                result[prop.name] = nestedObj
              } catch {
                result[prop.name] = prop.value.description || `[${prop.value.subtype || prop.value.type}]`
              }
            } else if (prop.value.type === 'function') {
              result[prop.name] = '[function]'
            } else if (prop.value.value !== undefined) {
              result[prop.name] = prop.value.value
            } else {
              result[prop.name] = `[${prop.value.type}]`
            }
          }
        }
        return result
      } catch {
        return obj.description || `[${obj.subtype || obj.type}]`
      }
    }

    return obj.description || `[${obj.type}]`
  }
}
