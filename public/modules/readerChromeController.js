export function createReaderChromeController({
  state,
  els,
  getCurrentSessionId,
  getSessionDisplayTitle,
  getAppliedContentPackId,
  getContentPackTitle,
  activateWorkMode,
  openImmersiveSidebarTab = () => {},
  setWorkspacePanelExpanded,
  activateTab,
  scrollInspectorIntoViewOnNarrowScreens,
  documentObject = globalThis.document
}) {
  let activeReaderTab = null;

  function syncReaderChrome() {
    const nameEl = documentObject.getElementById('reader-card-name');
    const chapterEl = documentObject.getElementById('reader-card-chapter');
    const tagsEl = documentObject.getElementById('reader-card-tags');
    const dividerEl = documentObject.querySelector('.reader-card-divider');
    const currentSessionId = getCurrentSessionId();
    if (nameEl) {
      const sessionTitle = getSessionDisplayTitle(currentSessionId, state.sessionSummaries);
      nameEl.textContent = sessionTitle || '叙界';
    }
    const arc = String(state.session?.memory?.narrativeState?.activeArc || '').trim();
    if (chapterEl) {
      chapterEl.textContent = arc;
      chapterEl.style.display = arc ? '' : 'none';
    }
    if (dividerEl) dividerEl.style.display = arc ? '' : 'none';
    if (tagsEl) {
      const packId = getAppliedContentPackId();
      const packTitle = packId ? getContentPackTitle(packId, '') : '';
      tagsEl.textContent = packTitle;
      tagsEl.style.display = packTitle ? '' : 'none';
    }
  }

  function syncActiveRailBtn(tabId) {
    activeReaderTab = tabId;
    const buttons = documentObject.querySelectorAll('.reader-rail-btn');
    buttons.forEach((btn) => {
      const buttonKey = btn.dataset.readerTab || (btn.dataset.readerInteraction
        ? `interaction-${btn.dataset.readerInteraction}`
        : '');
      const isMatch = buttonKey === tabId;
      btn.classList.toggle('active', isMatch);
      btn.setAttribute('aria-current', isMatch ? 'page' : 'false');
    });
  }

  function openReaderTab(tab) {
    const mode = ['memory', 'health', 'status', 'facts', 'usage'].includes(tab) ? 'debug' : 'settings';
    activateWorkMode(mode, { activateDefaultTab: false });
    setWorkspacePanelExpanded('inspector', true, { syncActiveView: true });
    activateTab(tab);
    scrollInspectorIntoViewOnNarrowScreens();
    syncActiveRailBtn(tab);
  }

  function openReaderInteraction(interaction) {
    const labels = {
      characters: '角色档案',
      relationships: '人物网络',
      clues: '决策线索',
      state: '当前态势',
      protagonist: '成长轨迹',
      'world-rules': '世界规则',
      memory: '叙事记忆',
      progress: '成长轨迹'
    };
    const label = labels[interaction];
    if (!label) return;

    const isOpen = openImmersiveSidebarTab(label);
    syncActiveRailBtn(isOpen === false ? '' : `interaction-${interaction}`);
  }

  function bindReaderRail() {
    const rail = documentObject.querySelector('.reader-rail');
    if (rail && rail.dataset.bound !== 'true') {
      rail.dataset.bound = 'true';
      rail.addEventListener('click', (event) => {
        const button = event.target.closest('.reader-rail-btn');
        if (!button) return;
        const tab = button.dataset.readerTab;
        const action = button.dataset.readerAction;
        const interaction = button.dataset.readerInteraction;
        if (tab) {
          openReaderTab(tab);
          return;
        }
        if (interaction) {
          openReaderInteraction(interaction);
          return;
        }
        if (action === 'open-story') {
          els.openStoryLauncher?.click();
        } else if (action === 'background') {
          els.toggleBackground?.click();
        }
      });
    }

    const toggleBtn = documentObject.getElementById('toggle-session-settings');
    const wrapper = documentObject.querySelector('.chat-header-controls-wrapper');
    if (toggleBtn && wrapper && toggleBtn.dataset.bound !== 'true') {
      toggleBtn.dataset.bound = 'true';
      toggleBtn.addEventListener('click', () => {
        const collapsed = wrapper.classList.toggle('collapsed');
        toggleBtn.classList.toggle('active', !collapsed);
        toggleBtn.setAttribute('aria-expanded', String(!collapsed));
      });
    }
  }

  return {
    syncReaderChrome,
    bindReaderRail,
    syncActiveRailBtn
  };
}
