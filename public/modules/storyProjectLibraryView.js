export function createStoryProjectLibraryViewController({
  els = {},
  renderStoryProjects = () => {},
  setTimeoutImpl = globalThis.setTimeout
} = {}) {
  let active = false;

  function setActive(nextActive) {
    active = Boolean(nextActive);
    els.storyLauncher?.classList.toggle('is-project-library-view', active);
    if (els.viewAllStoriesBtn) {
      els.viewAllStoriesBtn.classList.toggle('active', active);
      els.viewAllStoriesBtn.setAttribute('aria-pressed', String(active));
      els.viewAllStoriesBtn.title = active ? '返回剧本目录' : '查看全部故事';
    }
    if (els.viewAllStoriesLabel) {
      els.viewAllStoriesLabel.textContent = active ? '返回剧本目录' : '查看全部故事';
    }
    if (active) {
      renderStoryProjects();
      setTimeoutImpl?.(() => els.storyProjectList?.children?.[0]?.focus?.(), 0);
    }
    return active;
  }

  function bindEvents() {
    els.viewAllStoriesBtn?.addEventListener('click', () => setActive(!active));
  }

  return { bindEvents, isActive: () => active, setActive };
}
