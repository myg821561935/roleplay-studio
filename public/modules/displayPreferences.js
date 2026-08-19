/**
 * 显示偏好控制器
 * 管理用户级 CSS 注入、聊天宽度、字体缩放、模糊开关等显示偏好。
 * 偏好通过 localStorage 持久化（与主题偏好一致），不走会话设定 API。
 */

const STORAGE_KEY = 'local-roleplay-agent-display-preferences';

const DEFAULT_PREFERENCES = Object.freeze({
  customCss: '',
  chatWidthScale: 1,
  fontScale: 1,
  blurDisabled: false,
  textShadowDisabled: false,
  messageTimestampsHidden: false,
  messageTokenCountHidden: false,
  chatStyle: 'reader'
});

export const CHAT_STYLES = Object.freeze(['reader', 'bubbles']);

const VALID_RANGES = Object.freeze({
  chatWidthScale: { min: 0.6, max: 1.4, step: 0.05 },
  fontScale: { min: 0.7, max: 1.6, step: 0.05 }
});

const CUSTOM_STYLE_ID = 'user-custom-css';
const DISPLAY_VARS_ID = 'display-preference-vars';

export function loadDisplayPreferences(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFERENCES };
    const parsed = JSON.parse(raw);
    return {
      customCss: typeof parsed.customCss === 'string' ? parsed.customCss : '',
      chatWidthScale: clampNumber(parsed.chatWidthScale, VALID_RANGES.chatWidthScale, 1),
      fontScale: clampNumber(parsed.fontScale, VALID_RANGES.fontScale, 1),
      blurDisabled: Boolean(parsed.blurDisabled),
      textShadowDisabled: Boolean(parsed.textShadowDisabled),
      messageTimestampsHidden: Boolean(parsed.messageTimestampsHidden),
      messageTokenCountHidden: Boolean(parsed.messageTokenCountHidden),
      chatStyle: CHAT_STYLES.includes(parsed.chatStyle) ? parsed.chatStyle : 'reader'
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function saveDisplayPreferences(preferences, storage = globalThis.localStorage) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // 存储不可用时静默降级
  }
}

function clampNumber(value, range, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(range.max, Math.max(range.min, Math.round(num / range.step) * range.step));
}

function ensureStyleElement(documentObject, id) {
  let el = documentObject.getElementById(id);
  if (!el) {
    el = documentObject.createElement('style');
    el.id = id;
    documentObject.head.appendChild(el);
  }
  return el;
}

export function applyDisplayPreferences(preferences, documentObject = globalThis.document) {
  if (!documentObject?.documentElement) return;

  const root = documentObject.documentElement;

  // 自定义 CSS
  const customStyleEl = ensureStyleElement(documentObject, CUSTOM_STYLE_ID);
  customStyleEl.textContent = preferences.customCss || '';

  // CSS 变量覆盖（聊天宽度 + 字体缩放）
  const varsEl = ensureStyleElement(documentObject, DISPLAY_VARS_ID);
  const overrides = [];

  if (preferences.chatWidthScale !== 1) {
    const width = Math.round(860 * preferences.chatWidthScale);
    overrides.push(`--paper-max-width: ${width}px`);
    overrides.push(`--reader-column-width: ${Math.round(780 * preferences.chatWidthScale)}px`);
  }

  if (preferences.fontScale !== 1) {
    overrides.push(`font-size: calc(15px * ${preferences.fontScale})`);
  }

  varsEl.textContent = overrides.length ? `:root { ${overrides.join('; ')}; }` : '';

  // 模糊 / 文字阴影 / 消息元数据显示开关
  root.classList.toggle('pref-no-blur', Boolean(preferences.blurDisabled));
  root.classList.toggle('pref-no-text-shadow', Boolean(preferences.textShadowDisabled));
  root.classList.toggle('pref-hide-timestamps', Boolean(preferences.messageTimestampsHidden));
  root.classList.toggle('pref-hide-token-count', Boolean(preferences.messageTokenCountHidden));

  // 聊天样式切换
  root.classList.toggle('chat-style-bubbles', preferences.chatStyle === 'bubbles');
}

export function createDisplayPreferencesController({
  els = {},
  documentObject = globalThis.document,
  storage = globalThis.localStorage
} = {}) {
  let preferences = loadDisplayPreferences(storage);
  let eventsBound = false;

  function persist() {
    saveDisplayPreferences(preferences, storage);
    applyDisplayPreferences(preferences, documentObject);
  }

  function renderDisplayPreferences() {
    if (els.customCssInput) els.customCssInput.value = preferences.customCss;
    if (els.chatWidthScale) els.chatWidthScale.value = preferences.chatWidthScale;
    if (els.chatWidthValue) {
      els.chatWidthValue.textContent = `${Math.round(preferences.chatWidthScale * 100)}%`;
    }
    if (els.fontScale) els.fontScale.value = preferences.fontScale;
    if (els.fontScaleValue) {
      els.fontScaleValue.textContent = `${Math.round(preferences.fontScale * 100)}%`;
    }
    if (els.blurDisabledToggle) els.blurDisabledToggle.checked = preferences.blurDisabled;
    if (els.textShadowDisabledToggle) {
      els.textShadowDisabledToggle.checked = preferences.textShadowDisabled;
    }
    if (els.hideTimestampsToggle) {
      els.hideTimestampsToggle.checked = preferences.messageTimestampsHidden;
    }
    if (els.hideTokenCountToggle) {
      els.hideTokenCountToggle.checked = preferences.messageTokenCountHidden;
    }
    if (els.chatStyleSelect) els.chatStyleSelect.value = preferences.chatStyle;
  }

  function handleCustomCssInput() {
    if (!els.customCssInput) return;
    preferences.customCss = els.customCssInput.value;
    persist();
    if (els.displayPrefsStatus) {
      els.displayPrefsStatus.textContent = '自定义 CSS 已应用';
      els.displayPrefsStatus.className = 'status-text is-ok';
      clearTimeout(handleCustomCssInput._timer);
      handleCustomCssInput._timer = setTimeout(() => {
        if (els.displayPrefsStatus) els.displayPrefsStatus.textContent = '';
      }, 2000);
    }
  }

  function handleChatWidthScale() {
    if (!els.chatWidthScale) return;
    preferences.chatWidthScale = Number(els.chatWidthScale.value);
    persist();
    renderDisplayPreferences();
  }

  function handleFontScale() {
    if (!els.fontScale) return;
    preferences.fontScale = Number(els.fontScale.value);
    persist();
    renderDisplayPreferences();
  }

  function handleBlurDisabled() {
    if (!els.blurDisabledToggle) return;
    preferences.blurDisabled = els.blurDisabledToggle.checked;
    persist();
  }

  function handleTextShadowDisabled() {
    if (!els.textShadowDisabledToggle) return;
    preferences.textShadowDisabled = els.textShadowDisabledToggle.checked;
    persist();
  }

  function handleHideTimestamps() {
    if (!els.hideTimestampsToggle) return;
    preferences.messageTimestampsHidden = els.hideTimestampsToggle.checked;
    persist();
  }

  function handleHideTokenCount() {
    if (!els.hideTokenCountToggle) return;
    preferences.messageTokenCountHidden = els.hideTokenCountToggle.checked;
    persist();
  }

  function handleChatStyleChange() {
    if (!els.chatStyleSelect) return;
    preferences.chatStyle = CHAT_STYLES.includes(els.chatStyleSelect.value)
      ? els.chatStyleSelect.value
      : 'reader';
    persist();
  }

  function handleResetCustomCss() {
    preferences.customCss = '';
    persist();
    renderDisplayPreferences();
    if (els.displayPrefsStatus) {
      els.displayPrefsStatus.textContent = '自定义 CSS 已清除';
      els.displayPrefsStatus.className = 'status-text is-ok';
    }
  }

  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;

    els.customCssInput?.addEventListener('input', handleCustomCssInput);
    els.chatWidthScale?.addEventListener('input', handleChatWidthScale);
    els.fontScale?.addEventListener('input', handleFontScale);
    els.blurDisabledToggle?.addEventListener('change', handleBlurDisabled);
    els.textShadowDisabledToggle?.addEventListener('change', handleTextShadowDisabled);
    els.hideTimestampsToggle?.addEventListener('change', handleHideTimestamps);
    els.hideTokenCountToggle?.addEventListener('change', handleHideTokenCount);
    els.chatStyleSelect?.addEventListener('change', handleChatStyleChange);
    els.resetCustomCss?.addEventListener('click', handleResetCustomCss);
  }

  function init() {
    applyDisplayPreferences(preferences, documentObject);
    renderDisplayPreferences();
    bindEvents();
  }

  return {
    init,
    bindEvents,
    renderDisplayPreferences,
    getPreferences: () => ({ ...preferences })
  };
}
