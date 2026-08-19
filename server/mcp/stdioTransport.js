/**
 * MCP stdio transport：通过 child_process 与 MCP server 通信
 * 仅实现 tools/list 和 tools/call，使用 JSON-RPC over stdio
 */

import { spawn } from 'node:child_process';
import { APP_VERSION } from '../releaseInfo.js';

const PROTOCOL_VERSION = '2024-11-05';

export class StdioMcpClient {
  constructor({ command, args = [], env = {} }) {
    this.command = String(command || '').trim();
    if (!this.command) throw new Error('MCP_STDIO_REQUIRES_COMMAND');
    this.args = Array.isArray(args) ? args.map(String) : [];
    this.env = env && typeof env === 'object' && !Array.isArray(env) ? env : {};
    this.process = null;
    this.buffer = '';
    this.pendingRequest = null;
    this.requestQueue = [];
    this.nextId = 1;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      try {
        this.process = spawn(this.command, this.args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, ...this.env }
        });
        this.process.stdout.on('data', (data) => this.handleData(data));
        this.process.on('error', (err) => reject(err));
        this.process.on('exit', (code) => {
          this.lastError = `MCP server exited with code ${code}`;
          this.rejectAllPending(new Error(this.lastError));
        });
        // 初始化握手
        this.sendRequest({
          jsonrpc: '2.0',
          id: this.nextId++,
          method: 'initialize',
          params: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: 'local-roleplay-agent', version: APP_VERSION }
          }
        }).then(() => {
          this.sendNotification({ jsonrpc: '2.0', method: 'notifications/initialized' });
          resolve();
        }).catch(reject);
      } catch (err) {
        reject(err);
      }
    });
  }

  handleData(data) {
    this.buffer += data.toString('utf8');
    let idx;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      try {
        const message = JSON.parse(line);
        this.handleMessage(message);
      } catch {
        // 忽略非 JSON 行
      }
    }
  }

  handleMessage(message) {
    if (message.id !== undefined && (message.result !== undefined || message.error)) {
      const pending = this.pendingRequest;
      this.pendingRequest = null;
      if (pending) {
        if (message.error) {
          pending.reject(new Error(message.error.message || 'MCP request failed'));
        } else {
          pending.resolve(message.result);
        }
      }
      this.processQueue();
    }
  }

  async sendRequest(request) {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ request, resolve, reject });
      this.processQueue();
    });
  }

  sendNotification(notification) {
    if (!this.process?.stdin?.writable) return;
    this.process.stdin.write(`${JSON.stringify(notification)}\n`);
  }

  processQueue() {
    if (this.pendingRequest) return;
    const next = this.requestQueue.shift();
    if (!next) return;
    this.pendingRequest = next;
    if (!this.process?.stdin?.writable) {
      next.reject(new Error('MCP transport not connected'));
      this.pendingRequest = null;
      return;
    }
    this.process.stdin.write(`${JSON.stringify(next.request)}\n`);
  }

  async listTools() {
    const result = await this.sendRequest({
      jsonrpc: '2.0',
      id: this.nextId++,
      method: 'tools/list',
      params: {}
    });
    return Array.isArray(result?.tools) ? result.tools : [];
  }

  async callTool({ name, arguments: args = {} }) {
    return this.sendRequest({
      jsonrpc: '2.0',
      id: this.nextId++,
      method: 'tools/call',
      params: { name, arguments: args }
    });
  }

  rejectAllPending(error) {
    if (this.pendingRequest) {
      this.pendingRequest.reject(error);
      this.pendingRequest = null;
    }
    this.requestQueue.forEach((item) => item.reject(error));
    this.requestQueue = [];
  }

  close() {
    if (this.process) {
      try { this.process.kill(); } catch {}
      this.process = null;
    }
    this.rejectAllPending(new Error('Transport closed'));
  }
}
