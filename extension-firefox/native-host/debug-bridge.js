#!/usr/bin/env node

/**
 * Playwriter Firefox Debug Bridge
 *
 * Native messaging host that bridges the Firefox extension to Firefox's
 * debugging protocols (RDP or WebDriver BiDi).
 *
 * Communication with extension:
 * - Messages are length-prefixed (4-byte unsigned 32-bit integer, native endianness)
 * - Followed by UTF-8 JSON
 *
 * Supported actions:
 * - connect: Connect to Firefox debug server (RDP or BiDi)
 * - disconnect: Disconnect from debug server
 * - listTabs: List all browser tabs
 * - attachTab: Attach to a specific tab
 * - evaluate: Evaluate JavaScript in a tab
 * - navigate: Navigate tab to URL
 * - reload: Reload tab
 * - screenshot: Capture screenshot
 */

import { RDPClient } from './rdp-client.js';
import { BiDiClient } from './bidi-client.js';

class DebugBridge {
  constructor() {
    this.client = null; // RDPClient or BiDiClient
    this.protocol = null; // 'rdp' or 'bidi'
    this.attachedTabs = new Map();
    this.browsingContexts = new Map(); // For BiDi
  }

  async handleMessage(message) {
    const { action, id, ...params } = message;

    try {
      let result;

      switch (action) {
        case 'connect':
          result = await this.connect(params);
          break;

        case 'disconnect':
          result = await this.disconnect();
          break;

        case 'listTabs':
          result = await this.listTabs();
          break;

        case 'attachTab':
          result = await this.attachTab(params.tabId);
          break;

        case 'evaluate':
          result = await this.evaluate(params.tabId, params.expression);
          break;

        case 'navigate':
          result = await this.navigate(params.tabId, params.url);
          break;

        case 'reload':
          result = await this.reload(params.tabId);
          break;

        case 'screenshot':
          result = await this.screenshot(params.tabId);
          break;

        case 'ping':
          result = {
            pong: true,
            connected: this.client?.connected || false,
            protocol: this.protocol
          };
          break;

        default:
          throw new Error(`Unknown action: ${action}`);
      }

      return { id, success: true, result };
    } catch (error) {
      return { id, success: false, error: error.message };
    }
  }

  async connect(params) {
    const {
      protocol = 'bidi', // Prefer BiDi by default
      port = protocol === 'bidi' ? 9222 : 6000,
      host = 'localhost'
    } = params;

    if (this.client?.connected) {
      return { already_connected: true, protocol: this.protocol };
    }

    this.protocol = protocol;

    if (protocol === 'bidi') {
      this.client = new BiDiClient();
    } else {
      this.client = new RDPClient();
    }

    this.client.on('error', (err) => {
      sendMessage({ type: 'error', error: err.message });
    });

    this.client.on('disconnected', () => {
      sendMessage({ type: 'disconnected' });
    });

    // BiDi events
    if (protocol === 'bidi') {
      this.client.on('browsingContext.contextCreated', (params) => {
        this.browsingContexts.set(params.context, params);
        sendMessage({ type: 'tabCreated', context: params.context, url: params.url });
      });

      this.client.on('browsingContext.contextDestroyed', (params) => {
        this.browsingContexts.delete(params.context);
        sendMessage({ type: 'tabDestroyed', context: params.context });
      });

      this.client.on('log.entryAdded', (params) => {
        sendMessage({ type: 'console', ...params });
      });
    }

    await this.client.connect(port, host);

    return { connected: true, host, port, protocol };
  }

  async disconnect() {
    if (this.client) {
      this.client.disconnect();
      this.client = null;
      this.protocol = null;
      this.attachedTabs.clear();
      this.browsingContexts.clear();
    }
    return { disconnected: true };
  }

  async listTabs() {
    if (!this.client?.connected) {
      throw new Error('Not connected to Firefox debug server');
    }

    if (this.protocol === 'bidi') {
      const contexts = await this.client.getBrowsingContexts();
      return {
        tabs: contexts.map((ctx, index) => ({
          id: ctx.context,
          context: ctx.context,
          url: ctx.url,
          title: ctx.title || '',
          children: ctx.children
        }))
      };
    } else {
      // RDP
      const tabs = await this.client.listTabs();
      return {
        tabs: tabs.map((tab, index) => ({
          id: index,
          actor: tab.actor,
          url: tab.url,
          title: tab.title,
          consoleActor: tab.consoleActor
        }))
      };
    }
  }

  async attachTab(tabId) {
    if (!this.client?.connected) {
      throw new Error('Not connected to Firefox debug server');
    }

    if (this.protocol === 'bidi') {
      // BiDi doesn't need explicit attachment
      this.attachedTabs.set(tabId, { context: tabId });
      return { attached: true, tabId, context: tabId };
    } else {
      // RDP
      const tabs = await this.client.listTabs();
      const tab = tabs[tabId];

      if (!tab) {
        throw new Error(`Tab ${tabId} not found`);
      }

      const actors = await this.client.attachToTab(tab);
      this.attachedTabs.set(tabId, { tab, actors });

      return {
        attached: true,
        tabId,
        targetActor: actors.targetActor,
        consoleActor: actors.consoleActor
      };
    }
  }

  async evaluate(tabId, expression) {
    if (!this.client?.connected) {
      throw new Error('Not connected to Firefox debug server');
    }

    if (this.protocol === 'bidi') {
      const result = await this.client.evaluate(tabId, expression);
      return { result };
    } else {
      // RDP
      const attached = this.attachedTabs.get(tabId);

      if (!attached) {
        await this.attachTab(tabId);
      }

      const tabInfo = this.attachedTabs.get(tabId);
      if (!tabInfo) {
        throw new Error(`Tab ${tabId} not attached`);
      }

      const result = await this.client.evaluateJS(
        tabInfo.tab.consoleActor,
        expression
      );

      return { result };
    }
  }

  async navigate(tabId, url) {
    if (!this.client?.connected) {
      throw new Error('Not connected to Firefox debug server');
    }

    if (this.protocol === 'bidi') {
      await this.client.navigate(tabId, url);
      return { navigated: true, url };
    } else {
      // RDP
      const tabInfo = this.attachedTabs.get(tabId);
      if (!tabInfo) {
        throw new Error(`Tab ${tabId} not attached`);
      }

      await this.client.navigateTo(tabInfo.actors.targetActor, url);
      return { navigated: true, url };
    }
  }

  async reload(tabId) {
    if (!this.client?.connected) {
      throw new Error('Not connected to Firefox debug server');
    }

    if (this.protocol === 'bidi') {
      await this.client.reload(tabId);
      return { reloaded: true };
    } else {
      // RDP
      const tabInfo = this.attachedTabs.get(tabId);
      if (!tabInfo) {
        throw new Error(`Tab ${tabId} not attached`);
      }

      await this.client.reload(tabInfo.actors.targetActor);
      return { reloaded: true };
    }
  }

  async screenshot(tabId) {
    if (!this.client?.connected) {
      throw new Error('Not connected to Firefox debug server');
    }

    if (this.protocol === 'bidi') {
      const result = await this.client.captureScreenshot(tabId);
      return { screenshot: result.data };
    } else {
      throw new Error('Screenshot not supported via RDP - use BiDi protocol');
    }
  }
}

// Native messaging protocol helpers

function readMessage() {
  return new Promise((resolve, reject) => {
    // Read 4-byte length prefix
    const lengthBuffer = Buffer.alloc(4);
    let bytesRead = 0;

    const readLength = () => {
      const chunk = process.stdin.read(4 - bytesRead);
      if (!chunk) {
        process.stdin.once('readable', readLength);
        return;
      }

      chunk.copy(lengthBuffer, bytesRead);
      bytesRead += chunk.length;

      if (bytesRead < 4) {
        process.stdin.once('readable', readLength);
        return;
      }

      const length = lengthBuffer.readUInt32LE(0);
      readMessageBody(length);
    };

    const readMessageBody = (length) => {
      const messageBuffer = Buffer.alloc(length);
      let messageBytesRead = 0;

      const readBody = () => {
        const chunk = process.stdin.read(length - messageBytesRead);
        if (!chunk) {
          process.stdin.once('readable', readBody);
          return;
        }

        chunk.copy(messageBuffer, messageBytesRead);
        messageBytesRead += chunk.length;

        if (messageBytesRead < length) {
          process.stdin.once('readable', readBody);
          return;
        }

        try {
          const message = JSON.parse(messageBuffer.toString('utf8'));
          resolve(message);
        } catch (err) {
          reject(new Error(`Invalid JSON: ${err.message}`));
        }
      };

      readBody();
    };

    readLength();
  });
}

function sendMessage(message) {
  const json = JSON.stringify(message);
  const buffer = Buffer.from(json, 'utf8');
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32LE(buffer.length, 0);

  process.stdout.write(lengthBuffer);
  process.stdout.write(buffer);
}

// Main loop

async function main() {
  const bridge = new DebugBridge();

  // Handle stdin close
  process.stdin.on('end', () => {
    bridge.disconnect();
    process.exit(0);
  });

  // Set stdin to raw mode for binary reading
  if (process.stdin.setRawMode) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();

  // Send ready message
  sendMessage({ type: 'ready', version: '0.0.1' });

  // Message loop
  while (true) {
    try {
      const message = await readMessage();
      const response = await bridge.handleMessage(message);
      sendMessage(response);
    } catch (err) {
      if (err.code === 'ERR_STREAM_PREMATURE_CLOSE' || err.message.includes('stream')) {
        // stdin closed, exit gracefully
        break;
      }
      sendMessage({ type: 'error', error: err.message });
    }
  }

  bridge.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
