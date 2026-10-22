export function createAssetLibraryController({
  state,
  els,
  apiRequest,
  getAssetCenterController,
  closeStoryLauncher,
  openStoryLauncher,
  renderStoryPackGrid,
  getCharacterPortraitUrl,
  getCompanionWorldBooks,
  invalidateCustomStoryInspection,
  persistCustomStoryDraft,
  openCustomStoryDialog,
  activateWorkMode,
  activateTab,
  activateResourceView,
  renderResourcePackBuilder,
  downloadJsonFile,
  quickLaunchCharacterStory
}) {
  async function quickLaunchFromCenter(item) {
    if (!item) return;
    try {
      getAssetCenterController()?.close();
      if (typeof quickLaunchCharacterStory === 'function') {
        return await quickLaunchCharacterStory(item.id);
      }
    } catch (error) {
      console.error('Quick launch failed:', error);
      alert(`快捷启航失败：${error.message || error}`);
    }
  }

  function openAssetCenter() {
    closeStoryLauncher();
    getAssetCenterController()?.open();
  }

  function openAssetImportPicker(kind = '') {
    if (!els.characterCardImport) return;
    const acceptedTypes = {
      character: '.png,.json,image/png,application/json',
      worldbook: '.json,.yaml,.yml,.txt,application/json,text/yaml,text/plain',
      prompt: '.json,.yaml,.yml,.txt,application/json,text/yaml,text/plain'
    };
    els.characterCardImport.dataset.assetImportKind = kind;
    els.characterCardImport.accept = acceptedTypes[kind]
      || '.json,.png,.yaml,.yml,.txt,application/json,image/png,text/yaml,text/plain';
    els.characterCardImport.click();
  }

  function useAssetFromCenter(item) {
    if (!item) return;
    if (item.kind === 'pack') {
      openStoryLauncher({ focusSearch: false });
      if (els.storyPackSearch) els.storyPackSearch.value = item.title || '';
      renderStoryPackGrid();
      return;
    }
    if (item.kind === 'prompt') {
      openAssetComposer(item);
      return;
    }

    if (item.kind === 'character') {
      state.customStoryDraft.characterResourceId = item.id;
      state.customStoryDraft.useCharacterPortraitAsBackground = Boolean(getCharacterPortraitUrl(item.payload));
      if (!state.customStoryDraft.titleCustomized) {
        state.customStoryDraft.title = `${item.title || '新角色'} · 新卷`;
      }
      const companions = getCompanionWorldBooks(item.raw, state.resourceLibrary)
        .map((resource) => resource.id);
      state.customStoryDraft.worldBookResourceIds = Array.from(new Set([
        ...state.customStoryDraft.worldBookResourceIds,
        ...companions
      ]));
    } else if (item.kind === 'worldbook') {
      state.customStoryDraft.worldBookResourceIds = Array.from(new Set([
        ...state.customStoryDraft.worldBookResourceIds,
        item.id
      ]));
      if (!state.customStoryDraft.titleCustomized) {
        state.customStoryDraft.title = `${item.title || '新世界'} · 新卷`;
      }
    }
    invalidateCustomStoryInspection();
    persistCustomStoryDraft();
    openCustomStoryDialog();
  }

  function openAssetComposer(item = null) {
    activateWorkMode('settings');
    activateTab('sources');
    activateResourceView('composer');
    renderResourcePackBuilder();
    if (!item) return;
    if (item.kind === 'character' && els.resourcePackCharacter) {
      els.resourcePackCharacter.value = item.id;
    }
    const picker = item.kind === 'worldbook'
      ? els.resourcePackWorldbooks
      : item.kind === 'prompt'
        ? els.resourcePackPrompts
        : null;
    for (const resourceId of getAssetResourceIds(item)) {
      const checkbox = picker?.querySelector(`input[value="${CSS.escape(resourceId)}"]`);
      if (checkbox) checkbox.checked = true;
    }
  }

  async function saveAssetMetadata(item, updates) {
    if (!item?.id || item.kind === 'pack') return;
    const resourceIds = getAssetResourceIds(item);
    if (resourceIds.length > 1) {
      await apiRequest('/api/resource-library/resources', {
        method: 'PATCH',
        body: {
          resourceIds,
          tags: updates.tags,
          collections: updates.collections,
          favorite: updates.favorite
        }
      });
      return;
    }
    await apiRequest(`/api/resource-library/resources/${encodeURIComponent(item.id)}`, {
      method: 'PATCH',
      body: updates
    });
  }

  async function saveAssetContent(item, updates) {
    if (!item?.id || !['worldbook', 'prompt'].includes(item.raw?.kind || item.kind)) return;
    await apiRequest(`/api/resource-library/resources/${encodeURIComponent(item.id)}/content`, {
      method: 'PATCH',
      body: updates
    });
  }

  async function reevaluateAssetFromCenter(item) {
    if (!item?.id || item.kind === 'pack') return;
    await Promise.all(getAssetResourceIds(item).map((resourceId) => (
      apiRequest(`/api/resource-library/resources/${encodeURIComponent(resourceId)}/reevaluate`, {
        method: 'POST',
        body: {}
      })
    )));
  }

  async function loadAssetRevisions(item) {
    if (!item?.id || item.kind === 'pack') return { revisions: [] };
    return apiRequest(`/api/resource-library/resources/${encodeURIComponent(item.id)}/revisions`);
  }

  async function rollbackAssetRevision(item, revisionId) {
    if (!item?.id || item.kind === 'pack' || !revisionId) return null;
    return apiRequest(
      `/api/resource-library/resources/${encodeURIComponent(item.id)}/revisions/${encodeURIComponent(revisionId)}/rollback`,
      { method: 'POST', body: {} }
    );
  }

  async function deleteAssetFromCenter(item) {
    if (!item?.id) return;
    const resourceIds = getAssetResourceIds(item);
    if (item.kind !== 'pack' && resourceIds.length > 1) {
      await apiRequest('/api/resource-library/resources', {
        method: 'DELETE',
        body: { resourceIds }
      });
      return;
    }
    const path = item.kind === 'pack'
      ? `/api/resource-library/packs/${encodeURIComponent(item.id)}`
      : `/api/resource-library/resources/${encodeURIComponent(item.id)}`;
    await apiRequest(path, { method: 'DELETE', body: {} });
  }

  async function saveAssetBatchMetadata(items, updates) {
    const resourceIds = collectAssetResourceIds(items);
    if (!resourceIds.length) return;
    await apiRequest('/api/resource-library/resources', {
      method: 'PATCH',
      body: { resourceIds, ...updates }
    });
  }

  async function exportAssetsFromCenter(items) {
    const resourceIds = collectAssetResourceIds(items);
    if (!resourceIds.length) return;
    const { bundle } = await apiRequest('/api/resource-library/resources/export', {
      method: 'POST',
      body: { resourceIds }
    });
    downloadJsonFile(bundle, `roleplay-assets-${new Date().toISOString().slice(0, 10)}.json`);
  }

  async function deleteAssetsFromCenter(items) {
    const resourceIds = collectAssetResourceIds(items);
    const packs = (Array.isArray(items) ? items : []).filter((item) => item?.kind === 'pack' && item.raw?.custom !== false);

    if (resourceIds.length) {
      await apiRequest('/api/resource-library/resources', {
        method: 'DELETE',
        body: { resourceIds }
      });
    }

    for (const pack of packs) {
      if (pack.id) {
        await apiRequest(`/api/resource-library/packs/${encodeURIComponent(pack.id)}`, {
          method: 'DELETE',
          body: { confirmDetach: true }
        });
      }
    }
  }

  return {
    deleteAssetFromCenter,
    deleteAssetsFromCenter,
    exportAssetsFromCenter,
    loadAssetRevisions,
    openAssetCenter,
    openAssetComposer,
    openAssetImportPicker,
    reevaluateAssetFromCenter,
    rollbackAssetRevision,
    saveAssetBatchMetadata,
    saveAssetContent,
    saveAssetMetadata,
    useAssetFromCenter,
    quickLaunchFromCenter
  };
}

function getAssetResourceIds(item) {
  const ids = Array.isArray(item?.resourceIds) ? item.resourceIds : [item?.id];
  return [...new Set(ids.map((id) => String(id || '')).filter(Boolean))];
}

function collectAssetResourceIds(items = []) {
  return [...new Set(items
    .filter((item) => item?.kind !== 'pack')
    .flatMap(getAssetResourceIds))];
}
