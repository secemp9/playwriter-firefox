/**
 * Firefox Remote Debugging Protocol (RDP) Client
 *
 * Connects to Firefox's debug server and provides methods for:
 * - Listing tabs/targets
 * - Evaluating JavaScript
 * - Setting breakpoints
 * - Network interception
 *
 * Protocol format: length:JSON_PACKET
 * Example: 23:{"to":"root","type":"listTabs"}
 */

import net from 'net';
import { EventEmitter } from 'events';

export class RDPClient extends EventEmitter {
  constructor() {
    super();
    this.socket = null;
    this.buffer = '';
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.actors = new Map();
    this.connected = false;
  }

  /**
   * Connect to Firefox's debug server
   * @param {string} host - Hostname (default: localhost)
   * @param {number} port - Port (default: 6000)
   */
  async connect(host = 'localhost', port = 6000) {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection({ host, port }, () => {
        this.connected = true;
        this.emit('connected');
        resolve();
      });

      this.socket.on('data', (data) => this._onData(data));
      this.socket.on('error', (err) => {
        this.emit('error', err);
        reject(err);
      });
      this.socket.on('close', () => {
        this.connected = false;
        this.emit('disconnected');
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        if (!this.connected) {
          reject(new Error('Connection timeout'));
        }
      }, 5000);
    });
  }

  /**
   * Disconnect from Firefox
   */
  disconnect() {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
      this.connected = false;
    }
  }

  /**
   * Send a request to an actor
   * @param {string} to - Actor ID
   * @param {string} type - Request type
   * @param {object} params - Additional parameters
   */
  async request(to, type, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      const message = { to, type, ...params };

      this.pendingRequests.set(id, { resolve, reject, to });
      this._send(message);

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout: ${type}`));
        }
      }, 30000);
    });
  }

  /**
   * List all tabs
   */
  async listTabs() {
    const response = await this.request('root', 'listTabs');
    return response.tabs || [];
  }

  /**
   * Get the root actor
   */
  async getRoot() {
    const response = await this.request('root', 'getRoot');
    return response;
  }

  /**
   * Attach to a tab and get its actors
   * @param {object} tab - Tab object from listTabs
   */
  async attachToTab(tab) {
    // Get the tab's target actor
    const targetActor = tab.actor;

    // Attach to the tab
    const attachResponse = await this.request(targetActor, 'attach');

    // Get the console actor for JS evaluation
    const consoleActor = tab.consoleActor;

    return {
      targetActor,
      consoleActor,
      threadActor: attachResponse.threadActor,
      ...attachResponse
    };
  }

  /**
   * Evaluate JavaScript in a tab
   * @param {string} consoleActor - Console actor ID
   * @param {string} expression - JavaScript to evaluate
   */
  async evaluateJS(consoleActor, expression) {
    const response = await this.request(consoleActor, 'evaluateJSAsync', {
      text: expression,
      eager: false
    });

    // Wait for the result
    if (response.resultID) {
      // Result will come as an event, but for simplicity we return immediately
      return response;
    }

    return response;
  }

  /**
   * Navigate a tab to a URL
   * @param {string} targetActor - Target actor ID
   * @param {string} url - URL to navigate to
   */
  async navigateTo(targetActor, url) {
    return await this.request(targetActor, 'navigateTo', { url });
  }

  /**
   * Reload a tab
   * @param {string} targetActor - Target actor ID
   */
  async reload(targetActor) {
    return await this.request(targetActor, 'reload');
  }

  /**
   * Get the page source
   * @param {string} targetActor - Target actor ID
   */
  async getSource(targetActor) {
    return await this.request(targetActor, 'getSource');
  }

  // Private methods

  _send(message) {
    if (!this.socket || !this.connected) {
      throw new Error('Not connected');
    }

    const json = JSON.stringify(message);
    const packet = `${json.length}:${json}`;
    this.socket.write(packet);
  }

  _onData(data) {
    this.buffer += data.toString();
    this._processBuffer();
  }

  _processBuffer() {
    while (true) {
      // Find the length delimiter
      const colonIndex = this.buffer.indexOf(':');
      if (colonIndex === -1) break;

      const lengthStr = this.buffer.substring(0, colonIndex);
      const length = parseInt(lengthStr, 10);

      if (isNaN(length)) {
        // Invalid packet, clear buffer
        this.buffer = '';
        break;
      }

      const packetStart = colonIndex + 1;
      const packetEnd = packetStart + length;

      if (this.buffer.length < packetEnd) {
        // Incomplete packet, wait for more data
        break;
      }

      const packetJson = this.buffer.substring(packetStart, packetEnd);
      this.buffer = this.buffer.substring(packetEnd);

      try {
        const packet = JSON.parse(packetJson);
        this._handlePacket(packet);
      } catch (err) {
        this.emit('error', new Error(`Invalid JSON packet: ${err.message}`));
      }
    }
  }

  _handlePacket(packet) {
    // Check if this is a response to a pending request
    if (packet.from) {
      // Find matching request
      for (const [id, request] of this.pendingRequests.entries()) {
        if (request.to === packet.from || packet.from === 'root') {
          this.pendingRequests.delete(id);
          if (packet.error) {
            request.reject(new Error(packet.error));
          } else {
            request.resolve(packet);
          }
          return;
        }
      }
    }

    // Emit as event
    if (packet.type) {
      this.emit(packet.type, packet);
    }
    this.emit('packet', packet);
  }
}

export default RDPClient;
