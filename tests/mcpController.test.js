import test from 'node:test';
import assert from 'node:assert/strict';

import { createMcpController } from '../public/modules/mcp.js';

test('createMcpController renders server list with status badges and tools with quick use buttons', async () => {
  const mcpServersList = { innerHTML: '', querySelectorAll: () => [] };
  const mcpToolsList = { innerHTML: '', querySelectorAll: () => [] };
  const mcpCallServerId = { value: '', closest: () => ({ open: false, scrollIntoView: () => {} }) };
  const mcpCallToolName = { value: '' };
  const mcpCallArgs = { value: '', focus: () => {} };
  let status = null;

  const controller = createMcpController({
    els: {
      mcpServersList,
      mcpToolsList,
      mcpCallServerId,
      mcpCallToolName,
      mcpCallArgs,
      providerStatus: {}
    },
    apiRequest: async (path) => {
      if (path === '/api/mcp/servers') {
        return {
          servers: [
            {
              id: 'filesystem',
              name: '本地文件系统',
              transport: 'stdio',
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-filesystem', './data'],
              connected: true,
              toolCount: 2,
              enabled: true
            }
          ]
        };
      }
      if (path === '/api/mcp/tools') {
        return {
          tools: [
            {
              serverId: 'filesystem',
              toolName: 'read_file',
              description: '读取文件内容'
            }
          ]
        };
      }
      return {};
    },
    setStatus: (el, msg, type) => {
      status = { msg, type };
    },
    escapeHtmlText: (text) => String(text || '')
  });

  await controller.render();

  assert.match(mcpServersList.innerHTML, /本地文件系统/);
  assert.match(mcpServersList.innerHTML, /mcp-status-badge is-connected/);
  assert.match(mcpServersList.innerHTML, /已连接 \(2 工具\)/);

  assert.match(mcpToolsList.innerHTML, /read_file/);
  assert.match(mcpToolsList.innerHTML, /mcp-use-tool-btn/);
  assert.match(mcpToolsList.innerHTML, /⚡ 填入并调用/);

  // Test useTool
  controller.useTool('filesystem', 'read_file');
  assert.equal(mcpCallServerId.value, 'filesystem');
  assert.equal(mcpCallToolName.value, 'read_file');
  assert.equal(status?.type, 'ok');
});

test('createMcpController applyPreset populates server configuration form', () => {
  const mcpEditId = { value: '', disabled: false, closest: () => ({ open: false }) };
  const mcpEditName = { value: '' };
  const mcpEditCommand = { value: '' };
  const mcpEditArgs = { value: '' };
  const mcpEditEnabled = { checked: false };
  let status = null;

  const controller = createMcpController({
    els: {
      mcpEditId,
      mcpEditName,
      mcpEditCommand,
      mcpEditArgs,
      mcpEditEnabled,
      providerStatus: {}
    },
    setStatus: (el, msg, type) => {
      status = { msg, type };
    },
    escapeHtmlText: (text) => String(text || '')
  });

  controller.applyPreset('sqlite');

  assert.equal(mcpEditId.value, 'sqlite');
  assert.equal(mcpEditName.value, '知识图谱数据库');
  assert.equal(mcpEditCommand.value, 'uvx');
  assert.equal(mcpEditArgs.value, 'mcp-server-sqlite --db-path ./data/knowledge-graph.sqlite');
  assert.equal(mcpEditEnabled.checked, true);
  assert.match(status?.msg, /已载入预设模版/);
});
