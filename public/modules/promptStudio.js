import { createHistoryRepairController } from './historyRepair.js';
import { renderPromptChanges } from './promptChangeView.js';
import { exportPromptComparison } from './promptComparison.js';
function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  return String(value ?? '').trim();
}

function compact(value, max = 220) {
  const source = text(value).replace(/\s+/g, ' ');
  return source.length > max ? `${source.slice(0, max - 1)}…` : source;
}

function moduleStatusLabel(status) {
  return {
    running: '运行中',
    disabled: '已关闭',
    empty: '无静态内容',
    'suppressed-for-integrity': '完整性保护',
    'evicted-by-budget': '预算淘汰',
    truncated: '已截断',
    'not-running': '未运行'
  }[status] || '未知状态';
}

function blockStatusLabel(status) {
  return {
    running: '已发送',
    truncated: '已压缩',
    'evicted-by-budget': '预算淘汰'
  }[status] || '';
}

function makeElement(documentObject, tagName, className, value = '') {
  const element = documentObject.createElement(tagName);
  if (className) element.className = className;
  if (value) element.textContent = value;
  return element;
}

export function createPromptStudioController({
  state = {},
  els = {},
  apiRequest = async () => ({}),
  getCurrentSessionId = () => 'main',
  getPreviewContent = () => '',
  setStatus = () => {},
  humanizeApiError = (error) => error?.message || String(error),
  promptAction = () => null,
  onIntegrityChange = () => {},
  onOpenCopy = () => {},
  documentObject = globalThis.document
} = {}) {
  const repairContainer = els.promptStudio?.appendChild && documentObject?.createElement ? documentObject.createElement('div') : null;
  if (repairContainer) els.promptStudio.appendChild(repairContainer);
  const historyRepair = createHistoryRepairController({ container: repairContainer, documentObject, apiRequest, getCurrentSessionId, onOpenCopy });
  let snapshot = null;
  let snapshotSessionId = null;
  let eventsBound = false;
  let busy = false;
  let draggedModuleId = '';
  let showRequest = false;

  function getModules() {
    return Array.isArray(state.config?.promptModules) ? state.config.promptModules : [];
  }

  function setBusy(next) {
    busy = next;
    if (els.promptStudioRefresh) els.promptStudioRefresh.disabled = next;
    if (els.promptStudioShowRequest) els.promptStudioShowRequest.disabled = next;
  }

  function renderIntegrity(integrity = {}) {
    if (!els.promptStudioIntegrity) return;
    const suppressed = Array.isArray(integrity?.suppressedBundles) ? integrity.suppressedBundles : [];
    els.promptStudioIntegrity.replaceChildren();
    const tone = makeElement(documentObject, 'strong', suppressed.length ? 'prompt-studio-integrity is-warning' : 'prompt-studio-integrity is-ok', suppressed.length ? '完整性保护：部分社区预设没有运行' : '预设完整性：当前组合可完整运行');
    els.promptStudioIntegrity.append(tone);
    if (suppressed.length) {
      const details = makeElement(documentObject, 'span', 'prompt-studio-integrity-detail', suppressed
        .map((item) => `${text(item.title) || '社区预设'}：${text(item.reason) || '完整性保护'}`)
        .join('；'));
      els.promptStudioIntegrity.append(details);
    }
  }

  function renderModules(modules = []) {
    const container = els.promptStudioModules;
    if (!container || !documentObject?.createElement) return;
    container.replaceChildren();
    if (!modules.length) {
      container.append(makeElement(documentObject, 'p', 'module-empty-note', '当前故事没有可编辑的 Prompt 模块。默认保护层仍会正常运行。'));
      return;
    }
    for (const module of modules) {
      const row = makeElement(documentObject, 'article', 'prompt-studio-module');
      row.draggable = module.orderLocked !== true;
      row.dataset.moduleId = text(module.id);
      const heading = makeElement(documentObject, 'div', 'prompt-studio-module-heading');
      const grip = makeElement(documentObject, 'span', 'prompt-studio-grip', module.orderLocked ? '—' : '⠿');
      grip.setAttribute('aria-hidden', 'true');
      const title = makeElement(documentObject, 'strong', '', text(module.title) || '未命名模块');
      const status = makeElement(documentObject, 'span', `prompt-studio-status ${text(module.status)}`, moduleStatusLabel(module.status));
      heading.append(grip, title, status);
      const meta = makeElement(documentObject, 'p', 'prompt-studio-module-meta', [
        `${text(module.role) || 'system'} · ${text(module.position) || 'system'}`,
        `深度 ${Number(module.depth || 0)}`,
        `约 ${Number(module.tokenEstimate || 0)} tokens`,
        text(module.trigger) || '静态预设模块'
      ].join(' · '));
      const reason = text(module.evictionReason);
      const orderHint = module.orderLocked
        ? '兼容模块保留原始发送顺序；可在本会话开关或局部覆盖。'
        : '';
      if (reason || orderHint) row.append(
        heading,
        meta,
        makeElement(documentObject, 'p', 'prompt-studio-module-reason', [reason, orderHint].filter(Boolean).join(' '))
      );
      else row.append(heading, meta);
      const controls = makeElement(documentObject, 'div', 'prompt-studio-module-controls');
      const toggleLabel = makeElement(documentObject, 'label', 'prompt-studio-toggle');
      const toggle = documentObject.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = module.enabled !== false;
      toggle.dataset.promptStudioAction = 'toggle';
      toggle.dataset.moduleId = text(module.id);
      toggleLabel.append(toggle, documentObject.createTextNode('本会话启用'));
      const override = makeElement(documentObject, 'button', 'ghost-button compact', '局部覆盖');
      override.type = 'button';
      override.dataset.promptStudioAction = 'override';
      override.dataset.moduleId = text(module.id);
      controls.append(toggleLabel, override);
      row.append(controls);
      container.append(row);
    }
  }

  function renderBlocks(blocks = []) {
    const container = els.promptStudioBlocks;
    if (!container || !documentObject?.createElement) return;
    container.replaceChildren();
    if (!blocks.length) {
      container.append(makeElement(documentObject, 'p', 'module-empty-note', '尚未生成最终请求预览。'));
      return;
    }
    for (const block of blocks) {
      const row = makeElement(documentObject, 'li', 'prompt-studio-block');
      const order = makeElement(documentObject, 'span', 'prompt-studio-block-order', String(block.order || '—').padStart(2, '0'));
      const main = makeElement(documentObject, 'div', 'prompt-studio-block-main');
      const heading = makeElement(documentObject, 'div', 'prompt-studio-block-heading');
      heading.append(
        makeElement(documentObject, 'strong', '', text(block.title) || '本地提示词区块')
      );
      const statusLabel = blockStatusLabel(text(block.status));
      if (statusLabel) heading.append(makeElement(documentObject, 'span', `prompt-studio-status ${text(block.status)}`, statusLabel));
      main.append(
        heading,
        makeElement(documentObject, 'span', 'prompt-studio-block-meta', [
          text(block.role) || 'system',
          block.depth === null || block.depth === undefined ? '固定位置' : `深度 ${block.depth}`,
          `约 ${Number(block.tokenEstimate || 0)} tokens`,
          text(block.trigger) || text(block.kind)
        ].filter(Boolean).join(' · '))
      );
      if (text(block.evictionReason)) {
        main.append(makeElement(documentObject, 'span', 'prompt-studio-block-reason', text(block.evictionReason)));
      }
      row.append(order, main);
      container.append(row);
    }
  }

  function renderRequest(messages = []) {
    if (!els.promptStudioRequest) return;
    els.promptStudioRequest.hidden = !showRequest;
    if (!showRequest) return;
    els.promptStudioRequest.textContent = JSON.stringify(messages, null, 2);
  }

  function render() {
    if (snapshotSessionId !== getCurrentSessionId()) snapshot = null;
    historyRepair.render();
    const studio = snapshot?.promptStudio;
    renderIntegrity(studio?.integrity || state.session?.memory?.promptRuntime?.communityPresetIntegrity);
    if (studio?.narrationDrift?.status === 'possible-conflict' && els.promptStudioIntegrity) {
      els.promptStudioIntegrity.append(makeElement(documentObject, 'p', 'prompt-studio-integrity is-warning', studio.narrationDrift.message));
    }
    if (els.promptStudioIntegrity) {
      for (const issue of [...(studio?.sourceConflicts?.conflicts || []), ...(studio?.qualityAudit?.issues || [])]) els.promptStudioIntegrity.append(makeElement(documentObject, 'p', 'prompt-studio-integrity is-warning', issue.message));
      const facts = studio?.factSources || [];
      if (facts.length) els.promptStudioIntegrity.append(makeElement(documentObject, 'p', '', '记忆来源：' + facts.map(f => `${f.title}（${({card:'原卡', 'user-confirmed':'用户确认', 'history-observed':'历史中出现', 'model-inference':'模型推测'})[f.origin] || '来源待核实'}；${f.reviewStatus}）`).join('；')));
      if (studio?.budgetAccounting?.optionalTokensRemoved) els.promptStudioIntegrity.append(makeElement(documentObject, 'p', '', `预算不足，已优先移除约 ${studio.budgetAccounting.optionalTokensRemoved} tokens 的可选 Agent 补充；下方可查看保留与淘汰区块。`));
    }
    renderModules(studio?.modules || []);
    renderBlocks(studio?.blocks || []);
    renderPromptChanges(els.promptStudioChanges, studio?.changes || [], documentObject);
    renderRequest(snapshot?.request?.messages || []);
    if (els.promptStudioSummary) {
      const budgets = studio?.budgets || {};
      els.promptStudioSummary.textContent = snapshot
        ? `最终请求约 ${Number(snapshot.tokenEstimate || 0)} tokens${budgets.total ? ` / 预算 ${budgets.total}` : ''} · 触发世界书 ${Number(budgets.worldBookActivated || 0)} 条`
        : '使用当前输入或“继续推进”状态生成本地预览。';
    }
  }

  async function refreshPreview() {
    if (busy) return null;
    setBusy(true);
    const requestedSessionId = getCurrentSessionId();
    setStatus(els.promptStudioStatus, '正在组装本地预览...', 'busy');
    try {
      const content = text(getPreviewContent());
      const payload = await apiRequest(`/api/sessions/${encodeURIComponent(getCurrentSessionId())}/prompt-preview`, {
        method: 'POST',
        body: {
          content,
          generationType: content ? 'normal' : 'continue'
        }
      });
      if (!isRecord(payload?.promptStudio) || !isRecord(payload?.request)) throw new Error('PROMPT_PREVIEW_INVALID');
      if (requestedSessionId !== getCurrentSessionId()) return null;
      snapshotSessionId = requestedSessionId;
      snapshot = payload;
      if (!state.session || typeof state.session !== 'object') state.session = {};
      if (!state.session.memory || typeof state.session.memory !== 'object') state.session.memory = {};
      state.session.memory.promptRuntime = {
        ...(state.session.memory.promptRuntime || {}),
        communityPresetIntegrity: snapshot.promptStudio.integrity || { status: 'complete', suppressedBundles: [] }
      };
      render();
      onIntegrityChange(snapshot.promptStudio.integrity || {});
      const integrity = snapshot.promptStudio.integrity || {};
      setStatus(
        els.promptStudioStatus,
        integrity.status === 'suppressed-for-integrity' ? '预览完成：存在完整性保护的社区预设' : '预览已更新；这不会发送模型请求',
        integrity.status === 'suppressed-for-integrity' ? 'warning' : 'ok'
      );
      return snapshot;
    } catch (error) {
      setStatus(els.promptStudioStatus, `预览失败：${humanizeApiError(error)}`, 'error');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function saveModules(nextModules, statusText = '已保存本会话 Prompt 模块') {
    if (busy || !Array.isArray(nextModules)) return null;
    setBusy(true);
    let savedModules = null;
    try {
      const payload = await apiRequest('/api/prompt-modules', {
        method: 'PUT',
        body: { sessionId: getCurrentSessionId(), promptModules: nextModules }
      });
      if (!Array.isArray(payload?.promptModules)) throw new Error('INVALID_PROMPT_MODULES_RESPONSE');
      if (!state.config || typeof state.config !== 'object') state.config = {};
      state.config.promptModules = payload.promptModules;
      setStatus(els.promptStudioStatus, statusText, 'ok');
      savedModules = payload.promptModules;
    } catch (error) {
      setStatus(els.promptStudioStatus, `保存失败：${humanizeApiError(error)}`, 'error');
      return null;
    } finally {
      setBusy(false);
    }
    if (savedModules) await refreshPreview();
    return savedModules;
  }

  async function toggleModule(id, enabled) {
    const next = getModules().map((module) => text(module.id) === id ? { ...module, enabled } : module);
    return saveModules(next, enabled ? '模块已在当前会话启用' : '模块已在当前会话关闭');
  }

  async function overrideModule(id) {
    const current = getModules().find((module) => text(module.id) === id);
    if (!current) return null;
    const value = promptAction('仅覆盖当前会话中的该模块。原始资源不会被修改：', String(current.content || ''));
    if (value === null) return null;
    const next = getModules().map((module) => text(module.id) === id ? { ...module, content: String(value) } : module);
    return saveModules(next, '已保存本会话的局部覆盖');
  }

  async function moveModule(sourceId, targetId) {
    if (!sourceId || !targetId || sourceId === targetId) return null;
    const next = [...getModules()];
    const sourceIndex = next.findIndex((module) => text(module.id) === sourceId);
    const targetIndex = next.findIndex((module) => text(module.id) === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return null;
    if (next[sourceIndex]?.extensions?.sillyTavernPreset || next[targetIndex]?.extensions?.sillyTavernPreset) {
      setStatus(els.promptStudioStatus, '社区兼容模块保留原始顺序；可开关或局部覆盖', 'warning');
      return null;
    }
    const [source] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, source);
    return saveModules(next.map((module, index) => ({ ...module, order: index })), '已调整模块运行顺序');
  }

  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;
    els.promptStudioExportComparison?.addEventListener('click', async () => {
      if (busy) return;
      setBusy(true);
      try {
        await exportPromptComparison({ apiRequest, sessionId: getCurrentSessionId(), content: text(getPreviewContent()), documentObject });
        setStatus(els.promptStudioStatus, '已导出两种模式的请求与盲评表；尚未调用模型。', 'ok');
      } catch (error) { setStatus(els.promptStudioStatus, humanizeApiError(error), 'error'); }
      finally { setBusy(false); }
    });
    els.promptStudioRefresh?.addEventListener('click', () => { void refreshPreview(); });
    els.promptStudioShowRequest?.addEventListener('click', () => {
      showRequest = !showRequest;
      if (els.promptStudioShowRequest) els.promptStudioShowRequest.textContent = showRequest ? '收起最终请求' : '查看最终请求';
      renderRequest(snapshot?.request?.messages || []);
    });
    els.promptStudioModules?.addEventListener('change', (event) => {
      const target = event.target;
      if (target?.dataset?.promptStudioAction === 'toggle') {
        void toggleModule(text(target.dataset.moduleId), target.checked);
      }
    });
    els.promptStudioModules?.addEventListener('click', (event) => {
      const target = event.target?.closest?.('[data-prompt-studio-action]');
      if (target?.dataset?.promptStudioAction === 'override') {
        void overrideModule(text(target.dataset.moduleId));
      }
    });
    els.promptStudioModules?.addEventListener('dragstart', (event) => {
      draggedModuleId = text(event.target?.closest?.('[data-module-id]')?.dataset?.moduleId);
      event.dataTransfer?.setData('text/plain', draggedModuleId);
      event.dataTransfer?.setDragImage?.(event.target.closest?.('[data-module-id]'), 16, 16);
    });
    els.promptStudioModules?.addEventListener('dragover', (event) => {
      if (draggedModuleId) event.preventDefault();
    });
    els.promptStudioModules?.addEventListener('drop', (event) => {
      event.preventDefault();
      const targetId = text(event.target?.closest?.('[data-module-id]')?.dataset?.moduleId);
      const sourceId = draggedModuleId || text(event.dataTransfer?.getData('text/plain'));
      draggedModuleId = '';
      void moveModule(sourceId, targetId);
    });
    els.promptStudioModules?.addEventListener('dragend', () => { draggedModuleId = ''; });
  }

  return {
    bindEvents,
    refreshPreview,
    render,
    toggleModule,
    overrideModule,
    moveModule
  };
}
