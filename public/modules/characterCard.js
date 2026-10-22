import { isPlainObject, prettyJson } from './utils.js';
import {
  buildResourcePresetCatalog,
  getResourceSelectionId,
  renderResourceOptionGroup,
  RESOURCE_PRESET_KEYS
} from './resourcePresetCatalog.js';
import {
  getCardAssetLabel,
  getCardAssetPreviewUrl,
  isCardAssetPreviewable,
  normalizeCardAssets
} from './cardAssets.js';

const PRESET_KEY_PACK_MAPPINGS = [
  ['yingxiongzhi', 'yingxiongzhi'],
  ['xuanhuan', 'xuanhuan'],
  ['lingyi', 'lingyi'],
  ['mingmo', 'mingmo'],
  ['xianxia', 'xianxia'],
  ['yechenzhou', 'xuanhuan']
];

const TAG_PACK_MAPPINGS = [
  ['英雄志', 'yingxiongzhi'],
  ['玄幻', 'xuanhuan'],
  ['灵异', 'lingyi'],
  ['民俗', 'lingyi'],
  ['明末', 'mingmo'],
  ['仙侠', 'xianxia'],
  ['修真', 'xianxia']
];

export function inferCharacterContentPackId(characterCard, presetKey = '', knownContentPackIds = []) {
  const explicitPack = characterCard?.extensions?.contentPack
    || characterCard?.extensions?.content_pack
    || characterCard?.metadata?.contentPack
    || characterCard?.metadata?.content_pack;
  const knownPacks = new Set(
    (Array.isArray(knownContentPackIds) ? knownContentPackIds : [])
      .map((packId) => String(packId || '').trim())
      .filter(Boolean)
  );
  if (explicitPack && knownPacks.has(String(explicitPack))) return String(explicitPack);

  const normalizedKey = String(presetKey || '').toLowerCase();
  const mappedByKey = PRESET_KEY_PACK_MAPPINGS
    .find(([needle]) => normalizedKey === needle || normalizedKey.startsWith(`${needle}_`));
  if (mappedByKey) return mappedByKey[1];

  const tagText = (Array.isArray(characterCard?.tags) ? characterCard.tags : [])
    .map((tag) => String(tag).toLowerCase())
    .join(' ');
  return TAG_PACK_MAPPINGS.find(([needle]) => tagText.includes(needle))?.[1] || '';
}

export function getCharacterCompatibility(
  characterCard,
  presetKey = '',
  { storyPackId = '', knownContentPackIds = [] } = {}
) {
  const characterPackId = inferCharacterContentPackId(
    characterCard,
    presetKey,
    knownContentPackIds
  );
  return {
    storyPackId,
    characterPackId,
    mismatched: Boolean(storyPackId && characterPackId && storyPackId !== characterPackId)
  };
}

export function formatCharacterOverviewValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => formatCharacterOverviewValue(item)).filter(Boolean).join('\n');
  }
  if (isPlainObject(value)) {
    return Object.entries(value)
      .map(([key, item]) => `${key}：${formatCharacterOverviewValue(item)}`)
      .filter((item) => !item.endsWith('：'))
      .join('\n');
  }
  return String(value || '').trim();
}

export function createCharacterCardController({
  elements = {},
  apiRequest,
  setStatus,
  humanizeError = (error) => error?.message || String(error),
  getSessionId = () => 'main',
  getCharacterCard = () => ({}),
  setCharacterCard = () => {},
  getCharacterPresets = () => [],
  setCharacterPresets = () => {},
  getResources = () => [],
  getWorldBook = () => [],
  setWorldBook = () => {},
  getPromptModules = () => [],
  setPromptModules = () => {},
  getDynamicPresets = () => ({}),
  getStaticPresets = () => ({}),
  getKnownContentPackIds = () => [],
  getAppliedContentPackId = () => '',
  getContentPackTitle = (packId, fallback = '自定义') => packId || fallback,
  getContentPackGenreTitle = (packId) => packId,
  createCharacterCardTemplate = () => ({}),
  createCharacterPortraitImage = () => null,
  // createCharacterPortraitImage(pack.characterPortrait, 'story-card-portrait')
  promptAction = (...args) => globalThis.prompt?.(...args),
  confirmAction = (...args) => globalThis.confirm?.(...args),
  documentRef = globalThis.document
} = {}) {
  const ui = {
    overview: elements.characterOverview,
    editor: elements.characterCardEditor,
    status: elements.characterCardStatus,
    save: elements.saveCharacterCard,
    export: elements.exportCharacterCard,
    exportV3: elements.exportCharacterCardV3,
    presetFavorites: elements.characterPresetFavorites,
    loadPresetFavorite: elements.loadCharacterPreset,
    savePresetFavorite: elements.saveCharacterPreset,
    deletePresetFavorite: elements.deleteCharacterPreset,
    reset: elements.resetCharacterCard,
    presetSelect: elements.characterPresetSelect,
    applyPreset: elements.applyCharacterPreset
  };
  let characterPresetLoadVersion = 0;

  function updateStatus(text, tone) {
    if (ui.status) setStatus?.(ui.status, text, tone);
  }

  function knownContentPackIds() {
    return Array.from(new Set(
      (getKnownContentPackIds() || []).map((packId) => String(packId || '').trim()).filter(Boolean)
    ));
  }

  function compatibilityFor(characterCard, presetKey = '') {
    return getCharacterCompatibility(characterCard, presetKey, {
      storyPackId: getAppliedContentPackId(),
      knownContentPackIds: knownContentPackIds()
    });
  }

  function safeObjectFromEditor() {
    try {
      const value = JSON.parse(ui.editor?.value || '{}');
      return isPlainObject(value) ? value : {};
    } catch {
      return {};
    }
  }

  function parseEditor() {
    let characterCard;
    try {
      characterCard = JSON.parse(ui.editor?.value || 'null');
    } catch {
      throw new Error('角色卡 JSON 解析失败');
    }
    if (!isPlainObject(characterCard)) throw new Error('角色卡 JSON 必须是普通对象');
    return characterCard;
  }

  function setCharacterCardEditor(characterCard) {
    const safeCard = isPlainObject(characterCard) ? characterCard : createCharacterCardTemplate();
    if (ui.editor) ui.editor.value = prettyJson(safeCard);
    renderCharacterOverview(safeCard);
  }

  function resetCharacterCompatibilityConfirmation(button) {
    if (!button) return;
    const originalLabel = button.dataset.compatibilityOriginalLabel;
    if (originalLabel) button.textContent = originalLabel;
    delete button.dataset.compatibilityToken;
    delete button.dataset.compatibilityOriginalLabel;
  }

  function confirmCharacterCompatibility({ button, characterCard, presetKey = '' }) {
    const compatibility = compatibilityFor(characterCard, presetKey);
    if (!compatibility.mismatched) {
      resetCharacterCompatibilityConfirmation(button);
      return true;
    }

    const token = `${compatibility.storyPackId}:${compatibility.characterPackId}:${presetKey || characterCard?.name || ''}`;
    if (button?.dataset.compatibilityToken === token) {
      resetCharacterCompatibilityConfirmation(button);
      return true;
    }

    if (button) {
      button.dataset.compatibilityOriginalLabel = button.textContent || '加载';
      button.dataset.compatibilityToken = token;
      button.textContent = '仍然加载';
    }
    updateStatus(
      `题材冲突：当前故事是“${getContentPackTitle(compatibility.storyPackId)}”，角色属于“${getContentPackTitle(compatibility.characterPackId)}”。再次点击可原样加载。`,
      'warning'
    );
    return false;
  }

  function createCharacterOverviewSection(title, value, options = {}) {
    const text = formatCharacterOverviewValue(value);
    if (!text || !documentRef) return null;
    const section = documentRef.createElement('div');
    section.className = 'immersive-character-section';
    const summary = documentRef.createElement('h5');
    summary.textContent = title;
    const content = documentRef.createElement('p');
    content.textContent = text;
    section.append(summary, content);
    return section;
  }

  // V3 creator_notes_multilingual：按语言代码分组展示。
  // 常见语言代码映射为中文标签，未覆盖的保留原代码。
  const LANGUAGE_LABELS = {
    en: 'English',
    zh: '中文',
    'zh-CN': '中文（简体）',
    'zh-TW': '中文（繁體）',
    ja: '日本語',
    ko: '한국어',
    es: 'Español',
    fr: 'Français',
    de: 'Deutsch',
    ru: 'Русский'
  };

  function createMultilingualCreatorNotesSection(multilingualNotes) {
    if (!multilingualNotes || !documentRef) return null;
    const entries = Object.entries(multilingualNotes)
      .map(([lang, text]) => [lang, String(text || '').trim()])
      .filter(([, text]) => text);
    if (!entries.length) return null;
    const section = documentRef.createElement('div');
    section.className = 'immersive-character-section character-multilingual-notes';
    const summary = documentRef.createElement('h5');
    summary.textContent = '多语言注释';
    section.append(summary);
    entries.forEach(([lang, text]) => {
      const block = documentRef.createElement('div');
      block.className = 'character-multilingual-note';
      const label = documentRef.createElement('span');
      label.className = 'character-multilingual-note-lang';
      label.textContent = LANGUAGE_LABELS[lang] || lang;
      const content = documentRef.createElement('p');
      content.textContent = text;
      block.append(label, content);
      section.append(block);
    });
    return section;
  }

  // V3 assets：图片类素材生成预览缩略图（外链经 /api/proxy-image 安全代理），
  // 非图片类仅列出名称与类型；拒绝 data:/javascript: 等非代理 URI。
  function createCardAssetsSection(assets) {
    const normalized = normalizeCardAssets(assets);
    if (!normalized.length || !documentRef) return null;
    const section = documentRef.createElement('div');
    section.className = 'immersive-character-section character-assets';
    const summary = documentRef.createElement('h5');
    summary.textContent = `卡内素材（${normalized.length}）`;
    section.append(summary);
    const grid = documentRef.createElement('div');
    grid.className = 'character-assets-grid';
    normalized.slice(0, 24).forEach((asset) => {
      const item = documentRef.createElement('figure');
      item.className = 'character-asset-item';
      const previewUrl = getCardAssetPreviewUrl(asset);
      if (previewUrl && isCardAssetPreviewable(asset)) {
        const image = documentRef.createElement('img');
        image.className = 'character-asset-thumb';
        image.src = previewUrl;
        image.alt = asset.name;
        image.loading = 'lazy';
        image.decoding = 'async';
        // 代理失败（外链失效/被 SSRF 策略拦截）时降级为占位块，不产生裂图
        image.addEventListener('error', () => {
          image.remove();
          renderAssetFallback(item, asset);
        });
        item.append(image);
      } else {
        renderAssetFallback(item, asset);
      }
      const caption = documentRef.createElement('figcaption');
      caption.className = 'character-asset-caption';
      const typeLabel = documentRef.createElement('span');
      typeLabel.textContent = getCardAssetLabel(asset.type);
      const nameText = documentRef.createElement('span');
      nameText.textContent = asset.name;
      caption.append(typeLabel, nameText);
      item.append(caption);
      grid.append(item);
    });
    section.append(grid);
    return section;
  }

  function renderAssetFallback(item, asset) {
    if (item.querySelector('.character-asset-fallback')) return;
    const placeholder = documentRef.createElement('div');
    placeholder.className = 'character-asset-fallback';
    placeholder.textContent = getCardAssetLabel(asset.type);
    item.prepend(placeholder);
  }

  // 卡片规范版本标签（chara_card_v2 / chara_card_v3 等）
  const SPEC_LABELS = {
    chara_card_v2: 'V2 卡',
    chara_card_v3: 'V3 卡',
    'yaml-character-card': 'YAML 卡'
  };

  function createSpecBadge(sourceSpec) {
    const spec = String(sourceSpec || '').trim();
    const label = SPEC_LABELS[spec.toLowerCase()] || (spec ? spec : '');
    if (!label || !documentRef) return null;
    const badge = documentRef.createElement('span');
    badge.className = 'character-spec-badge';
    badge.textContent = label;
    return badge;
  }

  function renderCharacterOverview(characterCard = getCharacterCard() || {}) {
    if (!ui.overview || !documentRef) return;
    const card = isPlainObject(characterCard) ? characterCard : {};
    const compatibility = compatibilityFor(card);
    const tags = Array.isArray(card.tags) ? card.tags.filter(Boolean) : [];
    const alternateGreetings = card.alternateGreetings || card.alternate_greetings || [];
    const exampleDialog = card.exampleDialog || card.mes_example || [];
    const firstMessage = card.firstMessage || card.first_mes || '';
    const creatorNotes = card.creatorNotes || card.creator_notes || '';
    // V3 规范：creator_notes_multilingual 是 { lang: notes } 映射。
    // 当存在多语言注释时，以语言标签分组展示；否则回退到单一 creatorNotes。
    const multilingualNotes = isPlainObject(card.creatorNotesMultilingual)
      ? card.creatorNotesMultilingual
      : (isPlainObject(card.creator_notes_multilingual) ? card.creator_notes_multilingual : null);
    const systemPrompt = card.systemPrompt || card.system_prompt || '';
    const postHistory = card.postHistoryInstructions || card.post_history_instructions || '';
    ui.overview.replaceChildren();

    const heading = documentRef.createElement('header');
    heading.className = 'character-overview-heading';
    const headingText = documentRef.createElement('div');
    const eyebrow = documentRef.createElement('span');
    eyebrow.textContent = '当前角色卡';
    const name = documentRef.createElement('strong');
    name.textContent = card.name || '未命名角色';
    headingText.append(eyebrow, name);
    const specBadge = createSpecBadge(card.sourceSpec || card.spec);
    if (specBadge) headingText.append(specBadge);
    const profile = documentRef.createElement('div');
    profile.className = 'character-overview-profile';
    const portrait = createCharacterPortraitImage(card, 'character-overview-portrait', card.name);
    if (portrait) profile.append(portrait);
    profile.append(headingText);
    const packBadge = documentRef.createElement('span');
    packBadge.className = `character-pack-badge${compatibility.mismatched ? ' is-mismatched' : ''}`;
    packBadge.textContent = compatibility.characterPackId
      ? getContentPackTitle(compatibility.characterPackId)
      : '未声明题材';
    heading.append(profile, packBadge);
    ui.overview.append(heading);

    if (compatibility.mismatched) {
      const warning = documentRef.createElement('div');
      warning.className = 'character-compatibility-warning';
      warning.textContent = `当前故事为“${getContentPackTitle(compatibility.storyPackId)}”，此角色属于“${getContentPackTitle(compatibility.characterPackId)}”。加载或保存前请确认是否需要本地化。`;
      ui.overview.append(warning);
    }

    const identity = documentRef.createElement('div');
    identity.className = 'character-identity-grid';
    const identityItems = [
      ['身份', card.role || card.extensions?.role || '未填写'],
      ['作者', card.creator || '本地创作'],
      ['版本', card.characterVersion || card.character_version || '未标注'],
      ['素材', `${tags.length} 标签 · ${Array.isArray(alternateGreetings) ? alternateGreetings.length : 0} 备选开场 · ${Array.isArray(exampleDialog) ? exampleDialog.length : 0} 对话样例`]
    ];
    identityItems.forEach(([label, value]) => {
      const row = documentRef.createElement('div');
      const key = documentRef.createElement('span');
      key.textContent = label;
      const content = documentRef.createElement('strong');
      content.textContent = String(value);
      row.append(key, content);
      identity.append(row);
    });
    ui.overview.append(identity);

    if (tags.length) {
      const tagList = documentRef.createElement('div');
      tagList.className = 'character-tag-list';
      tags.slice(0, 12).forEach((tag) => {
        const chip = documentRef.createElement('span');
        chip.textContent = String(tag);
        tagList.append(chip);
      });
      ui.overview.append(tagList);
    }

    const sectionsWrapper = documentRef.createElement('div');
    sectionsWrapper.className = 'immersive-character-body';

    [
      createCharacterOverviewSection('人物设定', card.description, { open: true }),
      createCharacterOverviewSection('性格与行为', card.personality),
      createCharacterOverviewSection('当前处境', card.scenario),
      createCharacterOverviewSection('开场白', firstMessage),
      createCharacterOverviewSection('叙事约束', [systemPrompt, postHistory]),
      createCharacterOverviewSection('创作者说明', creatorNotes),
      // V3 多语言注释：当卡片声明了 creator_notes_multilingual 时，按语言分组展示。
      createMultilingualCreatorNotesSection(multilingualNotes),
      // V3 assets：卡内素材列表（图片经安全代理预览，非图片仅列出）
      createCardAssetsSection(card.assets)
    ].filter(Boolean).forEach((section) => sectionsWrapper.append(section));

    ui.overview.append(sectionsWrapper);
  }

  async function saveCharacterCard() {
    updateStatus('正在保存...', 'busy');
    if (ui.save) ui.save.disabled = true;
    try {
      const characterCard = parseEditor();
      const payload = await apiRequest('/api/character-card', {
        method: 'PUT',
        body: {
          sessionId: getSessionId(),
          characterCard
        }
      });
      const savedCharacterCard = payload.characterCard || characterCard;
      setCharacterCard(savedCharacterCard);
      setCharacterCardEditor(savedCharacterCard);
      updateStatus('角色卡已保存', 'ok');
      return savedCharacterCard;
    } catch (error) {
      updateStatus(`保存失败：${error.message}`, 'error');
      return null;
    } finally {
      if (ui.save) ui.save.disabled = false;
    }
  }

  function exportCharacterCardPng() {
    if (!documentRef?.body) return;
    const anchor = documentRef.createElement('a');
    anchor.href = `/api/character-card/export?sessionId=${encodeURIComponent(getSessionId())}`;
    anchor.download = `${getCharacterCard()?.name || 'character'}.png`;
    documentRef.body.append(anchor);
    anchor.click();
    anchor.remove();
    updateStatus('已导出 PNG 角色卡', 'ok');
  }

  function exportCharacterCardV3() {
    if (!documentRef?.body) return;
    const anchor = documentRef.createElement('a');
    anchor.href = `/api/character-card/export-v3?sessionId=${encodeURIComponent(getSessionId())}`;
    anchor.download = `${getCharacterCard()?.name || 'character'}.v3.json`;
    documentRef.body.append(anchor);
    anchor.click();
    anchor.remove();
    updateStatus('已导出 V3 JSON 角色卡（含本地核心记忆）', 'ok');
  }

  function renderCharacterPresetFavorites() {
    renderImportedCharacterPresets();
    if (!ui.presetFavorites || !documentRef) return;
    const presets = Array.isArray(getCharacterPresets()) ? getCharacterPresets() : [];
    const current = ui.presetFavorites.value;
    ui.presetFavorites.innerHTML = '<option value="">-- 收藏的角色 --</option>';
    for (const preset of presets) {
      const option = documentRef.createElement('option');
      option.value = preset.id;
      option.textContent = preset.name || preset.characterCard?.name || '未命名';
      ui.presetFavorites.append(option);
    }
    if (current) ui.presetFavorites.value = current;
  }

  function renderImportedCharacterPresets() {
    const catalog = buildResourcePresetCatalog(getResources());
    renderResourceOptionGroup({
      select: ui.presetSelect,
      documentObject: documentRef,
      groupId: RESOURCE_PRESET_KEYS.characterGroupId,
      groupLabel: '已导入角色卡',
      preservePrefix: RESOURCE_PRESET_KEYS.characterPrefix,
      options: catalog.characters.map((resource) => ({
        value: `${RESOURCE_PRESET_KEYS.characterPrefix}${resource.id}`,
        label: resource.title || resource.payload?.name || '未命名角色'
      }))
    });
  }

  function getImportedCharacterResource(presetKey) {
    const resourceId = getResourceSelectionId(presetKey, RESOURCE_PRESET_KEYS.characterPrefix);
    if (!resourceId) return null;
    return buildResourcePresetCatalog(getResources()).characters
      .find((resource) => resource.id === resourceId) || null;
  }

  async function saveCharacterPresetFavorite() {
    const name = promptAction('收藏名称：', getCharacterCard()?.name || '');
    if (name === null || name === undefined) return;
    try {
      const payload = await apiRequest('/api/character-presets', {
        method: 'POST',
        body: {
          name: name || undefined,
          characterCard: getCharacterCard(),
          worldBook: getWorldBook(),
          promptModules: getPromptModules()
        }
      });
      setCharacterPresets(payload.characterPresets);
      renderCharacterPresetFavorites();
      if (ui.presetFavorites) ui.presetFavorites.value = payload.preset?.id || '';
      updateStatus('已收藏当前角色配置', 'ok');
    } catch (error) {
      updateStatus(`收藏失败：${humanizeError(error)}`, 'error');
    }
  }

  async function loadCharacterPresetFavorite() {
    const presetId = ui.presetFavorites?.value;
    if (!presetId) {
      updateStatus('请先选择一个收藏', 'error');
      return;
    }
    const preset = (getCharacterPresets() || []).find((item) => item.id === presetId);
    if (!preset) return;
    if (preset.characterCard && !confirmCharacterCompatibility({
      button: ui.loadPresetFavorite,
      characterCard: preset.characterCard,
      presetKey: `favorite:${presetId}`
    })) return;

    const requestVersion = ++characterPresetLoadVersion;
    const requestedSessionId = String(getSessionId() || 'main');
    try {
      const payload = await apiRequest('/api/character-presets/apply', {
        method: 'PUT',
        body: {
          sessionId: requestedSessionId,
          characterCard: isPlainObject(preset.characterCard) ? preset.characterCard : {},
          worldBook: Array.isArray(preset.worldBook) ? preset.worldBook : [],
          promptModules: Array.isArray(preset.promptModules) ? preset.promptModules : []
        }
      });
      if (requestVersion !== characterPresetLoadVersion
        || String(getSessionId() || 'main') !== requestedSessionId) return;
      setCharacterCard(payload.characterCard);
      setCharacterCardEditor(payload.characterCard);
      setWorldBook(payload.worldBook);
      setPromptModules(payload.promptModules);
      updateStatus(`已加载收藏：${preset.name}`, 'ok');
    } catch (error) {
      updateStatus(`加载失败：${humanizeError(error)}`, 'error');
    }
  }

  async function deleteCharacterPresetFavorite() {
    const presetId = ui.presetFavorites?.value;
    if (!presetId) {
      updateStatus('请先选择一个收藏', 'error');
      return;
    }
    if (!confirmAction('确认删除该收藏？')) return;
    try {
      const payload = await apiRequest('/api/character-presets', {
        method: 'DELETE',
        body: { id: presetId }
      });
      setCharacterPresets(payload.characterPresets);
      renderCharacterPresetFavorites();
      updateStatus('已删除收藏', 'ok');
    } catch (error) {
      updateStatus(`删除失败：${humanizeError(error)}`, 'error');
    }
  }

  function resetCharacterCardTemplate() {
    setCharacterCardEditor({
      ...createCharacterCardTemplate(),
      ...safeObjectFromEditor()
    });
    updateStatus('已套用角色卡模板，编辑后保存', 'ok');
  }

  async function loadContentPackCharacterPresets(packId, options = {}) {
    const safePackId = String(packId || '').trim();
    if (!safePackId || !ui.presetSelect) return [];
    const requestVersion = ++characterPresetLoadVersion;
    const requestedSessionId = String(getSessionId() || 'main');
    const canRenderRequest = () => {
      const appliedPackId = String(getAppliedContentPackId() || '');
      return requestVersion === characterPresetLoadVersion
        && String(getSessionId() || 'main') === requestedSessionId
        && (!appliedPackId || appliedPackId === safePackId);
    };

    const dynamicPresets = getDynamicPresets() || {};
    const cached = Object.values(dynamicPresets).filter((preset) => preset.packId === safePackId);
    if (cached.length) {
      if (canRenderRequest()) renderContentPackCharacterPresets(safePackId, cached);
      return cached;
    }

    try {
      const payload = await apiRequest(`/api/content-packs/${encodeURIComponent(safePackId)}/characters`);
      const presets = (Array.isArray(payload.characterPresets) ? payload.characterPresets : [])
        .filter((preset) => preset?.id && preset?.characterCard)
        .map((preset) => ({
          ...preset,
          packId: safePackId,
          selectKey: `content-pack:${safePackId}:${preset.id}`
        }));
      presets.forEach((preset) => {
        dynamicPresets[preset.selectKey] = preset;
      });
      if (canRenderRequest()) renderContentPackCharacterPresets(safePackId, presets);
      return presets;
    } catch (error) {
      if (!options.silent) {
        updateStatus(`角色预设加载失败：${humanizeError(error)}`, 'error');
      }
      return [];
    }
  }

  function renderContentPackCharacterPresets(packId, presets) {
    if (!ui.presetSelect || !documentRef) return;
    const groupId = `content-pack-character-group-${packId}`;
    ui.presetSelect.querySelector(`#${groupId}`)?.remove();
    if (!Array.isArray(presets) || !presets.length) return;
    if (presets.length === 1 && packId !== 'yingxiongzhi') return;

    const group = documentRef.createElement('optgroup');
    group.id = groupId;
    group.label = `${getContentPackGenreTitle(packId)}角色`;
    presets.forEach((preset) => {
      const option = documentRef.createElement('option');
      option.value = preset.selectKey;
      const role = String(preset.role || '').split(' · ')[0];
      option.textContent = role ? `${preset.name}（${role}）` : preset.name;
      group.append(option);
    });
    ui.presetSelect.append(group);
  }

  function applyCharacterPreset() {
    const presetKey = ui.presetSelect?.value;
    if (!presetKey) return;
    const dynamicPreset = (getDynamicPresets() || {})[presetKey];
    const importedResource = getImportedCharacterResource(presetKey);
    const preset = (getStaticPresets() || {})[presetKey]
      || dynamicPreset?.characterCard
      || importedResource?.payload;
    if (!preset) return;
    if (!confirmCharacterCompatibility({
      button: ui.applyPreset,
      characterCard: preset,
      presetKey
    })) return;
    setCharacterCardEditor(preset);
    const sourceLabel = importedResource
      ? `已加载资源库角色：${importedResource.title || preset.name || '未命名角色'}`
      : dynamicPreset
        ? `已加载 ${dynamicPreset.name}`
        : '已加载预设';
    updateStatus(`${sourceLabel}，请点击保存生效`, 'ok');
  }

  function bindEvents() {
    ui.editor?.addEventListener('input', () => renderCharacterOverview(safeObjectFromEditor()));
    ui.save?.addEventListener('click', saveCharacterCard);
    ui.export?.addEventListener('click', exportCharacterCardPng);
    ui.exportV3?.addEventListener('click', exportCharacterCardV3);
    ui.loadPresetFavorite?.addEventListener('click', loadCharacterPresetFavorite);
    ui.savePresetFavorite?.addEventListener('click', saveCharacterPresetFavorite);
    ui.deletePresetFavorite?.addEventListener('click', deleteCharacterPresetFavorite);
    ui.reset?.addEventListener('click', resetCharacterCardTemplate);
    ui.applyPreset?.addEventListener('click', applyCharacterPreset);
    ui.presetSelect?.addEventListener('change', () => resetCharacterCompatibilityConfirmation(ui.applyPreset));
    ui.presetFavorites?.addEventListener('change', () => resetCharacterCompatibilityConfirmation(ui.loadPresetFavorite));
  }

  return {
    applyCharacterPreset,
    bindEvents,
    confirmCharacterCompatibility,
    deleteCharacterPresetFavorite,
    exportCharacterCardPng,
    exportCharacterCardV3,
    loadCharacterPresetFavorite,
    loadContentPackCharacterPresets,
    renderImportedCharacterPresets,
    renderCharacterOverview,
    renderCharacterPresetFavorites,
    resetCharacterCardTemplate,
    resetCharacterCompatibilityConfirmation,
    saveCharacterCard,
    saveCharacterPresetFavorite,
    setCharacterCardEditor
  };
}
