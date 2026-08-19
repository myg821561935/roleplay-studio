export function getSessionDisplayTitle(sessionId, summaries = []) {
  const summary = (Array.isArray(summaries) ? summaries : [])
    .find((item) => item?.id === sessionId);
  const title = String(summary?.title || '').trim();
  return title || (sessionId === 'main' ? '默认会话' : sessionId);
}

export function formatSessionOptionLabel(sessionId, summaries = []) {
  const summary = (Array.isArray(summaries) ? summaries : [])
    .find((item) => item?.id === sessionId);
  const label = getSessionDisplayTitle(sessionId, summaries);
  const messageCount = Number(summary?.messageCount);
  return summary && Number.isFinite(messageCount)
    ? `${label} · ${messageCount} 条消息`
    : label;
}

export function createSessionController({
  els,
  apiRequest,
  storage = null,
  getCurrentSessionId,
  setCurrentSessionId,
  loadState,
  setStatus,
  humanizeApiError
}) {
  let sessionSearchQuery = '';
  let lastSessionIds = [];
  let lastSummaries = [];
  let searchInputBound = false;

  function ensureSessionSearchInput(sessionIds) {
    if (!els.sessionSelect || !els.sessionSelect.parentElement) return;
    const showSearch = sessionIds.length > 8;
    const existing = els.sessionSelect.parentElement.querySelector('.session-search-input');
    if (!showSearch) {
      if (existing) existing.remove();
      return;
    }
    if (existing) return;
    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'session-search-input form-input compact';
    input.placeholder = '搜索会话…';
    input.setAttribute('aria-label', '搜索会话');
    input.value = sessionSearchQuery;
    if (!searchInputBound) {
      searchInputBound = true;
      input.addEventListener('input', (event) => {
        sessionSearchQuery = String(event.target.value || '').trim().toLowerCase();
        renderSessionSelect(lastSessionIds, lastSummaries);
        const node = els.sessionSelect.parentElement.querySelector('.session-search-input');
        if (node) {
          node.focus();
          const len = node.value.length;
          try { node.setSelectionRange(len, len); } catch { /* ignore */ }
        }
      });
    }
    els.sessionSelect.parentElement.insertBefore(input, els.sessionSelect);
  }

  function renderSessionSelect(sessions, summaries = []) {
    if (!els.sessionSelect) return;
    const currentSessionId = getCurrentSessionId();
    const sessionIds = Array.from(new Set(['main', currentSessionId, ...(Array.isArray(sessions) ? sessions : [])]))
      .filter(Boolean);
    lastSessionIds = sessionIds;
    lastSummaries = summaries;
    ensureSessionSearchInput(sessionIds);

    els.sessionSelect.innerHTML = '';
    const query = sessionSearchQuery;
    const filteredIds = sessionIds.filter((sessionId) => {
      if (!query) return true;
      const label = formatSessionOptionLabel(sessionId, summaries).toLowerCase();
      return label.includes(query) || String(sessionId).toLowerCase().includes(query);
    });
    if (!filteredIds.length && query) {
      const option = document.createElement('option');
      option.disabled = true;
      option.textContent = '无匹配会话';
      els.sessionSelect.appendChild(option);
      return;
    }
    for (const sessionId of filteredIds) {
      const option = document.createElement('option');
      option.value = sessionId;
      option.textContent = formatSessionOptionLabel(sessionId, summaries);
      if (sessionId === currentSessionId) option.selected = true;
      els.sessionSelect.appendChild(option);
    }
  }

  function openNewSessionDialog() {
    const assets = window.__assets || { characters: [], worldBooks: [], promptModules: [] };

    if (els.newSessionCharacter) {
      els.newSessionCharacter.innerHTML = '<option value="">（无）</option>';
      for (const character of assets.characters) {
        const option = document.createElement('option');
        option.value = character.id;
        option.textContent = character.name || character.id;
        els.newSessionCharacter.appendChild(option);
      }
    }

    if (els.newSessionWorldbook) {
      els.newSessionWorldbook.innerHTML = '';
      for (const worldBook of assets.worldBooks) {
        const option = document.createElement('option');
        option.value = worldBook.id;
        option.textContent = worldBook.title || worldBook.id;
        els.newSessionWorldbook.appendChild(option);
      }
    }

    const titleInput = els.newSessionForm?.querySelector('#new-session-title');
    if (titleInput) titleInput.value = '';
    els.newSessionDialog.showModal();
  }

  async function handleNewSessionSubmit(event) {
    event.preventDefault();
    const title = els.newSessionForm.querySelector('#new-session-title').value;
    const packId = els.newSessionPack.value;
    const characterCardId = els.newSessionCharacter.value;
    const worldBookIds = Array.from(els.newSessionWorldbook.selectedOptions).map((option) => option.value);
    const newId = `session-${Date.now()}`;
    const submitButton = els.newSessionForm.querySelector('button[type="submit"]');
    if (submitButton) submitButton.disabled = true;

    try {
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: newId,
          title,
          packId,
          characterCardId,
          worldBookIds
        })
      });
      if (!response.ok) throw new Error('Failed to create session');

      setCurrentSessionId(newId);
      els.newSessionDialog.close();
      await loadState();
    } catch (error) {
      setStatus(els.appStatus, `新建会话失败：${error.message}`, 'error');
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  }

  function exportCurrentSession() {
    const currentSessionId = getCurrentSessionId();
    const url = `/api/sessions/${encodeURIComponent(currentSessionId)}/export?format=json`;
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${currentSessionId}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setStatus(els.appStatus, '已导出会话存档', 'ok');
  }

  async function handleImportSessionFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';

    try {
      const text = await file.text();
      const sessionData = JSON.parse(text);
      const payload = await apiRequest('/api/sessions/import', {
        method: 'POST',
        body: { session: sessionData }
      });
      setCurrentSessionId(payload.session.id);
      await loadState();
      setStatus(els.appStatus, '会话存档已导入', 'ok');
    } catch (error) {
      setStatus(els.appStatus, `导入失败：${humanizeApiError(error)}`, 'error');
    }
  }

  async function deleteCurrentSession() {
    const currentSessionId = getCurrentSessionId();
    if (!currentSessionId || currentSessionId === 'main') {
      setStatus(els.appStatus, '默认会话不可删除', 'error');
      return;
    }
    const label = formatSessionOptionLabel(currentSessionId, []);
    if (!window.confirm(`确认删除会话「${label}」？\n此操作不可撤销，建议先导出备份。`)) return;

    try {
      await apiRequest(`/api/sessions/${encodeURIComponent(currentSessionId)}`, { method: 'DELETE' });
      setCurrentSessionId('main');
      storage?.removeItem?.('localRoleplaySessionId');
      await loadState();
      setStatus(els.appStatus, '会话已删除', 'ok');
    } catch (error) {
      setStatus(els.appStatus, `删除失败：${humanizeApiError(error)}`, 'error');
    }
  }

  return {
    deleteCurrentSession,
    exportCurrentSession,
    handleImportSessionFile,
    handleNewSessionSubmit,
    openNewSessionDialog,
    renderSessionSelect
  };
}
