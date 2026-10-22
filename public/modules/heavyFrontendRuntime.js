const MAX_CLIENT_BUNDLE_BYTES = 64 * 1024 * 1024;

export function createHeavyFrontendRuntimeController({
  root,
  player,
  apiRequest,
  getProviders = () => [],
  setGlobalStatus = () => {},
  documentObject = globalThis.document,
  windowObject = globalThis.window,
  confirmAction = (message) => globalThis.confirm?.(message),
  promptAction = (message, value) => globalThis.prompt?.(message, value)
} = {}) {
  if (!root || !player) return createNoopController();

  const ui = {
    close: root.querySelector('#close-heavy-frontend-manager'),
    refresh: root.querySelector('#heavy-frontend-refresh'),
    importDirectory: root.querySelector('#heavy-frontend-import-directory'),
    directoryInput: root.querySelector('#heavy-frontend-directory-input'),
    list: root.querySelector('#heavy-frontend-list'),
    detail: root.querySelector('#heavy-frontend-detail'),
    status: root.querySelector('#heavy-frontend-status'),
    count: root.querySelector('#heavy-frontend-count'),
    playerClose: player.querySelector('#close-heavy-frontend-player'),
    playerSnapshot: player.querySelector('#heavy-frontend-save-snapshot'),
    playerRefreshStatus: player.querySelector('#heavy-frontend-runtime-refresh'),
    playerFrame: player.querySelector('#heavy-frontend-frame'),
    playerTitle: player.querySelector('#heavy-frontend-player-title'),
    playerStatus: player.querySelector('#heavy-frontend-player-status'),
    playerUsage: player.querySelector('#heavy-frontend-player-usage')
  };
  const state = {
    packages: [],
    selectedId: '',
    audits: new Map(),
    launch: null,
    statusTimer: null,
    snapshotRequests: new Map()
  };
  let bound = false;

  function bindEvents() {
    if (bound) return false;
    bound = true;
    ui.close?.addEventListener('click', close);
    ui.refresh?.addEventListener('click', () => loadPackages());
    ui.importDirectory?.addEventListener('click', () => ui.directoryInput?.click());
    ui.directoryInput?.addEventListener('change', importDirectory);
    ui.list?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-heavy-frontend-id]');
      if (!button) return;
      state.selectedId = button.dataset.heavyFrontendId || '';
      render();
    });
    ui.detail?.addEventListener('click', handleDetailAction);
    ui.playerClose?.addEventListener('click', closePlayer);
    ui.playerSnapshot?.addEventListener('click', requestSnapshot);
    ui.playerRefreshStatus?.addEventListener('click', refreshRuntimeStatus);
    windowObject?.addEventListener?.('message', handleRuntimeMessage);
    root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close();
    });
    player.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closePlayer();
    });
    return true;
  }

  async function open({ promptImport = false } = {}) {
    root.classList.remove('is-hidden');
    root.setAttribute('aria-hidden', 'false');
    documentObject.body.classList.add('heavy-frontend-open');
    await loadPackages({ announce: false });
    if (promptImport) windowObject.setTimeout(() => ui.directoryInput?.click(), 0);
  }

  function close() {
    root.classList.add('is-hidden');
    root.setAttribute('aria-hidden', 'true');
    if (player.classList.contains('is-hidden')) documentObject.body.classList.remove('heavy-frontend-open');
  }

  async function loadPackages({ announce = true } = {}) {
    setStatus(announce ? '正在刷新重前端包...' : '正在载入本地重前端包...');
    try {
      const payload = await apiRequest('/api/heavy-frontends');
      state.packages = Array.isArray(payload.packages) ? payload.packages : [];
      if (!state.packages.some((item) => item.id === state.selectedId)) {
        state.selectedId = state.packages[0]?.id || '';
      }
      render();
      setStatus(`已载入 ${state.packages.length} 个本地重前端包`, 'ok');
    } catch (error) {
      setStatus(`载入失败：${error.message}`, 'error');
    }
  }

  async function importDirectory(event) {
    const input = event.currentTarget;
    const fileList = Array.from(input.files || []);
    input.value = '';
    if (!fileList.length) return;
    const totalBytes = fileList.reduce((sum, file) => sum + Number(file.size || 0), 0);
    if (totalBytes > MAX_CLIENT_BUNDLE_BYTES) {
      setStatus('导入失败：目录超过 64 MB；大体积媒体请先压缩或移出运行包。', 'error');
      return;
    }
    const sourceName = getSourceDirectoryName(fileList);
    setStatus(`正在读取 ${fileList.length} 个文件（${formatBytes(totalBytes)}）...`);
    try {
      const files = [];
      for (let index = 0; index < fileList.length; index += 1) {
        const file = fileList[index];
        const filePath = stripSourceDirectory(file.webkitRelativePath || file.name, sourceName);
        files.push({
          path: filePath,
          mimeType: file.type || inferMimeType(filePath),
          dataBase64: arrayBufferToBase64(await file.arrayBuffer())
        });
        if (index % 20 === 0) setStatus(`正在读取文件 ${index + 1}/${fileList.length}...`);
      }
      setStatus('正在执行静态风险扫描并生成不可变版本...');
      const result = await apiRequest('/api/heavy-frontends/import', {
        method: 'POST',
        body: {
          spec: 'lra.heavy-frontend-pack/v1',
          title: humanizeSourceName(sourceName),
          sourceName,
          files
        }
      });
      state.selectedId = result.package.id;
      await loadPackages({ announce: false });
      setStatus(result.duplicate
        ? '已识别为现有版本；未重复复制文件。'
        : '导入完成。当前版本可在本地隔离环境观察运行；启动、调用与错误会写入审计。', 'ok');
    } catch (error) {
      setStatus(`导入失败：${humanizeError(error)}`, 'error');
    }
  }

  async function handleDetailAction(event) {
    const actionNode = event.target.closest('[data-heavy-frontend-action]');
    if (!actionNode) return;
    const item = selectedPackage();
    if (!item) return;
    const action = actionNode.dataset.heavyFrontendAction;
    if (action === 'approve' || action === 'reject') {
      await review(item, action === 'approve' ? 'approved' : 'rejected');
    } else if (action === 'launch') {
      await launch(item);
    } else if (action === 'audits') {
      await loadAudits(item);
    }
  }

  async function review(item, decision) {
    const revision = item.currentRevision;
    if (!revision) return;
    const criticalCount = revision.findings.filter((finding) => finding.severity === 'critical').length;
    if (decision === 'approved') {
      const confirmed = confirmAction(
        `确认已逐项审核当前版本？\n\n内容哈希：${revision.contentHash}\n严重风险项：${criticalCount}\n\n批准后仅能在隔离域名和受控模型网关中运行。`
      );
      if (!confirmed) return;
    }
    const note = promptAction(
      decision === 'approved' ? '记录审核结论（建议说明已核对的脚本和网络能力）' : '记录拒绝原因',
      ''
    );
    if (note === null || note === undefined) return;
    setStatus(decision === 'approved' ? '正在记录批准...' : '正在记录拒绝...');
    try {
      await apiRequest(`/api/heavy-frontends/${encodeURIComponent(item.id)}/review`, {
        method: 'POST',
        body: { decision, contentHash: revision.contentHash, note }
      });
      await loadPackages({ announce: false });
      setStatus(decision === 'approved' ? '审核已绑定到当前内容哈希，可以启动。' : '当前版本已拒绝运行。', 'ok');
    } catch (error) {
      setStatus(`审核记录失败：${humanizeError(error)}`, 'error');
    }
  }

  async function launch(item) {
    if (item.currentRevision?.review?.status === 'rejected') {
      setStatus('当前版本已被明确拒绝，不能启动。', 'error');
      return;
    }
    const providerId = ui.detail.querySelector('#heavy-frontend-provider')?.value || '';
    const maxCalls = Number(ui.detail.querySelector('#heavy-frontend-max-calls')?.value || 40);
    const maxTokens = Number(ui.detail.querySelector('#heavy-frontend-max-tokens')?.value || 16000);
    setStatus('正在创建隔离运行实例...');
    try {
      const result = await apiRequest(`/api/heavy-frontends/${encodeURIComponent(item.id)}/launch`, {
        method: 'POST',
        body: {
          providerId,
          budget: { maxCalls, maxOutputTokensPerCall: maxTokens }
        }
      });
      state.launch = result;
      player.classList.remove('is-hidden');
      player.setAttribute('aria-hidden', 'false');
      documentObject.body.classList.add('heavy-frontend-open');
      if (ui.playerTitle) ui.playerTitle.textContent = item.title;
      if (ui.playerFrame) ui.playerFrame.src = result.launchUrl;
      renderRuntimeStatus(result.instance, '正在等待应用初始化...');
      scheduleRuntimeStatus();
      setStatus('隔离实例已启动；模型密钥保留在服务端。', 'ok');
    } catch (error) {
      setStatus(`启动失败：${humanizeError(error)}`, 'error');
    }
  }

  async function closePlayer() {
    const runtimeSessionId = state.launch?.instance?.runtimeSessionId;
    clearRuntimeTimer();
    if (ui.playerFrame) ui.playerFrame.src = 'about:blank';
    player.classList.add('is-hidden');
    player.setAttribute('aria-hidden', 'true');
    state.snapshotRequests.clear();
    const closingLaunch = state.launch;
    state.launch = null;
    if (root.classList.contains('is-hidden')) documentObject.body.classList.remove('heavy-frontend-open');
    if (runtimeSessionId) {
      try {
        await apiRequest(`/api/heavy-frontends/runtime-sessions/${encodeURIComponent(runtimeSessionId)}/close`, {
          method: 'POST',
          body: {}
        });
      } catch (error) {
        setGlobalStatus(ui.status, `运行实例关闭记录失败：${humanizeError(error)}`, 'error');
      }
    }
    if (closingLaunch) await loadAudits(selectedPackage(), { quiet: true });
  }

  function requestSnapshot() {
    if (!state.launch || !ui.playerFrame?.contentWindow) return;
    const requestId = globalThis.crypto?.randomUUID?.() || `snapshot-${Date.now()}`;
    state.snapshotRequests.set(requestId, Date.now());
    ui.playerFrame.contentWindow.postMessage({
      type: 'lra-heavy:snapshot-request',
      nonce: state.launch.bridgeNonce,
      requestId
    }, state.launch.runtimeOrigin);
    renderRuntimeStatus(state.launch.instance, '正在从应用提取不含向量的托管快照...');
    windowObject.setTimeout(() => {
      if (!state.snapshotRequests.has(requestId)) return;
      state.snapshotRequests.delete(requestId);
      renderRuntimeStatus(state.launch?.instance, '快照超时：该应用可能没有公开兼容存档接口。', 'error');
    }, 12_000);
  }

  async function handleRuntimeMessage(event) {
    const launchState = state.launch;
    if (!launchState || event.source !== ui.playerFrame?.contentWindow) return;
    if (event.origin !== launchState.runtimeOrigin || event.data?.nonce !== launchState.bridgeNonce) return;
    if (event.data?.type === 'lra-heavy:ready') {
      renderRuntimeStatus(launchState.instance, '应用已就绪；所有模型请求由本地网关接管。', 'ok');
      return;
    }
    const requestId = event.data?.requestId;
    if (!requestId || !state.snapshotRequests.has(requestId)) return;
    state.snapshotRequests.delete(requestId);
    if (event.data.type === 'lra-heavy:snapshot-error') {
      renderRuntimeStatus(launchState.instance, `快照失败：${event.data.error || '应用未提供兼容接口'}`, 'error');
      return;
    }
    if (event.data.type !== 'lra-heavy:snapshot') return;
    try {
      const result = await apiRequest(
        `/api/heavy-frontends/runtime-sessions/${encodeURIComponent(launchState.instance.runtimeSessionId)}/snapshot`,
        { method: 'POST', body: { payload: event.data.payload } }
      );
      renderRuntimeStatus(launchState.instance, `托管快照已保存：${formatDate(result.snapshot.savedAt)}`, 'ok');
    } catch (error) {
      renderRuntimeStatus(launchState.instance, `保存快照失败：${humanizeError(error)}`, 'error');
    }
  }

  async function refreshRuntimeStatus() {
    const runtimeSessionId = state.launch?.instance?.runtimeSessionId;
    if (!runtimeSessionId) return;
    try {
      const payload = await apiRequest(`/api/heavy-frontends/runtime-sessions/${encodeURIComponent(runtimeSessionId)}`);
      state.launch.instance = payload.instance;
      renderRuntimeStatus(payload.instance, payload.instance.inFlight ? '模型请求执行中...' : '运行正常', 'ok');
    } catch (error) {
      renderRuntimeStatus(state.launch?.instance, `状态刷新失败：${humanizeError(error)}`, 'error');
    }
  }

  function scheduleRuntimeStatus() {
    clearRuntimeTimer();
    state.statusTimer = windowObject.setInterval(refreshRuntimeStatus, 5000);
  }

  function clearRuntimeTimer() {
    if (state.statusTimer) windowObject.clearInterval(state.statusTimer);
    state.statusTimer = null;
  }

  async function loadAudits(item, { quiet = false } = {}) {
    if (!item) return;
    if (!quiet) setStatus('正在载入审核与调用记录...');
    try {
      const payload = await apiRequest(`/api/heavy-frontends/${encodeURIComponent(item.id)}/audits?limit=100`);
      state.audits.set(item.id, payload.audits || []);
      render();
      if (!quiet) setStatus(`已载入 ${payload.audits?.length || 0} 条审计记录`, 'ok');
    } catch (error) {
      if (!quiet) setStatus(`审计载入失败：${humanizeError(error)}`, 'error');
    }
  }

  function render() {
    renderList();
    renderDetail();
    if (ui.count) ui.count.textContent = String(state.packages.length);
  }

  function renderList() {
    if (!ui.list) return;
    if (!state.packages.length) {
      ui.list.innerHTML = '<div class="heavy-frontend-empty"><strong>尚无重前端包</strong><span>通过“导入目录”载入完整静态网页版。</span></div>';
      return;
    }
    ui.list.innerHTML = state.packages.map((item) => {
      const revision = item.currentRevision || {};
      const review = reviewPresentation(revision.review?.status);
      return `<button type="button" class="heavy-frontend-list-item${item.id === state.selectedId ? ' active' : ''}" data-heavy-frontend-id="${escapeHtml(item.id)}">
        <span class="heavy-frontend-list-title">${escapeHtml(item.title)}</span>
        <span class="heavy-frontend-list-meta">${revision.fileCount || 0} 文件 · ${formatBytes(revision.totalBytes || 0)}</span>
        <span class="heavy-frontend-review-badge ${review.className}">${review.label}</span>
      </button>`;
    }).join('');
  }

  function renderDetail() {
    if (!ui.detail) return;
    const item = selectedPackage();
    if (!item) {
      ui.detail.innerHTML = `<div class="heavy-frontend-welcome">
        <span>HEAVY FRONTEND HOST</span>
        <h3>独立重前端托管区</h3>
        <p>完整网页应用在隔离域名运行。它可以管理自己的玩法与存档，但拿不到模型密钥，也不能直接连接外网。</p>
      </div>`;
      return;
    }
    const revision = item.currentRevision;
    const review = reviewPresentation(revision?.review?.status);
    const findings = revision?.findings || [];
    const severityCounts = countSeverities(findings);
    const providers = getProviders().filter((provider) => provider?.id);
    const audits = state.audits.get(item.id) || [];
    ui.detail.innerHTML = `<article class="heavy-frontend-package-detail">
      <header class="heavy-frontend-detail-header">
        <div>
          <span class="heavy-frontend-kicker">${escapeHtml(item.sourceName)} · ${item.revisions.length} 个版本</span>
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(revision?.entryPath || item.entryPath)} · 更新于 ${formatDate(item.updatedAt)}</p>
        </div>
        <span class="heavy-frontend-review-badge large ${review.className}">${review.label}</span>
      </header>

      <section class="heavy-frontend-boundary-card">
        <div><strong>服务端密钥</strong><span>不进入 iframe 或 localStorage</span></div>
        <div><strong>独立来源</strong><span>*.heavy.localhost</span></div>
        <div><strong>网络策略</strong><span>仅本地模型网关</span></div>
        <div><strong>存档策略</strong><span>浏览器原存档 + 可选托管快照</span></div>
      </section>

      <section class="heavy-frontend-section">
        <div class="heavy-frontend-section-title">
          <div><span>STATIC REVIEW</span><h4>静态风险清单</h4></div>
          <div class="heavy-frontend-severity-summary">
            <b class="critical">${severityCounts.critical} 严重</b><b class="high">${severityCounts.high} 高</b><b>${severityCounts.medium} 中</b>
          </div>
        </div>
        <div class="heavy-frontend-findings">
          ${findings.length ? findings.map(renderFinding).join('') : '<div class="heavy-frontend-empty compact">未命中内置规则；这不等于代码安全，仍需人工审核。</div>'}
        </div>
      </section>

      <section class="heavy-frontend-section heavy-frontend-hash-review">
        <div>
          <span>当前内容哈希</span>
          <code>${escapeHtml(revision?.contentHash || '')}</code>
          <small>${revision?.review?.note ? `审核记录：${escapeHtml(revision.review.note)}` : '更新任何文件都会生成新版本，并重新进入本地观察。'}</small>
        </div>
        <div class="heavy-frontend-review-actions">
          <button type="button" class="ghost-button" data-heavy-frontend-action="reject">拒绝当前版本</button>
          <button type="button" class="primary-button" data-heavy-frontend-action="approve">批准当前哈希</button>
        </div>
      </section>

      <section class="heavy-frontend-section">
        <div class="heavy-frontend-section-title"><div><span>CONTROLLED RUNTIME</span><h4>受控运行参数</h4></div></div>
        <div class="heavy-frontend-launch-form">
          <label><span>服务端 Provider</span><select id="heavy-frontend-provider">${renderProviderOptions(providers)}</select></label>
          <label><span>本次最多调用</span><input id="heavy-frontend-max-calls" type="number" min="1" max="100" value="40"></label>
          <label><span>单次最大输出 Tokens</span><input id="heavy-frontend-max-tokens" type="number" min="256" max="32768" value="16000"></label>
          <button type="button" class="primary-button" data-heavy-frontend-action="launch" ${review.status !== 'rejected' && providers.length ? '' : 'disabled'}>启动隔离实例</button>
        </div>
        ${providers.length ? '' : '<p class="heavy-frontend-inline-warning">尚未配置可用 Provider，请先在工作台设置模型与密钥。</p>'}
      </section>

      <section class="heavy-frontend-section">
        <div class="heavy-frontend-section-title">
          <div><span>AUDIT TRAIL</span><h4>审核与调用记录</h4></div>
          <button type="button" class="ghost-button compact" data-heavy-frontend-action="audits">刷新记录</button>
        </div>
        <div class="heavy-frontend-audits">${audits.length ? audits.map(renderAudit).join('') : '<div class="heavy-frontend-empty compact">点击“刷新记录”查看导入、审核、模型调用和快照事件。审计不保存 Prompt 正文。</div>'}</div>
      </section>
    </article>`;
  }

  function renderRuntimeStatus(instance, message, tone = '') {
    if (ui.playerStatus) {
      ui.playerStatus.textContent = message || '运行中';
      ui.playerStatus.dataset.tone = tone;
    }
    if (!ui.playerUsage || !instance) return;
    const remaining = Math.max(0, Number(instance.budget?.maxCalls || 0) - Number(instance.usage?.calls || 0));
    ui.playerUsage.innerHTML = `<span><b>${remaining}</b> 次剩余调用</span><span><b>${formatNumber(instance.usage?.inputChars || 0)}</b> 输入字符</span><span><b>${formatNumber(instance.usage?.outputChars || 0)}</b> 输出字符</span><span>${escapeHtml(instance.provider?.model || '')}</span>`;
  }

  function selectedPackage() {
    return state.packages.find((item) => item.id === state.selectedId) || null;
  }

  function setStatus(message, tone = '') {
    if (ui.status) {
      ui.status.textContent = message;
      ui.status.dataset.tone = tone;
    }
  }

  return {
    bindEvents,
    close,
    closePlayer,
    loadPackages,
    open,
    requestSnapshot
  };
}

function renderFinding(finding) {
  const examples = (finding.examples || []).slice(0, 3).map((example) => (
    `<li><code>${escapeHtml(example.path)}</code><span>${escapeHtml(example.excerpt)}</span></li>`
  )).join('');
  return `<details class="heavy-frontend-finding severity-${escapeHtml(finding.severity)}" ${finding.severity === 'critical' ? 'open' : ''}>
    <summary><span>${escapeHtml(finding.title)}</span><b>${escapeHtml(finding.severity)} · ${finding.count}</b></summary>
    <p>${escapeHtml(finding.explanation)}</p>
    ${examples ? `<ul>${examples}</ul>` : ''}
  </details>`;
}

function renderAudit(entry) {
  const metricText = entry.metrics
    ? Object.entries(entry.metrics).map(([key, value]) => `${key}: ${value}`).join(' · ')
    : '';
  return `<div class="heavy-frontend-audit-row">
    <time>${formatDate(entry.at)}</time>
    <strong>${escapeHtml(auditLabel(entry.event))}</strong>
    <span>${escapeHtml(entry.status || '')}${metricText ? ` · ${escapeHtml(metricText)}` : ''}</span>
  </div>`;
}

function renderProviderOptions(providers) {
  if (!providers.length) return '<option value="">无可用 Provider</option>';
  return providers.map((provider) => (
    `<option value="${escapeHtml(provider.id)}">${escapeHtml(provider.id)} · ${escapeHtml(provider.model || '未设置模型')}</option>`
  )).join('');
}

function reviewPresentation(status) {
  if (status === 'approved') return { status: 'approved', label: '已批准', className: 'approved' };
  if (status === 'rejected') return { status: 'rejected', label: '已拒绝', className: 'rejected' };
  return { status: 'local-observe', label: '本地观察', className: 'required' };
}

function countSeverities(findings) {
  return findings.reduce((counts, finding) => {
    const key = ['critical', 'high', 'medium'].includes(finding.severity) ? finding.severity : 'medium';
    counts[key] += 1;
    return counts;
  }, { critical: 0, high: 0, medium: 0 });
}

function getSourceDirectoryName(files) {
  const first = String(files[0]?.webkitRelativePath || '').split('/')[0];
  return first || 'local-heavy-frontend';
}

function stripSourceDirectory(value, sourceName) {
  const normalized = String(value || '').replaceAll('\\', '/');
  const prefix = `${sourceName}/`;
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
}

function humanizeSourceName(value) {
  return String(value || '本地重前端').replace(/[-_]+/g, ' ').trim();
}

function arrayBufferToBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const chunks = [];
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + chunkSize)));
  }
  return btoa(chunks.join(''));
}

function inferMimeType(filePath) {
  const extension = String(filePath || '').toLowerCase().split('.').pop();
  return ({
    html: 'text/html', htm: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css',
    json: 'application/json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4',
    webm: 'video/webm', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', wasm: 'application/wasm'
  })[extension] || 'application/octet-stream';
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未知时间';
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('zh-CN');
}

function auditLabel(value) {
  return ({
    'package-import': '导入新版本',
    'observation-ready': '观察运行就绪',
    'package-import-existing-revision': '识别已有版本',
    'package-review': '人工审核',
    'runtime-launch': '启动实例',
    'runtime-close': '关闭实例',
    'provider-call': '模型调用',
    'runtime-snapshot': '托管快照',
    'runtime-integrity-failure': '完整性校验失败'
  })[value] || value || '事件';
}

function humanizeError(error) {
  const code = error?.code || error?.message || 'UNKNOWN_ERROR';
  return ({
    HEAVY_FRONTEND_REVIEW_REQUIRED: '当前内容哈希尚未审核通过',
    HEAVY_FRONTEND_REJECTED: '当前版本已被明确拒绝运行',
    HEAVY_FRONTEND_PROVIDER_NOT_CONFIGURED: '没有配置可用 Provider',
    HEAVY_FRONTEND_PROVIDER_SECRET_MISSING: '所选 Provider 缺少密钥',
    HEAVY_FRONTEND_ENTRY_REQUIRED: '无法唯一识别入口 HTML，请保留 start-screen-noST.html 或 index.html',
    HEAVY_FRONTEND_FILE_TYPE_NOT_ALLOWED: '目录含有不允许的可执行或未知文件类型',
    HEAVY_FRONTEND_BUNDLE_TOO_LARGE: '运行包超过 64 MB',
    HEAVY_FRONTEND_TOO_MANY_FILES: '运行包文件数超过 2000',
    HEAVY_FRONTEND_REVIEW_HASH_CHANGED: '文件版本已变化，请刷新后重新审核',
    HEAVY_FRONTEND_REVIEW_NOTE_REQUIRED: '批准时必须填写至少 8 个字的审核结论'
  })[code] || String(code);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function createNoopController() {
  return {
    bindEvents: () => false,
    close: () => {},
    closePlayer: async () => {},
    loadPackages: async () => {},
    open: async () => {},
    requestSnapshot: () => {}
  };
}
