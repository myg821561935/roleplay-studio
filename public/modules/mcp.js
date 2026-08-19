export function createMcpController({ els, apiRequest, setStatus, escapeHtmlText } = {}) {
  let serversCache = [];
  let toolsCache = [];

  const PRESETS = {
    filesystem: {
      id: 'filesystem',
      name: '本地文件系统',
      command: 'npx',
      args: '-y @modelcontextprotocol/server-filesystem ./data',
      enabled: true
    },
    fetch: {
      id: 'fetch',
      name: '网页获取服务',
      command: 'uvx',
      args: 'mcp-server-fetch',
      enabled: true
    },
    sqlite: {
      id: 'sqlite',
      name: '知识图谱数据库',
      command: 'uvx',
      args: 'mcp-server-sqlite --db-path ./data/knowledge-graph.sqlite',
      enabled: true
    },
    brave: {
      id: 'brave-search',
      name: 'Brave 搜索',
      command: 'npx',
      args: '-y @modelcontextprotocol/server-brave-search',
      enabled: true
    }
  };

  async function render() {
    if (!els.mcpServersList && !els.mcpToolsList) return;
    try {
      const [{ servers }, { tools }] = await Promise.all([
        apiRequest('/api/mcp/servers'),
        apiRequest('/api/mcp/tools').catch(() => ({ tools: [] }))
      ]);
      serversCache = Array.isArray(servers) ? servers : [];
      toolsCache = Array.isArray(tools) ? tools : [];
    } catch {
      serversCache = [];
      toolsCache = [];
    }
    renderServers();
    renderTools();
  }

  function renderServers() {
    if (!els.mcpServersList) return;
    if (!serversCache.length) {
      els.mcpServersList.innerHTML = '<div class="module-empty-note">尚未配置 MCP Server，可点击下方快速模版一键添加</div>';
      return;
    }
    els.mcpServersList.innerHTML = serversCache.map((server) => {
      const id = escapeHtmlText(server.id);
      const name = escapeHtmlText(server.name || server.id);
      const commandStr = escapeHtmlText(`${server.command || ''} ${Array.isArray(server.args) ? server.args.join(' ') : ''}`.trim());
      const connected = server.connected
        ? `<span class="mcp-status-badge is-connected"><span class="mcp-status-dot"></span>已连接 (${Number(server.toolCount || 0)} 工具)</span>`
        : '<span class="mcp-status-badge is-disconnected"><span class="mcp-status-dot"></span>未连接</span>';
      const enabled = server.enabled ? '' : '<span class="mcp-status-badge is-disabled">已禁用</span>';
      const lastError = server.lastError ? `<div class="module-inline-error">${escapeHtmlText(server.lastError)}</div>` : '';
      const connectBtn = server.connected
        ? `<button class="ghost-button compact" type="button" data-mcp-action="disconnect" data-mcp-id="${id}">断开</button>`
        : `<button class="primary-button compact" type="button" data-mcp-action="connect" data-mcp-id="${id}">⚡ 连接</button>`;

      return `<div class="mcp-server-row">
        <div class="mcp-server-heading">
          <div class="mcp-server-title">
            <strong>${name}</strong>
            <span class="module-code-label">[${id}]</span>
            ${enabled}
          </div>
          <div>${connected}</div>
        </div>
        ${commandStr ? `<div class="mcp-server-command"><code>${commandStr}</code></div>` : ''}
        ${lastError}
        <div class="mcp-server-actions">
          ${connectBtn}
          <button class="ghost-button compact" type="button" data-mcp-action="edit" data-mcp-id="${id}">编辑</button>
          <button class="ghost-button compact" type="button" data-mcp-action="delete" data-mcp-id="${id}">删除</button>
        </div>
      </div>`;
    }).join('');

    els.mcpServersList.querySelectorAll('[data-mcp-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const action = button.dataset.mcpAction;
        const id = button.dataset.mcpId;
        if (action === 'connect') connect(id);
        else if (action === 'disconnect') disconnect(id);
        else if (action === 'edit') edit(id);
        else if (action === 'delete') remove(id);
      });
    });
  }

  function renderTools() {
    if (!els.mcpToolsList) return;
    if (!toolsCache.length) {
      els.mcpToolsList.innerHTML = '<div class="module-empty-note">暂无可用工具。请配置并连接 Server 后自动载入。</div>';
      return;
    }
    els.mcpToolsList.innerHTML = toolsCache.map((tool) => {
      const server = escapeHtmlText(tool.serverId);
      const name = escapeHtmlText(tool.toolName);
      const description = escapeHtmlText(tool.description || '').slice(0, 100);
      return `<div class="mcp-tool-row">
        <div class="mcp-tool-info">
          <div class="mcp-tool-heading">
            <strong>${name}</strong>
            <span class="module-code-label">@${server}</span>
          </div>
          ${description ? `<div class="module-muted mcp-tool-desc">${description}</div>` : ''}
        </div>
        <div class="mcp-tool-actions">
          <button class="primary-button compact mcp-use-tool-btn" type="button" data-mcp-use-server="${server}" data-mcp-use-tool="${name}">⚡ 填入并调用</button>
        </div>
      </div>`;
    }).join('');

    els.mcpToolsList.querySelectorAll('.mcp-use-tool-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const serverId = btn.dataset.mcpUseServer;
        const toolName = btn.dataset.mcpUseTool;
        useTool(serverId, toolName);
      });
    });
  }

  function useTool(serverId, toolName) {
    const doc = typeof document !== 'undefined' ? document : null;
    const callDetails = doc?.getElementById('mcp-call-details') || els.mcpCallServerId?.closest?.('details');
    if (callDetails) callDetails.open = true;
    if (els.mcpCallServerId) els.mcpCallServerId.value = serverId;
    if (els.mcpCallToolName) els.mcpCallToolName.value = toolName;
    if (els.mcpCallArgs && !els.mcpCallArgs.value.trim()) {
      els.mcpCallArgs.value = '{\n  \n}';
    }
    callDetails?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    els.mcpCallArgs?.focus?.();
    setStatus(els.providerStatus, `已将工具 ${toolName} 填入调用表单`, 'ok');
  }

  function applyPreset(presetKey) {
    const preset = PRESETS[presetKey];
    if (!preset) return;
    const doc = typeof document !== 'undefined' ? document : null;
    const editDetails = doc?.getElementById('mcp-edit-details') || els.mcpEditId?.closest?.('details');
    if (editDetails) editDetails.open = true;
    if (els.mcpEditId) {
      els.mcpEditId.value = preset.id;
      els.mcpEditId.disabled = false;
    }
    if (els.mcpEditName) els.mcpEditName.value = preset.name;
    if (els.mcpEditCommand) els.mcpEditCommand.value = preset.command;
    if (els.mcpEditArgs) els.mcpEditArgs.value = preset.args;
    if (els.mcpEditEnabled) els.mcpEditEnabled.checked = preset.enabled;
    setStatus(els.providerStatus, `已载入预设模版：${preset.name}`, 'ok');
  }

  function edit(id) {
    const server = serversCache.find((item) => item.id === id);
    if (!server) return;
    const doc = typeof document !== 'undefined' ? document : null;
    const editDetails = doc?.getElementById('mcp-edit-details') || els.mcpEditId?.closest?.('details');
    if (editDetails) editDetails.open = true;
    if (els.mcpEditId) {
      els.mcpEditId.value = server.id;
      els.mcpEditId.disabled = true;
    }
    if (els.mcpEditName) els.mcpEditName.value = server.name || '';
    if (els.mcpEditCommand) els.mcpEditCommand.value = server.command || '';
    if (els.mcpEditArgs) els.mcpEditArgs.value = Array.isArray(server.args) ? server.args.join(' ') : '';
    if (els.mcpEditEnabled) els.mcpEditEnabled.checked = server.enabled !== false;
    if (els.mcpCallServerId && !els.mcpCallServerId.value) els.mcpCallServerId.value = server.id;
  }

  function clearForm() {
    if (els.mcpEditId) {
      els.mcpEditId.value = '';
      els.mcpEditId.disabled = false;
    }
    if (els.mcpEditName) els.mcpEditName.value = '';
    if (els.mcpEditCommand) els.mcpEditCommand.value = '';
    if (els.mcpEditArgs) els.mcpEditArgs.value = '';
    if (els.mcpEditEnabled) els.mcpEditEnabled.checked = true;
  }

  async function save() {
    const id = (els.mcpEditId?.value || '').trim();
    const command = (els.mcpEditCommand?.value || '').trim();
    if (!id || !command) {
      setStatus(els.providerStatus, !id ? '请填写 MCP Server ID' : '请填写启动命令', 'error');
      return;
    }
    const serverConfig = {
      id,
      name: (els.mcpEditName?.value || '').trim() || id,
      transport: 'stdio',
      command,
      args: (els.mcpEditArgs?.value || '').trim().split(/\s+/).filter(Boolean),
      enabled: els.mcpEditEnabled?.checked !== false
    };
    try {
      setStatus(els.providerStatus, '正在保存...', 'busy');
      const remaining = serversCache.filter((server) => server.id !== id);
      remaining.push({ ...serverConfig, connected: false, toolCount: 0 });
      const { servers } = await apiRequest('/api/mcp/servers', { method: 'PUT', body: { servers: remaining } });
      serversCache = servers || [];
      renderServers();
      clearForm();
      setStatus(els.providerStatus, 'MCP 配置已保存', 'ok');
    } catch (error) {
      setStatus(els.providerStatus, `保存失败：${error.message}`, 'error');
    }
  }

  async function remove(id) {
    try {
      setStatus(els.providerStatus, '正在删除...', 'busy');
      const { servers } = await apiRequest('/api/mcp/servers', {
        method: 'PUT',
        body: { servers: serversCache.filter((server) => server.id !== id) }
      });
      serversCache = servers || [];
      renderServers();
      renderTools();
      setStatus(els.providerStatus, 'MCP Server 已删除', 'ok');
    } catch (error) {
      setStatus(els.providerStatus, `删除失败：${error.message}`, 'error');
    }
  }

  async function connect(id) {
    try {
      setStatus(els.providerStatus, `正在连接 ${id}...`, 'busy');
      const { tools } = await apiRequest(`/api/mcp/servers/${encodeURIComponent(id)}/connect`, { method: 'POST' });
      setStatus(els.providerStatus, `${id} 已连接，共 ${tools?.length || 0} 个工具`, 'ok');
      await render();
    } catch (error) {
      setStatus(els.providerStatus, `连接失败：${error.message}`, 'error');
    }
  }

  async function disconnect(id) {
    try {
      await apiRequest(`/api/mcp/servers/${encodeURIComponent(id)}/disconnect`, { method: 'POST' });
      setStatus(els.providerStatus, `${id} 已断开`, 'ok');
      await render();
    } catch (error) {
      setStatus(els.providerStatus, `断开失败：${error.message}`, 'error');
    }
  }

  async function callTool() {
    if (!els.mcpCallResult) return;
    const serverId = (els.mcpCallServerId?.value || '').trim();
    const toolName = (els.mcpCallToolName?.value || '').trim();
    if (!serverId || !toolName) {
      els.mcpCallResult.innerHTML = '<div class="module-inline-error">请填写 Server ID 和工具名</div>';
      return;
    }
    let args = {};
    try {
      args = (els.mcpCallArgs?.value || '').trim() ? JSON.parse(els.mcpCallArgs.value) : {};
    } catch {
      els.mcpCallResult.innerHTML = '<div class="module-inline-error">参数不是有效的 JSON</div>';
      return;
    }
    els.mcpCallResult.innerHTML = '<div class="module-empty-note">调用中...</div>';
    if (els.mcpCallExecute) els.mcpCallExecute.disabled = true;
    try {
      const { result } = await apiRequest('/api/mcp/tools/call', {
        method: 'POST', body: { serverId, toolName, arguments: args }
      });
      els.mcpCallResult.innerHTML = `<details open><summary class="is-ok" style="cursor:pointer;font-weight:600;">调用成功</summary><pre style="background:var(--panel-deep);padding:8px;border-radius:6px;margin-top:6px;overflow-x:auto;">${escapeHtmlText(JSON.stringify(result, null, 2))}</pre></details>`;
    } catch (error) {
      els.mcpCallResult.innerHTML = `<div class="module-inline-error">调用失败：${escapeHtmlText(error.message)}</div>`;
    } finally {
      if (els.mcpCallExecute) els.mcpCallExecute.disabled = false;
    }
  }

  function bindEvents() {
    els.mcpSaveServer?.addEventListener('click', save);
    els.mcpClearForm?.addEventListener('click', clearForm);
    els.mcpCallExecute?.addEventListener('click', callTool);
    const doc = typeof document !== 'undefined' ? document : null;
    doc?.querySelectorAll?.('[data-mcp-preset]').forEach((btn) => {
      btn.addEventListener('click', () => applyPreset(btn.dataset.mcpPreset));
    });
  }

  return { bindEvents, render, save, clearForm, callTool, useTool, applyPreset };
}
