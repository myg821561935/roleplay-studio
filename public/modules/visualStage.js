export const BACKGROUND_PRESETS = [
  { label: '神荒·落雁北关', url: '/assets/xuanhuan-luoyan-stage.png' },
  { label: '灵异·永安筒子楼', url: '/assets/lingyi-yongan-stage.png' },
  { label: '明末·京师城门', url: '/assets/mingmo-chongzhen-stage.png' },
  { label: '武侠卷轴', url: '/assets/wuxia-stage.png' },
  { label: '仙侠云海', url: '/assets/xianxia-stage.png' },
  { label: '英雄志·群像江湖', url: '/assets/wuxia-stage.png' },
  { label: '竹林夜', prompt: 'dense bamboo forest at night, moonlight filtering through leaves, misty atmosphere, dark green tones, cinematic' },
  { label: '雪山黎明', prompt: 'snow mountain peaks at dawn, golden sunrise, clear sky, vast landscape, cinematic wide shot' },
  { label: '古镇雨巷', prompt: 'ancient Chinese town alley in rain, wet stone pavement, paper lanterns, misty atmosphere, cinematic' },
  { label: '荒漠落日', prompt: 'vast desert at sunset, golden dunes, dramatic sky, lone figure silhouette, cinematic' },
  { label: '深山古寺', prompt: 'ancient Buddhist temple deep in misty mountains, stone steps, pine trees, fog, cinematic' },
  { label: '星河夜空', prompt: 'milky way galaxy over mountain lake, starry night sky, reflection in water, cinematic' }
];

export const DEFAULT_READING_MODE = 'eye-care';

export const AVAILABLE_THEMES = ['eye-care', 'dark', 'bright', 'soft', 'modern', 'cyber'];

export const LEGACY_THEME_ALIASES = Object.freeze({
  'default-dark': 'dark',
  'wuxia-scroll': 'eye-care',
  'xianxia-scroll': 'soft'
});

export const CONTENT_PACK_VISUAL_PRESETS = {
  neutral: {
    label: '无舞台背景',
    backgroundImage: ''
  },
  xuanhuan: {
    label: '神荒玄幻',
    backgroundImage: '/assets/xuanhuan-luoyan-stage.png'
  },
  lingyi: {
    label: '民俗灵异',
    backgroundImage: '/assets/lingyi-yongan-stage.png'
  },
  mingmo: {
    label: '明末风云',
    backgroundImage: '/assets/mingmo-chongzhen-stage.png'
  },
  xianxia: {
    label: '太虚仙侠',
    backgroundImage: '/assets/xianxia-stage.png'
  },
  yingxiongzhi: {
    label: '英雄志群像',
    backgroundImage: '/assets/wuxia-stage.png'
  }
};

export const STORY_PACK_PRESENTATION = {
  neutral: { badge: '自定义故事', accent: '#6b8afd' },
  xuanhuan: { badge: '武道玄幻', accent: '#76c1b6' },
  lingyi: { badge: '民俗悬疑', accent: '#c78f7a' },
  mingmo: { badge: '历史生存', accent: '#d4aa59' },
  xianxia: { badge: '仙侠修真', accent: '#83b7d4' },
  yingxiongzhi: { badge: '群像武侠', accent: '#b18bd0' }
};

export function normalizeThemePreference(theme) {
  const value = String(theme || '').trim();
  if (AVAILABLE_THEMES.includes(value)) return value;
  return LEGACY_THEME_ALIASES[value] || DEFAULT_READING_MODE;
}

export function loadThemePreference(storage = globalThis.localStorage) {
  try {
    return normalizeThemePreference(storage?.getItem('local-roleplay-agent-theme'));
  } catch {
    return DEFAULT_READING_MODE;
  }
}

export function createVisualStageController({
  state,
  els,
  getCharacterPortraitUrl,
  saveSettingsPatch,
  setStatus,
  humanizeApiError
}) {
  function getActiveCharacterBackgroundPreset() {
    const card = state.session?.config?.characterCard || state.config?.characterCard || {};
    const url = getCharacterPortraitUrl(card);
    if (!url) return null;
    return {
      label: `角色立绘 · ${card.name || '当前主角'}`,
      url,
      fit: 'portrait',
      source: 'character-portrait'
    };
  }

  function normalizeBackgroundUrlForMatch(url) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw, window.location.origin);
      return parsed.origin === window.location.origin ? parsed.pathname : parsed.href;
    } catch {
      return raw;
    }
  }

  function backgroundUrlsMatch(left, right) {
    return normalizeBackgroundUrlForMatch(left) === normalizeBackgroundUrlForMatch(right);
  }

  function getBackgroundLabelForUrl(url) {
    const bg = String(url || '').trim();
    if (!bg) return '';
    const characterPreset = getActiveCharacterBackgroundPreset();
    if (characterPreset && backgroundUrlsMatch(characterPreset.url, bg)) return characterPreset.label;
    const linkedPreset = Object.values(CONTENT_PACK_VISUAL_PRESETS)
      .find((preset) => backgroundUrlsMatch(preset.backgroundImage, bg));
    if (linkedPreset) return linkedPreset.label;
    return BACKGROUND_PRESETS.find((preset) => backgroundUrlsMatch(preset.url, bg))?.label || '';
  }

  function updateBackgroundModeUi(
    backgroundImage = state.session?.settings?.backgroundImage || '',
    fit = state.session?.settings?.backgroundFit || 'cover'
  ) {
    const bg = String(backgroundImage || '').trim();
    const isCustom = Boolean(bg);
    const label = getBackgroundLabelForUrl(bg);
    els.toggleBackground?.classList.toggle('active', isCustom);
    if (els.toggleBackground) {
      els.toggleBackground.title = isCustom ? `正在使用${label || '自定义'}舞台背景` : '当前未设置舞台背景';
    }
    if (els.backgroundMode) {
      els.backgroundMode.textContent = isCustom ? `舞台背景：${label || '自定义'}` : '舞台背景：未设置';
      els.backgroundMode.classList.toggle('is-custom', isCustom);
    }
    if (els.backgroundStatus) {
      els.backgroundStatus.textContent = isCustom
        ? `当前：${label || '自定义舞台背景'}${fit === 'portrait' ? '，使用人物聚焦构图' : ''}。阅读模式独立于剧本，剧本只提供舞台背景。`
        : '当前：未设置舞台背景。阅读模式独立于剧本，剧本只提供舞台背景。';
    }
  }

  function applyBackgroundImage(url, fit = state.session?.settings?.backgroundFit || 'cover') {
    const chatPanel = document.querySelector('.chat-panel');
    const workspace = document.querySelector('.workspace');
    const bg = String(url || '').trim();
    const isPortrait = Boolean(bg) && fit === 'portrait';
    if (chatPanel) {
      if (bg) {
        chatPanel.style.setProperty('--chat-bg-image', `url("${bg}")`);
      } else {
        chatPanel.style.removeProperty('--chat-bg-image');
      }
      chatPanel.classList.toggle('has-stage-background', Boolean(bg));
      chatPanel.classList.toggle('background-fit-portrait', isPortrait);
    }
    if (workspace) {
      if (bg) {
        workspace.style.setProperty('--stage-bg-image', `url("${bg}")`);
      } else {
        workspace.style.removeProperty('--stage-bg-image');
      }
      workspace.classList.toggle('has-stage-background', Boolean(bg));
      workspace.classList.toggle('background-fit-portrait', isPortrait);
    }
    updateBackgroundModeUi(bg, fit);
  }

  function renderBackgroundPresets() {
    if (!els.backgroundPresets) return;
    els.backgroundPresets.innerHTML = '';
    const characterPreset = getActiveCharacterBackgroundPreset();
    const presets = characterPreset ? [characterPreset, ...BACKGROUND_PRESETS] : BACKGROUND_PRESETS;
    for (const preset of presets) {
      const img = document.createElement('img');
      img.className = 'background-preset-thumb';
      img.loading = 'lazy';
      img.alt = preset.label;
      img.src = preset.url || `https://console.enterprise.trae.cn/api/ide/v1/text_to_image?prompt=${encodeURIComponent(preset.prompt)}&image_size=landscape_4_3`;

      const item = document.createElement('div');
      item.className = 'background-preset-item';
      item.dataset.bgPreset = img.src;
      item.dataset.bgFit = preset.fit || 'cover';
      item.dataset.bgSource = preset.source || 'preset';
      item.classList.toggle('is-character-portrait', preset.source === 'character-portrait');
      item.title = preset.label;

      const label = document.createElement('span');
      label.textContent = preset.label;
      item.append(img, label);
      els.backgroundPresets.append(item);
    }
  }

  function toggleBackgroundPanel() {
    if (!els.backgroundPanel) return;
    const collapsed = els.backgroundPanel.classList.toggle('collapsed');
    if (!collapsed) renderBackgroundPresets();
  }

  async function setBackgroundImage(url, { fit = 'cover', source = 'manual' } = {}) {
    const bgUrl = String(url || '').trim();
    const safeFit = fit === 'portrait' ? 'portrait' : 'cover';
    try {
      const settingsPatch = {
        backgroundImage: bgUrl,
        backgroundFit: bgUrl ? safeFit : 'cover',
        backgroundSource: bgUrl ? String(source || 'manual') : ''
      };
      const savedSession = await saveSettingsPatch(settingsPatch);
      if (savedSession?.id === state.session?.id) {
        applyBackgroundImage(bgUrl, settingsPatch.backgroundFit);
      }
      setStatus(els.appStatus, safeFit === 'portrait' ? '已使用角色立绘作为舞台背景' : '背景已更新', 'ok');
      return savedSession;
    } catch (error) {
      setStatus(els.appStatus, `背景保存失败：${humanizeApiError(error)}`, 'error');
      return null;
    }
  }

  async function applyBackgroundUrl() {
    const url = String(els.backgroundUrlInput?.value || '').trim();
    if (!url) return;
    await setBackgroundImage(url);
    els.backgroundUrlInput.value = '';
  }

  async function clearBackgroundImage() {
    await setBackgroundImage('', { fit: 'cover', source: '' });
  }

  function normalizeTheme(theme) {
    return normalizeThemePreference(theme);
  }

  function applyTheme(theme) {
    const value = normalizeTheme(theme);
    document.documentElement.dataset.theme = value;
    try {
      localStorage.setItem('local-roleplay-agent-theme', value);
    } catch {
      // Theme still applies for the current page even if storage is unavailable.
    }
    if (els.themeSelect) els.themeSelect.value = value;
    updateBackgroundModeUi();
    return value;
  }

  function saveReadingMode(theme) {
    const value = applyTheme(theme);
    setStatus(els.appStatus, '阅读模式已保存到本机，切换剧本时保持不变', 'ok');
    return value;
  }

  return {
    applyBackgroundImage,
    applyBackgroundUrl,
    applyTheme,
    backgroundUrlsMatch,
    clearBackgroundImage,
    getBackgroundLabelForUrl,
    normalizeTheme,
    renderBackgroundPresets,
    saveReadingMode,
    setBackgroundImage,
    toggleBackgroundPanel,
    updateBackgroundModeUi
  };
}
