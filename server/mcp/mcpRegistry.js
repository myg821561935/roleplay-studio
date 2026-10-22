/**
 * MCP (Model Context Protocol) 注册中心
 * 管理用户配置的 MCP server 列表，提供工具列表与调用入口
 * 实际 transport 由调用方注入（便于测试和未来扩展）
 */

/**
 * @typedef {Object} McpServerConfig
 * @property {string} id
 * @property {string} name
 * @property {string} transport - 'stdio' | 'sse' | 'http'
 * @property {string} [command] - stdio transport 用
 * @property {string[]} [args]
 * @property {Object} [env]
 * @property {string} [url] - sse/http transport 用
 * @property {boolean} enabled
 */

/**
 * @typedef {Object} McpTool
 * @property {string} serverId
 * @property {string} serverName
 * @property {string} toolName
 * @property {string} description
 * @property {Object} inputSchema
 */

export class McpRegistry {
  constructor({ transportFactory } = {}) {
    /** @type {Map<string, {config: McpServerConfig, client: any, tools: McpTool[]}>} */
    this.connections = new Map();
    this.transportFactory = transportFactory;
  }

  /**
   * 注册一个 MCP server 配置（不立即连接）
   */
  upsertConfig(config) {
    const id = String(config?.id || '').trim();
    if (!id) throw new Error('MCP_CONFIG_MISSING_ID');
    const normalized = normalizeConfig(config);
    this.connections.set(id, { config: normalized, client: null, tools: [] });
    return normalized;
  }

  /**
   * 连接并获取工具列表
   */
  async connect(id) {
    const entry = this.connections.get(id);
    if (!entry) throw new Error(`MCP_SERVER_NOT_FOUND: ${id}`);
    if (!entry.config.enabled) throw new Error(`MCP_SERVER_DISABLED: ${id}`);
    if (!this.transportFactory) throw new Error('MCP_NO_TRANSPORT_FACTORY');

    // 关闭旧连接
    if (entry.client?.close) {
      try { entry.client.close(); } catch {}
    }

    const client = await this.transportFactory(entry.config);
    entry.client = client;
    let tools = [];
    try {
      tools = await client.listTools();
    } catch (err) {
      entry.lastError = err.message;
      tools = [];
    }
    entry.tools = tools.map((t) => ({
      serverId: id,
      serverName: entry.config.name,
      toolName: t.name,
      description: t.description || '',
      inputSchema: t.inputSchema || {}
    }));
    return entry.tools;
  }

  /**
   * 调用工具
   */
  async callTool({ serverId, toolName, arguments: args = {}, signal = null }) {
    const entry = this.connections.get(serverId);
    if (!entry) throw new Error(`MCP_SERVER_NOT_FOUND: ${serverId}`);
    if (!entry.client) throw new Error(`MCP_SERVER_NOT_CONNECTED: ${serverId}`);
    signal?.throwIfAborted();
    return entry.client.callTool({ name: toolName, arguments: args, ...(signal ? { signal } : {}) });
  }

  /**
   * 列出所有已连接 server 的工具
   */
  listAllTools() {
    const all = [];
    for (const entry of this.connections.values()) {
      if (entry.tools.length) all.push(...entry.tools);
    }
    return all;
  }

  /**
   * 列出所有 server 配置
   */
  listServers() {
    return Array.from(this.connections.values()).map((entry) => ({
      id: entry.config.id,
      name: entry.config.name,
      transport: entry.config.transport,
      enabled: entry.config.enabled,
      connected: Boolean(entry.client),
      toolCount: entry.tools.length,
      lastError: entry.lastError || ''
    }));
  }

  /**
   * 删除一个 server
   */
  removeServer(id) {
    const entry = this.connections.get(id);
    if (entry?.client?.close) {
      try { entry.client.close(); } catch {}
    }
    this.connections.delete(id);
  }

  /**
   * 关闭所有连接
   */
  close() {
    for (const entry of this.connections.values()) {
      if (entry.client?.close) {
        try { entry.client.close(); } catch {}
      }
    }
    this.connections.clear();
  }
}

function normalizeConfig(config) {
  const id = String(config.id || '').trim();
  const name = String(config.name || id).trim().slice(0, 60);
  const transport = ['stdio', 'sse', 'http'].includes(String(config.transport || '')) ? config.transport : 'stdio';
  return {
    id,
    name,
    transport,
    command: String(config.command || '').trim(),
    args: Array.isArray(config.args) ? config.args.map(String) : [],
    env: config.env && typeof config.env === 'object' && !Array.isArray(config.env) ? config.env : {},
    url: String(config.url || '').trim(),
    enabled: config.enabled !== false
  };
}
