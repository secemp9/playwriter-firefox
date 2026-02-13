/**
 * WebDriver BiDi Client for Firefox
 *
 * Modern alternative to RDP that uses the W3C WebDriver BiDi protocol.
 * Firefox supports BiDi via --remote-debugging-port
 *
 * Protocol: WebSocket with JSON-RPC 2.0 style messages
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';

export class BiDiClient extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.connected = false;
    this.browsingContexts = new Map();
  }

  /**
   * Connect to Firefox's BiDi server
   * @param {number} port - Port (default: 9222)
   * @param {string} host - Hostname (default: localhost)
   */
  async connect(port = 9222, host = 'localhost') {
    return new Promise((resolve, reject) => {
      // First, get the WebSocket URL from the /json/version endpoint
      this._getWebSocketUrl(port, host)
        .then((wsUrl) => {
          this.ws = new WebSocket(wsUrl);

          this.ws.on('open', async () => {
            this.connected = true;
            this.emit('connected');

            // Subscribe to events
            try {
              await this._subscribe();
              resolve();
            } catch (err) {
              reject(err);
            }
          });

          this.ws.on('message', (data) => {
            this._onMessage(data.toString());
          });

          this.ws.on('error', (err) => {
            this.emit('error', err);
            reject(err);
          });

          this.ws.on('close', () => {
            this.connected = false;
            this.emit('disconnected');
          });
        })
        .catch(reject);
    });
  }

  async _getWebSocketUrl(port, host) {
    // Try BiDi WebSocket URL directly
    return `ws://${host}:${port}/session`;
  }

  async _subscribe() {
    // Subscribe to browsing context events
    await this.send('session.subscribe', {
      events: [
        'browsingContext.contextCreated',
        'browsingContext.contextDestroyed',
        'browsingContext.navigationStarted',
        'browsingContext.domContentLoaded',
        'browsingContext.load',
        'log.entryAdded'
      ]
    });
  }

  /**
   * Disconnect from Firefox
   */
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.connected = false;
    }
  }

  /**
   * Send a BiDi command
   * @param {string} method - BiDi method name
   * @param {object} params - Method parameters
   */
  async send(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.ws || !this.connected) {
        reject(new Error('Not connected'));
        return;
      }

      const id = ++this.requestId;
      const message = { id, method, params };

      this.pendingRequests.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(message));

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, 30000);
    });
  }

  _onMessage(data) {
    try {
      const message = JSON.parse(data);

      // Handle response to a request
      if (message.id !== undefined) {
        const pending = this.pendingRequests.get(message.id);
        if (pending) {
          this.pendingRequests.delete(message.id);
          if (message.error) {
            pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
          } else {
            pending.resolve(message.result);
          }
          return;
        }
      }

      // Handle events
      if (message.method) {
        this._handleEvent(message.method, message.params);
      }
    } catch (err) {
      this.emit('error', new Error(`Invalid message: ${err.message}`));
    }
  }

  _handleEvent(method, params) {
    // Track browsing contexts
    if (method === 'browsingContext.contextCreated') {
      this.browsingContexts.set(params.context, params);
    } else if (method === 'browsingContext.contextDestroyed') {
      this.browsingContexts.delete(params.context);
    }

    this.emit(method, params);
    this.emit('event', { method, params });
  }

  // BiDi API Methods

  /**
   * Get all browsing contexts (tabs)
   */
  async getBrowsingContexts() {
    const result = await this.send('browsingContext.getTree', {});
    return result.contexts || [];
  }

  /**
   * Create a new browsing context (tab)
   */
  async createBrowsingContext(type = 'tab') {
    return await this.send('browsingContext.create', { type });
  }

  /**
   * Navigate to a URL
   * @param {string} context - Browsing context ID
   * @param {string} url - URL to navigate to
   */
  async navigate(context, url) {
    return await this.send('browsingContext.navigate', {
      context,
      url,
      wait: 'complete'
    });
  }

  /**
   * Reload a browsing context
   * @param {string} context - Browsing context ID
   */
  async reload(context) {
    return await this.send('browsingContext.reload', {
      context,
      wait: 'complete'
    });
  }

  /**
   * Evaluate JavaScript in a browsing context
   * @param {string} context - Browsing context ID
   * @param {string} expression - JavaScript expression
   * @param {boolean} awaitPromise - Whether to await promise results
   */
  async evaluate(context, expression, awaitPromise = true) {
    return await this.send('script.evaluate', {
      expression,
      target: { context },
      awaitPromise,
      resultOwnership: 'root'
    });
  }

  /**
   * Call a function in a browsing context
   * @param {string} context - Browsing context ID
   * @param {string} functionDeclaration - Function to call
   * @param {array} args - Arguments
   */
  async callFunction(context, functionDeclaration, args = []) {
    return await this.send('script.callFunction', {
      functionDeclaration,
      arguments: args,
      target: { context },
      awaitPromise: true,
      resultOwnership: 'root'
    });
  }

  /**
   * Add a preload script
   * @param {string} functionDeclaration - Script function
   * @param {array} contexts - Browsing contexts (optional)
   */
  async addPreloadScript(functionDeclaration, contexts = null) {
    const params = { functionDeclaration };
    if (contexts) {
      params.contexts = contexts;
    }
    return await this.send('script.addPreloadScript', params);
  }

  /**
   * Capture a screenshot
   * @param {string} context - Browsing context ID
   */
  async captureScreenshot(context) {
    return await this.send('browsingContext.captureScreenshot', {
      context
    });
  }

  /**
   * Close a browsing context
   * @param {string} context - Browsing context ID
   */
  async close(context) {
    return await this.send('browsingContext.close', { context });
  }

  /**
   * Set viewport size
   * @param {string} context - Browsing context ID
   * @param {number} width - Viewport width
   * @param {number} height - Viewport height
   */
  async setViewport(context, width, height) {
    return await this.send('browsingContext.setViewport', {
      context,
      viewport: { width, height }
    });
  }

  /**
   * Print to PDF
   * @param {string} context - Browsing context ID
   */
  async printToPDF(context) {
    return await this.send('browsingContext.print', {
      context
    });
  }
}

export default BiDiClient;
