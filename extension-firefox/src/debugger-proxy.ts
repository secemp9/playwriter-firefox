/**
 * DebuggerProxy - Provides CDP-like debugging capabilities via native messaging
 *
 * This class communicates with the playwriter-debug-bridge native host to
 * provide debugging capabilities similar to Chrome's chrome.debugger API.
 */

import browser, { Runtime } from 'webextension-polyfill'

const NATIVE_HOST_NAME = 'com.anthropic.playwriter.debug_bridge';

export interface DebuggerProxyEvents {
  connected: () => void;
  disconnected: () => void;
  error: (error: string) => void;
  tabCreated: (context: string, url: string) => void;
  tabDestroyed: (context: string) => void;
  console: (data: any) => void;
}

export interface Tab {
  id: string | number;
  url: string;
  title: string;
  context?: string;
  actor?: string;
}

export class DebuggerProxy {
  private port: Runtime.Port | null = null;
  private connected = false;
  private protocol: 'bidi' | 'rdp' | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
  }>();
  private eventListeners = new Map<string, Set<Function>>();

  /**
   * Connect to the native debug bridge
   */
  async connectNative(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.port = browser.runtime.connectNative(NATIVE_HOST_NAME);

        this.port.onMessage.addListener((message: any) => {
          this.handleMessage(message);
        });

        this.port.onDisconnect.addListener(() => {
          const error = browser.runtime.lastError;
          this.connected = false;
          this.port = null;

          if (error) {
            this.emit('error', error.message || 'Native host disconnected');
            reject(new Error(error.message || 'Failed to connect to native host'));
          } else {
            this.emit('disconnected');
          }
        });

        // Wait for ready message
        const readyTimeout = setTimeout(() => {
          reject(new Error('Native host did not send ready message'));
        }, 5000);

        const checkReady = (message: any) => {
          if (message.type === 'ready') {
            clearTimeout(readyTimeout);
            resolve();
          }
        };

        this.port.onMessage.addListener(checkReady);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Connect to Firefox's debug server via the native bridge
   */
  async connect(options: {
    protocol?: 'bidi' | 'rdp';
    port?: number;
    host?: string;
  } = {}): Promise<{ connected: boolean; protocol: string }> {
    if (!this.port) {
      await this.connectNative();
    }

    const result = await this.sendRequest('connect', {
      protocol: options.protocol || 'bidi',
      port: options.port,
      host: options.host
    });

    if (result.success) {
      this.connected = true;
      this.protocol = result.result.protocol;
      this.emit('connected');
      return result.result;
    } else {
      throw new Error(result.error);
    }
  }

  /**
   * Disconnect from the debug server
   */
  async disconnect(): Promise<void> {
    if (this.port) {
      await this.sendRequest('disconnect', {});
      this.port.disconnect();
      this.port = null;
      this.connected = false;
      this.protocol = null;
      this.emit('disconnected');
    }
  }

  /**
   * List all tabs
   */
  async listTabs(): Promise<Tab[]> {
    const result = await this.sendRequest('listTabs', {});
    if (result.success) {
      return result.result.tabs;
    }
    throw new Error(result.error);
  }

  /**
   * Attach to a tab for debugging
   */
  async attachTab(tabId: string | number): Promise<any> {
    const result = await this.sendRequest('attachTab', { tabId });
    if (result.success) {
      return result.result;
    }
    throw new Error(result.error);
  }

  /**
   * Evaluate JavaScript in a tab
   */
  async evaluate(tabId: string | number, expression: string): Promise<any> {
    const result = await this.sendRequest('evaluate', { tabId, expression });
    if (result.success) {
      return result.result;
    }
    throw new Error(result.error);
  }

  /**
   * Navigate a tab to a URL
   */
  async navigate(tabId: string | number, url: string): Promise<void> {
    const result = await this.sendRequest('navigate', { tabId, url });
    if (!result.success) {
      throw new Error(result.error);
    }
  }

  /**
   * Reload a tab
   */
  async reload(tabId: string | number): Promise<void> {
    const result = await this.sendRequest('reload', { tabId });
    if (!result.success) {
      throw new Error(result.error);
    }
  }

  /**
   * Capture a screenshot
   */
  async screenshot(tabId: string | number): Promise<string> {
    const result = await this.sendRequest('screenshot', { tabId });
    if (result.success) {
      return result.result.screenshot;
    }
    throw new Error(result.error);
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get current protocol
   */
  getProtocol(): 'bidi' | 'rdp' | null {
    return this.protocol;
  }

  /**
   * Add event listener
   */
  on<K extends keyof DebuggerProxyEvents>(
    event: K,
    callback: DebuggerProxyEvents[K]
  ): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback);
  }

  /**
   * Remove event listener
   */
  off<K extends keyof DebuggerProxyEvents>(
    event: K,
    callback: DebuggerProxyEvents[K]
  ): void {
    this.eventListeners.get(event)?.delete(callback);
  }

  private emit(event: string, ...args: any[]): void {
    this.eventListeners.get(event)?.forEach((callback) => {
      try {
        callback(...args);
      } catch (error) {
        console.error(`Error in ${event} listener:`, error);
      }
    });
  }

  private sendRequest(action: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.port) {
        reject(new Error('Not connected to native host'));
        return;
      }

      const id = ++this.requestId;
      this.pendingRequests.set(id, { resolve, reject });

      this.port.postMessage({ action, id, ...params });

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout: ${action}`));
        }
      }, 30000);
    });
  }

  private handleMessage(message: any): void {
    // Handle response to a request
    if (message.id !== undefined) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        this.pendingRequests.delete(message.id);
        pending.resolve(message);
        return;
      }
    }

    // Handle events from native host
    switch (message.type) {
      case 'error':
        this.emit('error', message.error);
        break;
      case 'disconnected':
        this.connected = false;
        this.emit('disconnected');
        break;
      case 'tabCreated':
        this.emit('tabCreated', message.context, message.url);
        break;
      case 'tabDestroyed':
        this.emit('tabDestroyed', message.context);
        break;
      case 'console':
        this.emit('console', message);
        break;
    }
  }
}

// Singleton instance
export const debuggerProxy = new DebuggerProxy();
