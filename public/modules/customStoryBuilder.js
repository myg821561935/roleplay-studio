import { STORY_IMPORT_MODES } from './importRouting.js';
import {
  compareMatchedResources,
  evaluatePromptGroupMatch,
  evaluateResourceMatch,
  getResourceImportBatchKey
} from './resourceMatching.js';
import {
  createCustomStoryApprovalController,
  createCustomStoryCompatibilityReview
} from './customStoryCompatibilityReview.js';
import { normalizeScriptExecutionMode } from './customStoryCompatibilityReviewState.js';
import {
  getCustomStoryInteractionReview,
  renderCustomStoryConflictSummary
} from './customStoryConflictSummary.js';
import {
  createCompatibilityUpgradeAssemblySignature,
  runCompatibilityUpgradeReview
} from './customStoryCompatibilityUpgrade.js';
import { createWorldBookRuntimeBudgetRow, formatWorldBookResourceMeta, summarizeWorldBookRuntimeBudget } from './worldBookRuntimeBudget.js';
import { createWorldBookTagMappingController } from './worldBookTagMapping.js';
import { CUSTOM_BASELINE_TEMPLATES } from './customStoryBaselineTemplates.js';
export { CUSTOM_BASELINE_TEMPLATES } from './customStoryBaselineTemplates.js';
export { createCompatibilityUpgradeAssemblySignature } from './customStoryCompatibilityUpgrade.js';
export const CUSTOM_STORY_DRAFT_KEY = 'localRoleplayCustomStoryDraft';
export const CUSTOM_STORY_BASE_PACK_ID = '__original__';
export const CUSTOM_STORY_STEPS = ['baseline', 'character', 'worldbook', 'prompt', 'review'];

export function createCustomBaselineDraft(value = {}) {
  return {
    templateId: String(value.templateId || 'blank'),
    worldName: String(value.worldName || '').slice(0, 80),
    genre: String(value.genre || '').slice(0, 100),
    premise: String(value.premise || '').slice(0, 5000),
    proseStyle: String(value.proseStyle || '').slice(0, 2500),
    hardRules: String(value.hardRules || '').slice(0, 2500),
    visualPackId: String(value.visualPackId || 'neutral')
  };
}

function isPromptLibraryResource(resource) {
  return resource?.kind === 'prompt' || resource?.kind === 'prompt-bundle';
}

export function createCustomStoryDraft(value = {}) {
  return {
    basePackId: String(value.basePackId || CUSTOM_STORY_BASE_PACK_ID),
    title: String(value.title || '').slice(0, 80),
    titleCustomized: value.titleCustomized === true,
    characterResourceId: String(value.characterResourceId || ''),
    useCharacterPortraitAsBackground: value.useCharacterPortraitAsBackground !== false,
    worldBookResourceIds: Array.isArray(value.worldBookResourceIds)
      ? Array.from(new Set(value.worldBookResourceIds.map((id) => String(id || '')).filter(Boolean)))
      : [],
    promptResourceIds: Array.isArray(value.promptResourceIds)
      ? Array.from(new Set(value.promptResourceIds.map((id) => String(id || '')).filter(Boolean)))
      : [],
    promptSelectionConfirmed: value.promptSelectionConfirmed === true,
    worldBookMergeMode: ['smart', 'base-first', 'resources-only'].includes(value.worldBookMergeMode)
      ? value.worldBookMergeMode
      : 'smart',
    creationMode: value.creationMode === STORY_IMPORT_MODES.INDEPENDENT
      ? STORY_IMPORT_MODES.INDEPENDENT
      : 'composed',
    customBaseline: createCustomBaselineDraft(value.customBaseline),
    compatibilityReview: createCustomStoryCompatibilityReview(value.compatibilityReview)
  };
}

export function loadCustomStoryDraft(storage = globalThis.localStorage) {
  const fallback = createCustomStoryDraft();
  try {
    const saved = JSON.parse(storage?.getItem(CUSTOM_STORY_DRAFT_KEY) || 'null');
    if (!saved || typeof saved !== 'object') return fallback;
    return createCustomStoryDraft(saved);
  } catch {
    return fallback;
  }
}

export function createCustomStoryBuilderController({
  state,
  els,
  apiRequest = async () => ({}),
  loadResourceLibrary = async () => {},
  getAppliedContentPackId = () => '',
  getStoryPackVisualId = () => 'neutral',
  getCharacterPortraitUrl = () => '',
  formatTokenCount = String,
  humanizeApiError = (error) => error?.message || String(error),
  setStatus = () => {},
  collectSelectedPromptResourceIds = () => [],
  groupPromptResources = (resources) => resources,
  importCharacterCardFile = async () => {},
  createAndOpenStoryProject = async () => ({ project: { title: '' }, session: {} }),
  confirmAction = (message) => globalThis.confirm?.(message) === true,
  storage = globalThis.localStorage,
  timerApi = globalThis.window || globalThis
} = {}) {
  let customStoryInspectionTimer = null;
  let customStoryInspectionRequest = 0;
  const approvalController = createCustomStoryApprovalController({
    state,
    element: els.storyCustomApprovals,
    getReadiness: getCustomStoryReadiness,
    persistDraft: persistCustomStoryDraft,
    renderReadiness: renderCustomStoryReadiness,
    invalidateInspection: invalidateCustomStoryInspection,
    confirmAction
  });
  const tagMappingController = createWorldBookTagMappingController({ apiRequest, loadResourceLibrary, invalidateInspection: invalidateCustomStoryInspection, persistDraft: persistCustomStoryDraft, renderBuilder: renderCustomStoryBuilder, reportStatus: (message, tone) => setStatus(els.storyCustomStatus, message, tone), humanizeError: humanizeApiError });
  function bindEvents() {
  els.openStoryCustomDialog?.addEventListener('click', () => openCustomStoryDialog());
    els.closeStoryCustomDialog?.addEventListener('click', closeCustomStoryDialog);
    els.cancelStoryCustomDialog?.addEventListener('click', closeCustomStoryDialog);
    els.storyCustomDialog?.addEventListener('click', (event) => {
      if (event.target === els.storyCustomDialog) closeCustomStoryDialog();
    });

  els.storyCustomSteps?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-story-custom-step]');
      if (button) setCustomStoryStep(button.dataset.storyCustomStep, { focus: true });
    });
    els.storyCustomLibrarySummary?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-story-library-step]');
      if (button) setCustomStoryStep(button.dataset.storyLibraryStep, { focus: true });
    });
    els.storyCustomDialog?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-story-import-kind]');
      if (button) openStoryResourceImportPicker(button.dataset.storyImportKind || '');
    });
    els.storyCustomPrev?.addEventListener('click', () => moveCustomStoryStep(-1));
    els.storyCustomNext?.addEventListener('click', () => moveCustomStoryStep(1));
    els.storyImportBase?.addEventListener('change', () => {
      state.customStoryDraft.basePackId = els.storyImportBase.value;
      state.customStoryDraft.creationMode = 'composed';
      if (!state.customStoryDraft.titleCustomized) {
        state.customStoryDraft.title = getCustomStorySuggestedTitle();
      }
      invalidateCustomStoryInspection();
      persistCustomStoryDraft();
      renderCustomStoryBuilder();
    });
    els.storyCustomTitle?.addEventListener('input', () => {
      state.customStoryDraft.title = els.storyCustomTitle.value;
      state.customStoryDraft.titleCustomized = true;
      persistCustomStoryDraft();
      renderCustomStoryReadiness();
    });
    els.storyCustomCharacter?.addEventListener('change', () => {
      const resources = Array.isArray(state.resourceLibrary) ? state.resourceLibrary : [];
      const previousCharacter = resources.find((item) => item.id === state.customStoryDraft.characterResourceId);
      const previousCompanions = new Set(getCompanionWorldBooks(previousCharacter, resources).map((item) => item.id));
      const clearedPromptCount = state.customStoryDraft.promptResourceIds.length;
      state.customStoryDraft.characterResourceId = els.storyCustomCharacter.value;
      state.customStoryDraft.promptResourceIds = [];
      state.customStoryDraft.promptSelectionConfirmed = false;
      const nextCharacter = resources.find((item) => item.id === state.customStoryDraft.characterResourceId);
      state.customStoryDraft.useCharacterPortraitAsBackground = Boolean(getCharacterPortraitUrl(nextCharacter?.payload));
      const nextCompanions = getCompanionWorldBooks(nextCharacter, resources).map((item) => item.id);
      state.customStoryDraft.worldBookResourceIds = Array.from(new Set([
        ...state.customStoryDraft.worldBookResourceIds.filter((id) => !previousCompanions.has(id)),
        ...nextCompanions
      ]));
      if (!state.customStoryDraft.titleCustomized) {
        state.customStoryDraft.title = getCustomStorySuggestedTitle();
      }
      invalidateCustomStoryInspection();
      persistCustomStoryDraft();
      renderCustomStoryBuilder();
      if (clearedPromptCount) {
        setStatus(
          els.storyCustomStatus,
          `角色已切换，已清除上一角色保留的 ${clearedPromptCount} 个 Prompt / 预设；请在第 4 步按当前角色重新选择。`,
          'ok'
        );
      }
    });
    els.storyCustomCharacterBackground?.addEventListener('change', () => {
      state.customStoryDraft.useCharacterPortraitAsBackground = els.storyCustomCharacterBackground.checked;
      invalidateCustomStoryInspection();
      persistCustomStoryDraft();
      renderCustomStoryReadiness();
    });
    els.storyCustomWorldbookMode?.addEventListener('change', () => {
      state.customStoryDraft.worldBookMergeMode = els.storyCustomWorldbookMode.value;
      invalidateCustomStoryInspection();
      persistCustomStoryDraft();
      renderCustomStoryReadiness();
    });
    els.storyCustomBaselineTemplate?.addEventListener('change', () => {
      applyCustomBaselineTemplate(els.storyCustomBaselineTemplate.value);
    });
    [
      ['storyCustomWorldName', 'worldName'],
      ['storyCustomGenre', 'genre'],
      ['storyCustomPremise', 'premise'],
      ['storyCustomProseStyle', 'proseStyle'],
      ['storyCustomHardRules', 'hardRules']
    ].forEach(([elementKey, draftKey]) => {
      els[elementKey]?.addEventListener('input', () => {
        state.customStoryDraft.customBaseline[draftKey] = els[elementKey].value;
        state.customStoryDraft.customBaseline.templateId = 'blank';
        if (!state.customStoryDraft.titleCustomized) {
          state.customStoryDraft.title = getCustomStorySuggestedTitle();
          if (els.storyCustomTitle) els.storyCustomTitle.value = state.customStoryDraft.title;
        }
        invalidateCustomStoryInspection();
        persistCustomStoryDraft();
        renderCustomStoryReadiness();
      });
    });
    els.storyCustomVisualPack?.addEventListener('change', () => {
      state.customStoryDraft.customBaseline.visualPackId = els.storyCustomVisualPack.value;
      state.customStoryDraft.customBaseline.templateId = 'blank';
      invalidateCustomStoryInspection();
      persistCustomStoryDraft();
      renderCustomStoryReadiness();
    });
    els.storyCustomWorldbookList?.addEventListener('change', (event) => {
      if (!event.target.matches('input[type="checkbox"]')) return;
      state.customStoryDraft.worldBookResourceIds = Array.from(
        els.storyCustomWorldbookList.querySelectorAll('input:checked')
      ).map((input) => input.value);
      invalidateCustomStoryInspection();
      persistCustomStoryDraft();
      renderCustomStoryReadiness();
    });
    els.storyCustomPromptList?.addEventListener('change', (event) => {
      if (!event.target.matches('input[type="checkbox"]')) return;
      state.customStoryDraft.promptResourceIds = collectSelectedPromptResourceIds(els.storyCustomPromptList);
      state.customStoryDraft.promptSelectionConfirmed = true;
      invalidateCustomStoryInspection();
      persistCustomStoryDraft();
      renderCustomStoryReadiness();
    });
    approvalController.bindEvents();
    els.storyCustomCreate?.addEventListener('click', createCustomStoryFromDraft);
    els.storyImportTrigger?.addEventListener('click', () => openStoryResourceImportPicker(''));
    els.storyImportFile?.addEventListener('change', () => {
      const basePackId = els.storyImportBase?.value || '';
      if (!basePackId) {
        setStatus(els.storyCustomStatus, '请先选择题材基线。', 'error');
        if (els.storyImportFile) els.storyImportFile.value = '';
        return;
      }
      void importCharacterCardFile(els.storyImportFile, {
        intent: 'create-story',
        basePackId
      });
    });
  }

  async function openCustomStoryDialog(options = {}) {
    if (!els.storyCustomDialog) return;
    state.customStoryStep = CUSTOM_STORY_STEPS.includes(options.step) ? options.step : 'baseline';
    renderStoryImportBaseOptions();
    renderCustomStoryBuilder();
    if (!els.storyCustomDialog.open) els.storyCustomDialog.showModal();
    if (options.resetStatus !== false) {
      setStatus(els.storyCustomStatus, '选择基线与素材后，系统会先检查完整性再创建剧本。');
    }
    setCustomStoryStep(state.customStoryStep);
    timerApi.setTimeout(() => {
      const activePanel = els.storyCustomStepPanels.find((panel) => panel.dataset.storyCustomPanel === state.customStoryStep);
      activePanel?.querySelector('select, input, textarea, button')?.focus();
    }, 0);
    await loadResourceLibrary();
    renderStoryImportBaseOptions();
    renderCustomStoryBuilder();
  }

  async function openCompatibilityUpgradeReview(preview = {}) {
    return runCompatibilityUpgradeReview(preview, {
      state,
      createDraft: createCustomStoryDraft,
      originalBasePackId: CUSTOM_STORY_BASE_PACK_ID,
      invalidateInspection: invalidateCustomStoryInspection,
      persistDraft: persistCustomStoryDraft,
      openDialog: openCustomStoryDialog,
      cancelInspection: () => {
        timerApi.clearTimeout(customStoryInspectionTimer);
        customStoryInspectionRequest += 1;
      },
      buildPackRequest: buildCustomPackRequest,
      renderBuilder: renderCustomStoryBuilder,
      setStep: setCustomStoryStep,
      reportStatus: (message, tone) => setStatus(els.storyCustomStatus, message, tone)
    });
  }

  function openStoryResourceImportPicker(kind = '') {
    if (!els.storyImportFile) return;
    const acceptedTypes = {
      character: '.png,.json,image/png,application/json',
      worldbook: '.json,.yaml,.yml,.txt,application/json,text/yaml,text/plain',
      prompt: '.json,.yaml,.yml,.txt,application/json,text/yaml,text/plain'
    };
    els.storyImportFile.dataset.assetImportKind = kind;
    els.storyImportFile.accept = acceptedTypes[kind]
      || '.json,.png,.yaml,.yml,.txt,application/json,image/png,text/yaml,text/plain';
    els.storyImportFile.click();
  }

  function closeCustomStoryDialog() {
    if (els.storyCustomDialog?.open) els.storyCustomDialog.close();
  }

  function openDerivedStoryBuilder(packId) {
    const pack = (state.contentPacks || []).find((item) => item.id === packId && item.custom !== true);
    if (!pack) return;
    state.customStoryDraft = createCustomStoryDraft({
      basePackId: pack.id,
      title: `${pack.title || pack.id} · 派生版`,
      titleCustomized: true
    });
    invalidateCustomStoryInspection();
    persistCustomStoryDraft();
    openCustomStoryDialog({ step: 'baseline' });
  }

  function setCustomStoryStep(step, { focus = false } = {}) {
    if (!CUSTOM_STORY_STEPS.includes(step)) return;
    state.customStoryStep = step;
    const activeIndex = CUSTOM_STORY_STEPS.indexOf(step);
    els.storyCustomStepButtons.forEach((button, index) => {
      const active = button.dataset.storyCustomStep === step;
      button.toggleAttribute('aria-current', active);
      button.classList.toggle('is-active', active);
      button.classList.toggle('is-complete', index < activeIndex);
    });
    els.storyCustomStepPanels.forEach((panel) => {
      panel.hidden = panel.dataset.storyCustomPanel !== step;
    });
    if (els.storyCustomPrev) els.storyCustomPrev.hidden = activeIndex === 0;
    if (els.storyCustomNext) els.storyCustomNext.hidden = activeIndex === CUSTOM_STORY_STEPS.length - 1;
    if (els.storyCustomCreate) els.storyCustomCreate.hidden = step !== 'review';
    if (step === 'review') renderCustomStoryStackPreview();
    if (focus) {
      const activePanel = els.storyCustomStepPanels.find((panel) => panel.dataset.storyCustomPanel === step);
      activePanel?.querySelector('select, input, textarea, button')?.focus();
    }
  }

  function moveCustomStoryStep(offset) {
    const currentIndex = Math.max(0, CUSTOM_STORY_STEPS.indexOf(state.customStoryStep));
    const nextIndex = Math.max(0, Math.min(CUSTOM_STORY_STEPS.length - 1, currentIndex + offset));
    setCustomStoryStep(CUSTOM_STORY_STEPS[nextIndex], { focus: true });
  }

  function renderStoryImportBaseOptions() {
    if (!els.storyImportBase) return;
    const previous = state.customStoryDraft.basePackId || els.storyImportBase.value;
    const packs = (Array.isArray(state.contentPacks) ? state.contentPacks : [])
      .filter((pack) => pack.custom !== true)
      .filter((pack) => pack.compatibility?.compatible !== false || Number(pack.compatibility?.blockingCount || 0) === 0);
    els.storyImportBase.innerHTML = '';
    const original = document.createElement('option');
    original.value = CUSTOM_STORY_BASE_PACK_ID;
    original.textContent = '原创空白基线（自行定义）';
    els.storyImportBase.append(original);
    packs.forEach((pack) => {
      const option = document.createElement('option');
      option.value = pack.id;
      option.textContent = pack.title || pack.id;
      els.storyImportBase.append(option);
    });
    const preferred = previous || CUSTOM_STORY_BASE_PACK_ID;
    const available = preferred === CUSTOM_STORY_BASE_PACK_ID || packs.some((pack) => pack.id === preferred);
    els.storyImportBase.value = available ? preferred : (packs[0]?.id || CUSTOM_STORY_BASE_PACK_ID);
    state.customStoryDraft.basePackId = els.storyImportBase.value;
    if (els.storyImportTrigger) els.storyImportTrigger.disabled = false;
    persistCustomStoryDraft();
  }

  function persistCustomStoryDraft() {
    storage?.setItem(CUSTOM_STORY_DRAFT_KEY, JSON.stringify(state.customStoryDraft));
  }

  function getCustomStorySuggestedTitle() {
    const basePack = (state.contentPacks || []).find((pack) => pack.id === state.customStoryDraft.basePackId);
    const character = (state.resourceLibrary || []).find((item) => item.id === state.customStoryDraft.characterResourceId);
    if (character) return `${character.title || character.payload?.name || '新角色'} · 新卷`;
    if (state.customStoryDraft.basePackId === CUSTOM_STORY_BASE_PACK_ID) {
      const worldName = state.customStoryDraft.customBaseline?.worldName?.trim();
      return worldName ? `${worldName} · 第一卷` : '原创世界 · 第一卷';
    }
    return basePack ? `${basePack.title || basePack.id} · 自定义卷` : '自定义故事';
  }

  function applyCustomBaselineTemplate(templateId) {
    const template = CUSTOM_BASELINE_TEMPLATES[templateId] || CUSTOM_BASELINE_TEMPLATES.blank;
    const current = state.customStoryDraft.customBaseline || createCustomBaselineDraft();
    state.customStoryDraft.customBaseline = createCustomBaselineDraft({
      ...template,
      templateId: CUSTOM_BASELINE_TEMPLATES[templateId] ? templateId : 'blank',
      worldName: current.worldName
    });
    if (!state.customStoryDraft.titleCustomized) {
      state.customStoryDraft.title = getCustomStorySuggestedTitle();
    }
    invalidateCustomStoryInspection();
    persistCustomStoryDraft();
    renderCustomStoryBuilder();
  }

  function renderCustomBaselineEditor() {
    if (!els.storyCustomBaselineFields) return;
    const isOriginal = state.customStoryDraft.basePackId === CUSTOM_STORY_BASE_PACK_ID;
    els.storyCustomBaselineFields.hidden = !isOriginal;
    if (!isOriginal) return;

    if (els.storyCustomBaselineTemplate && !els.storyCustomBaselineTemplate.options.length) {
      Object.entries(CUSTOM_BASELINE_TEMPLATES).forEach(([id, template]) => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = template.label;
        els.storyCustomBaselineTemplate.append(option);
      });
    }
    if (els.storyCustomVisualPack) {
      const visualOptions = new Map();
      (state.contentPacks || []).filter((pack) => pack.custom !== true).forEach((pack) => {
        visualOptions.set(getStoryPackVisualId(pack), pack.title || getStoryPackVisualId(pack));
      });
      Object.values(CUSTOM_BASELINE_TEMPLATES).forEach((template) => {
        if (!visualOptions.has(template.visualPackId)) visualOptions.set(template.visualPackId, template.label);
      });
      els.storyCustomVisualPack.innerHTML = '';
      visualOptions.forEach((label, id) => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = label;
        els.storyCustomVisualPack.append(option);
      });
    }

    const baseline = state.customStoryDraft.customBaseline;
    if (els.storyCustomBaselineTemplate) els.storyCustomBaselineTemplate.value = baseline.templateId;
    if (els.storyCustomWorldName) els.storyCustomWorldName.value = baseline.worldName;
    if (els.storyCustomGenre) els.storyCustomGenre.value = baseline.genre;
    if (els.storyCustomVisualPack) els.storyCustomVisualPack.value = baseline.visualPackId;
    if (els.storyCustomPremise) els.storyCustomPremise.value = baseline.premise;
    if (els.storyCustomProseStyle) els.storyCustomProseStyle.value = baseline.proseStyle;
    if (els.storyCustomHardRules) els.storyCustomHardRules.value = baseline.hardRules;
  }

  function getCompanionWorldBooks(character, resources = state.resourceLibrary) {
    if (!character || character.kind !== 'character') return [];
    const batchKey = getResourceImportBatchKey(character);
    if (!batchKey) return [];
    return (Array.isArray(resources) ? resources : [])
      .filter((item) => item.kind === 'worldbook' && getResourceImportBatchKey(item) === batchKey);
  }

  function appendResourceMatchPresentation(copy, title, meta, match) {
    const heading = document.createElement('span');
    heading.className = 'story-custom-resource-heading';
    heading.append(title);
    if (match?.score !== null && match?.score !== undefined) {
      const badge = document.createElement('em');
      badge.className = `story-custom-match-badge is-${match.level || 'unrated'}`;
      badge.textContent = `${match.label} · ${match.score}%`;
      badge.title = match.reasons?.join('；') || match.label;
      heading.append(badge);
    }
    if (match?.recommended) {
      const recommendation = document.createElement('em');
      recommendation.className = 'story-custom-match-badge is-recommended';
      recommendation.textContent = match.recommendationLabel || '推荐';
      recommendation.title = '无角色原生预设时优先推荐；不会覆盖原生匹配资源';
      heading.append(recommendation);
    }
    copy.append(heading, meta);
    if (match?.reasons?.length) {
      const reason = document.createElement('small');
      reason.className = 'story-custom-match-reason';
      reason.textContent = match.reasons.join('；');
      copy.append(reason);
    }
  }

  function invalidateCustomStoryInspection() {
    timerApi.clearTimeout(customStoryInspectionTimer);
    customStoryInspectionRequest += 1;
    state.customStoryComposition = { key: '', status: 'idle', report: null, error: '' };
    if (state.customStoryDraft) {
      state.customStoryDraft.compatibilityReview = createCustomStoryCompatibilityReview();
    }
  }

  function buildCustomPackRequest({ title = '', includeCompatibilityReview = true } = {}) {
    const draft = state.customStoryDraft;
    const isOriginal = draft.basePackId === CUSTOM_STORY_BASE_PACK_ID;
    const resolvedTitle = String(title || draft.title || getCustomStorySuggestedTitle()).trim();
    const baseline = createCustomBaselineDraft(draft.customBaseline);
    const hasImportedStack = Boolean(
      draft.characterResourceId
      || draft.worldBookResourceIds.length
      || draft.promptResourceIds.length
    );
    const baseInheritanceMode = draft.creationMode === STORY_IMPORT_MODES.INDEPENDENT
      ? 'none'
      : !isOriginal && hasImportedStack
        ? 'genre'
        : 'full';
    const request = {
      title: resolvedTitle,
      sessionTitle: resolvedTitle,
      description: isOriginal
        ? `原创世界《${baseline.worldName || resolvedTitle}》，由本地素材组装生成。`
        : hasImportedStack
          ? '由本地素材创建，仅继承所选内容包的通用题材规则与视觉，不继承固定剧情。'
          : '由所选内容包完整派生，继承规则、主题与叙事基线。',
      basePackId: isOriginal ? '' : draft.basePackId,
      characterResourceId: draft.characterResourceId,
      useCharacterPortraitAsBackground: draft.useCharacterPortraitAsBackground,
      worldBookResourceIds: [...draft.worldBookResourceIds],
      promptResourceIds: [...draft.promptResourceIds],
      includeBaseContent: draft.creationMode !== STORY_IMPORT_MODES.INDEPENDENT,
      baseInheritanceMode,
      worldBookMergeMode: draft.worldBookMergeMode,
      creationMode: draft.creationMode,
      roleplayMode: 'dm',
      visualPackId: isOriginal ? baseline.visualPackId : '',
      customBaseline: isOriginal ? baseline : null
    };
    if (includeCompatibilityReview) {
      const savedReview = createCustomStoryCompatibilityReview(draft.compatibilityReview);
      const inspectedReview = state.customStoryComposition?.status === 'ready'
        ? state.customStoryComposition.report?.compatibilityReview
        : null;
      request.compatibilityReview = inspectedReview?.fingerprint
        ? createCustomStoryCompatibilityReview({
            fingerprint: inspectedReview.fingerprint,
            // 审批不可由前端根据预检结果自动补全；只提交用户对当前
            // scriptId + contentHash 明确留下的结论，后端会再次校验。
            scriptReviews: savedReview.fingerprint === inspectedReview.fingerprint
              ? savedReview.scriptReviews
              : [],
            executionMode: savedReview.executionMode,
            acknowledgeCompatibility: savedReview.fingerprint === inspectedReview.fingerprint
              && savedReview.acknowledgeCompatibility,
            acknowledgeDeveloperRisk: savedReview.fingerprint === inspectedReview.fingerprint
              && savedReview.acknowledgeDeveloperRisk
          })
        : savedReview;
    }
    return request;
  }

  function renderCustomStoryBuilder() {
    if (!els.storyCustomCharacter || !els.storyCustomWorldbookList) return;
    const resources = Array.isArray(state.resourceLibrary) ? state.resourceLibrary : [];
    const characters = resources.filter((item) => item.kind === 'character');
    const worldBooks = resources.filter((item) => item.kind === 'worldbook');
    const prompts = resources.filter(isPromptLibraryResource);
    const promptGroups = groupPromptResources(prompts);
    const basePack = (state.contentPacks || []).find((pack) => pack.id === state.customStoryDraft.basePackId);
    const isOriginal = state.customStoryDraft.basePackId === CUSTOM_STORY_BASE_PACK_ID;
    if (els.storyCustomLibrarySummary) {
      els.storyCustomLibrarySummary.innerHTML = '';
      if (resources.length) {
        const label = document.createElement('span');
        label.textContent = '素材库可选';
        els.storyCustomLibrarySummary.append(label);
        [
          ['character', `${characters.length} 张角色卡`],
          ['worldbook', `${worldBooks.length} 本世界书`],
          ['prompt', `${promptGroups.length} 份预设`]
        ].forEach(([step, text]) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.storyLibraryStep = step;
          button.textContent = text;
          els.storyCustomLibrarySummary.append(button);
        });
      } else {
        els.storyCustomLibrarySummary.textContent = '素材库暂无可用素材，可先创建基础剧本，或使用右侧入口补充导入。';
      }
    }

    const selectedCharacterId = characters.some((item) => item.id === state.customStoryDraft.characterResourceId)
      ? state.customStoryDraft.characterResourceId
      : '';
    state.customStoryDraft.characterResourceId = selectedCharacterId;
    els.storyCustomCharacter.innerHTML = '';
    const inherited = document.createElement('option');
    inherited.value = '';
    inherited.textContent = isOriginal
      ? '进入开局时创建主角'
      : basePack?.characterName
      ? `沿用基线角色 · ${basePack.characterName}`
      : '沿用题材基线角色';
    els.storyCustomCharacter.append(inherited);
    characters.forEach((resource) => {
      const option = document.createElement('option');
      option.value = resource.id;
      const score = Number(resource.diagnostics?.score || 0);
      option.textContent = `${resource.title || resource.payload?.name || '未命名角色'}${score ? ` · ${score}分` : ''}`;
      els.storyCustomCharacter.append(option);
    });
    els.storyCustomCharacter.value = selectedCharacterId;
    const selectedCharacter = characters.find((item) => item.id === selectedCharacterId);
    renderCustomStoryCharacterBackground(selectedCharacter);

    const availableWorldBookIds = new Set(worldBooks.map((item) => item.id));
    state.customStoryDraft.worldBookResourceIds = state.customStoryDraft.worldBookResourceIds
      .filter((id) => availableWorldBookIds.has(id));
    els.storyCustomWorldbookList.innerHTML = '';
    if (!worldBooks.length) {
      const empty = document.createElement('div');
      empty.className = 'story-custom-resource-empty';
      const message = document.createElement('p');
      message.textContent = isOriginal
        ? '素材库中暂无世界书，可先用原创总纲创建，之后继续补充。'
        : '素材库中暂无世界书，将完整沿用题材基线。';
      const importButton = document.createElement('button');
      importButton.type = 'button';
      importButton.dataset.storyImportKind = 'worldbook';
      importButton.textContent = '导入世界书';
      empty.append(message, importButton);
      els.storyCustomWorldbookList.append(empty);
    } else {
      const selected = new Set(state.customStoryDraft.worldBookResourceIds);
      const companionIds = new Set(getCompanionWorldBooks(selectedCharacter, resources).map((item) => item.id));
      worldBooks
        .map((resource) => ({
          resource,
          title: resource.title || '未命名世界书',
          match: evaluateResourceMatch(selectedCharacter, resource, { kind: 'worldbook' })
        }))
        .sort(compareMatchedResources)
        .forEach(({ resource, match }) => {
          const label = document.createElement('label');
          label.className = 'story-custom-resource-option';
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.value = resource.id;
          input.checked = selected.has(resource.id);
          const copy = document.createElement('span');
          const title = document.createElement('strong');
          title.textContent = resource.title || '未命名世界书';
          const meta = document.createElement('small');
          const companion = companionIds.has(resource.id);
          meta.textContent = formatWorldBookResourceMeta(resource, { companion, formatTokenCount });
          appendResourceMatchPresentation(copy, title, meta, match);
          label.append(input, copy);
          els.storyCustomWorldbookList.append(label);
        });
    }
    tagMappingController.renderInto(els.storyCustomWorldbookList, { resources: worldBooks, selectedIds: state.customStoryDraft.worldBookResourceIds });
    const availablePromptIds = new Set(prompts.map((item) => item.id));
    state.customStoryDraft.promptResourceIds = state.customStoryDraft.promptResourceIds
      .filter((id) => availablePromptIds.has(id));
    if (els.storyCustomPromptList) {
      els.storyCustomPromptList.innerHTML = '';
      if (!promptGroups.length) {
        const empty = document.createElement('div');
        empty.className = 'story-custom-resource-empty';
        const message = document.createElement('p');
        message.textContent = isOriginal
          ? '素材库中暂无 Prompt，可先使用原创叙事风格与硬规则。'
          : '素材库中暂无补充预设，将沿用题材基线的叙事规则。';
        const importButton = document.createElement('button');
        importButton.type = 'button';
        importButton.dataset.storyImportKind = 'prompt';
        importButton.textContent = '导入预设';
        empty.append(message, importButton);
        els.storyCustomPromptList.append(empty);
      } else {
        const selectedPrompts = new Set(state.customStoryDraft.promptResourceIds);
        promptGroups
          .map((group) => ({
            group,
            title: group.title,
            match: evaluatePromptGroupMatch(selectedCharacter, group)
          }))
          .sort(compareMatchedResources)
          .forEach(({ group, match }) => {
            const label = document.createElement('label');
            label.className = 'story-custom-resource-option';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.value = group.key;
            input.dataset.resourceIds = JSON.stringify(group.resourceIds);
            const selectedCount = group.resourceIds.filter((id) => selectedPrompts.has(id)).length;
            input.checked = selectedCount === group.resourceIds.length;
            input.indeterminate = selectedCount > 0 && selectedCount < group.resourceIds.length;
            const copy = document.createElement('span');
            const title = document.createElement('strong');
            title.textContent = group.title;
            const meta = document.createElement('small');
            meta.textContent = [
              group.isPresetBundle ? `${group.moduleCount} 个模块 · 已启用 ${group.enabledCount}` : '单模块',
              group.regexRuleCount ? `${group.regexRuleCount} 条 Regex 配套规则` : '',
              group.score ? `${group.score}分` : '',
              group.estimatedTokens ? `${formatTokenCount(group.estimatedTokens)} tokens` : '',
              group.sourceLabel
            ]
              .filter(Boolean)
              .join(' · ');
            appendResourceMatchPresentation(copy, title, meta, match);
            label.append(input, copy);
            els.storyCustomPromptList.append(label);
          });
      }
    }

    if (els.storyCustomWorldbookMode) els.storyCustomWorldbookMode.value = state.customStoryDraft.worldBookMergeMode;
    renderCustomBaselineEditor();
    if (!state.customStoryDraft.title) {
      state.customStoryDraft.title = getCustomStorySuggestedTitle();
    }
    if (els.storyCustomTitle) els.storyCustomTitle.value = state.customStoryDraft.title;
    persistCustomStoryDraft();
    renderCustomStoryReadiness();
    setCustomStoryStep(state.customStoryStep);
  }

  function renderCustomStoryCharacterBackground(character) {
    if (!els.storyCustomCharacterBackgroundOption || !els.storyCustomCharacterBackground) return;
    const portraitUrl = getCharacterPortraitUrl(character?.payload);
    const available = Boolean(portraitUrl);
    els.storyCustomCharacterBackgroundOption.hidden = !available;
    els.storyCustomCharacterBackground.disabled = !available;
    els.storyCustomCharacterBackground.checked = available && state.customStoryDraft.useCharacterPortraitAsBackground;
    if (els.storyCustomCharacterBackgroundPreview) {
      if (available) {
        els.storyCustomCharacterBackgroundPreview.src = portraitUrl;
        els.storyCustomCharacterBackgroundPreview.alt = `${character?.title || character?.payload?.name || '角色'}立绘预览`;
      } else {
        els.storyCustomCharacterBackgroundPreview.removeAttribute('src');
      }
    }
  }

  function getCustomStoryReadiness() {
    const draft = state.customStoryDraft;
    const isOriginal = draft.basePackId === CUSTOM_STORY_BASE_PACK_ID;
    const basePack = (state.contentPacks || []).find((pack) => pack.id === draft.basePackId);
    const resources = Array.isArray(state.resourceLibrary) ? state.resourceLibrary : [];
    const character = resources.find((item) => item.id === draft.characterResourceId && item.kind === 'character');
    const worldBooks = resources.filter((item) => draft.worldBookResourceIds.includes(item.id) && item.kind === 'worldbook');
    const prompts = resources.filter((item) => draft.promptResourceIds.includes(item.id) && isPromptLibraryResource(item));
    const selectedPromptGroups = groupPromptResources(prompts);
    const promptSelectionNeedsConfirmation = selectedPromptGroups.length > 0 && draft.promptSelectionConfirmed !== true;
    const selectedResources = [character, ...worldBooks, ...prompts].filter(Boolean);
    const blockingIssues = selectedResources.flatMap((item) => item.diagnostics?.blockingIssues || []);
    const missingFields = character?.diagnostics?.missingFields || [];
    const warningCount = selectedResources.reduce((sum, item) => sum + Number(item.diagnostics?.warnings?.length || 0), 0);
    const characterEstimatedTokens = Number(character?.diagnostics?.estimatedTokens || 0);
    const worldBookRuntimeBudget = summarizeWorldBookRuntimeBudget(worldBooks);
    const worldBookEstimatedTokens = worldBookRuntimeBudget.estimatedTokens;
    const worldBookStoredTokens = worldBookRuntimeBudget.storedTokens;
    const promptEstimatedTokens = selectedPromptGroups.reduce((sum, group) => (
        sum + Number(group.estimatedTokens ?? group.diagnostics?.estimatedTokens ?? 0)
      ), 0);
    const estimatedTokens = characterEstimatedTokens + worldBookEstimatedTokens + promptEstimatedTokens;
    const baseCounts = basePack?.counts || basePack?.manifest?.counts || {};
    const baseWorldBookCount = Number(baseCounts.worldBook || basePack?.worldBook?.length || 0);
    const basePromptCount = Number(baseCounts.promptModules || basePack?.promptModules?.length || 0);
    const addedWorldBookEntries = worldBooks.reduce((sum, item) => sum + Number(item.payload?.entries?.length || 0), 0);
    const baseBlocked = basePack?.compatibility?.compatible === false && Number(basePack.compatibility?.blockingCount || 0) > 0;
    const baseline = createCustomBaselineDraft(draft.customBaseline);
    const originalWorldBookCount = [baseline.premise, baseline.hardRules].filter((item) => item.trim()).length;
    const originalPromptCount = [baseline.proseStyle, baseline.hardRules].some((item) => item.trim()) ? 1 : 0;
    const originalReady = isOriginal && Boolean(baseline.premise.trim() || addedWorldBookEntries > 0);
    const baselineReady = Boolean(basePack) || originalReady;
    const compositionSummary = state.customStoryComposition.report?.summary || {};
    const conflictCount = Number(compositionSummary.sameTitleConflicts || 0)
      + Number(compositionSummary.constantConflicts || 0)
      + Number(compositionSummary.triggerOverlaps || 0)
      + Number(compositionSummary.promptIdConflicts || 0);
    const fallbackRuntimeCompatibility = selectedResources.reduce((summary, item) => {
      const counts = item.diagnostics?.communityCompatibility?.counts || {};
      summary.missing += Number(counts.missing || 0);
      summary.review += Number(counts.review || 0);
      summary.degraded += Number(counts.degraded || 0);
      return summary;
    }, { missing: 0, review: 0, degraded: 0 });
    const inspectedRuntimeCounts = state.customStoryComposition.report?.communityCompatibility?.counts;
    const runtimeCompatibility = inspectedRuntimeCounts
      ? {
          missing: Number(inspectedRuntimeCounts.missing || 0),
          review: Number(inspectedRuntimeCounts.review || 0),
          degraded: Number(inspectedRuntimeCounts.degraded || 0)
        }
      : fallbackRuntimeCompatibility;
    const composition = state.customStoryComposition || { status: 'idle', report: null, error: '' };
    const compatibilityReview = composition.status === 'ready'
      ? composition.report?.compatibilityReview || null
      : null;
    const interactionReview = getCustomStoryInteractionReview(compatibilityReview);
    const interactionConflicts = Array.isArray(interactionReview.conflicts)
      ? interactionReview.conflicts
      : [];
    const savedCompatibilityReview = createCustomStoryCompatibilityReview(draft.compatibilityReview);
    const reviewFingerprintMatches = Boolean(
      compatibilityReview?.fingerprint
      && savedCompatibilityReview.fingerprint === compatibilityReview.fingerprint
    );
    const compatibilityRules = Array.isArray(compatibilityReview?.rules)
      ? compatibilityReview.rules
      : [];
    const reviewedRules = reviewFingerprintMatches
      ? new Map(savedCompatibilityReview.scriptReviews.map((item) => [
        `${item.scriptId}:${item.contentHash}`,
        item
      ]))
      : new Map();
    const scriptExecutionMode = normalizeScriptExecutionMode(savedCompatibilityReview.executionMode);
    const pendingScriptRules = compatibilityReview?.requiresScriptApproval && scriptExecutionMode === 'review-required'
      ? compatibilityRules.filter((rule) => !reviewedRules.has(
        `${String(rule.scriptId || '')}:${String(rule.contentHash || '')}`
      ))
      : [];
    const compatibilityAcknowledgementPending = Boolean(
      compatibilityReview?.requiresCompatibilityAcknowledgement
      && !(reviewFingerprintMatches && savedCompatibilityReview.acknowledgeCompatibility)
    );
    const inspectionReady = composition.status === 'ready' && Boolean(composition.report);
    const sourceRuntimeBlocked = Boolean(
      inspectionReady
      && (compatibilityReview?.sourceRuntimeBlocked || runtimeCompatibility.missing > 0)
    );
    const selectedMatches = character
      ? [
          ...worldBooks.map((resource) => evaluateResourceMatch(character, resource, { kind: 'worldbook' })),
          ...selectedPromptGroups.map((group) => (
            Array.isArray(group?.resources)
              ? evaluatePromptGroupMatch(character, group)
              : evaluateResourceMatch(character, group, { kind: 'prompt' })
          ))
        ]
      : [];
    const resourceMatching = {
      total: selectedMatches.length,
      native: selectedMatches.filter((match) => match.level === 'native').length,
      high: selectedMatches.filter((match) => match.level === 'high').length,
      medium: selectedMatches.filter((match) => match.level === 'medium').length,
      general: selectedMatches.filter((match) => match.level === 'general').length,
      low: selectedMatches.filter((match) => match.level === 'low').length,
      average: selectedMatches.length
        ? Math.round(selectedMatches.reduce((sum, match) => sum + Number(match.score || 0), 0) / selectedMatches.length)
        : null
    };
    const canInspect = baselineReady
      && !baseBlocked
      && blockingIssues.length === 0
      && !promptSelectionNeedsConfirmation;
    const canCreate = canInspect
      && inspectionReady
      && pendingScriptRules.length === 0
      && !compatibilityAcknowledgementPending;
    const needsReview = missingFields.length > 0
      || warningCount > 0
      || estimatedTokens > 60000
      || conflictCount > 0
      || resourceMatching.low > 0
      || runtimeCompatibility.missing > 0
      || runtimeCompatibility.review > 0
      || runtimeCompatibility.degraded > 0
      || interactionConflicts.length > 0;
    const effectiveBaseWorldBookCount = isOriginal ? originalWorldBookCount : baseWorldBookCount;
    const effectiveBasePromptCount = isOriginal ? originalPromptCount : basePromptCount;
    const baseInheritanceMode = buildCustomPackRequest({ includeCompatibilityReview: false }).baseInheritanceMode;
    const inspectedWorldBookCount = state.customStoryComposition.status === 'ready'
      && Number.isFinite(Number(compositionSummary.finalEntries))
      ? Number(compositionSummary.finalEntries)
      : null;
    const worldBookValue = inspectedWorldBookCount !== null
      ? `${baseInheritanceMode === 'genre' ? '题材框架继承' : '合并完成'} · 最终 ${inspectedWorldBookCount} 条`
      : worldBooks.length
        ? `${baseInheritanceMode === 'genre' ? '题材级基线' : draft.worldBookMergeMode === 'resources-only' ? '仅所选素材' : `基线候选 ${effectiveBaseWorldBookCount} 条`} + 补充 ${addedWorldBookEntries} 条`
        : isOriginal
          ? `原创总纲 ${effectiveBaseWorldBookCount} 条`
          : baseInheritanceMode === 'genre'
            ? '题材级基线 · 正在预检实际条目'
            : `沿用基线 ${effectiveBaseWorldBookCount} 条`;
    const effectiveWorldBookCount = inspectedWorldBookCount
      ?? (draft.worldBookMergeMode === 'resources-only' || baseInheritanceMode === 'genre'
        ? addedWorldBookEntries
        : effectiveBaseWorldBookCount + addedWorldBookEntries);

    const checks = [
      {
        label: '题材基线',
        value: isOriginal
          ? (originalReady ? `${baseline.worldName || '原创世界'} · 总纲可用` : '原创基线至少需要世界总纲或补充世界书')
          : (basePack ? `${basePack.title || basePack.id} · 已提供世界规则` : '尚未选择'),
        tone: (isOriginal ? originalReady : Boolean(basePack && !baseBlocked)) ? 'ready' : 'blocked'
      },
      {
        label: '主角角色卡',
        value: character
          ? `${character.title || character.payload?.name || '自定义角色'}${missingFields.length ? ` · 缺 ${missingFields.length} 项` : ' · 字段可用'}`
          : (isOriginal ? '开局时创建主角' : `沿用基线角色${basePack?.characterName ? ` · ${basePack.characterName}` : ''}`),
        tone: character && missingFields.length ? 'review' : 'ready'
      },
      {
        label: '舞台背景',
        value: character && getCharacterPortraitUrl(character.payload) && draft.useCharacterPortraitAsBackground
          ? `使用${character.title || character.payload?.name || '角色'}立绘`
          : `跟随${isOriginal ? '所选舞台氛围' : '题材基线'}`,
        tone: 'ready'
      },
      {
        label: '世界设定',
        value: worldBookValue,
        tone: effectiveWorldBookCount > 0 || baseInheritanceMode === 'genre' ? 'ready' : 'review'
      },
      {
        label: '叙事规则',
        value: promptSelectionNeedsConfirmation
          ? `${selectedPromptGroups.length} 个草稿预设待重新确认`
          : isOriginal
            ? `${effectiveBasePromptCount ? '原创规则' : '尚未填写原创规则'}${selectedPromptGroups.length ? ` + ${selectedPromptGroups.length} 个预设` : ''}`
            : `继承基线 ${effectiveBasePromptCount} 个规则模块${selectedPromptGroups.length ? ` + 补充 ${selectedPromptGroups.length} 个` : ''}`,
        tone: promptSelectionNeedsConfirmation
          ? 'blocked'
          : effectiveBasePromptCount + selectedPromptGroups.length > 0
            ? 'ready'
            : 'review'
      },
      {
        label: '互动控制权',
        value: interactionConflicts.length
          ? `${interactionReview.roleplayModeLabel || '标准 DM 叙事流'} · ${interactionConflicts.length} 项预设冲突`
          : interactionReview.semantics?.requestsMoreDialogue
            ? `${interactionReview.roleplayModeLabel || '标准 DM 叙事流'} · 对话增多已保留`
            : `${interactionReview.roleplayModeLabel || '标准 DM 叙事流'} · 未发现抢话冲突`,
        tone: interactionConflicts.length ? 'review' : 'ready'
      },
      {
        label: '素材匹配',
        value: !character
          ? '选择角色卡后评定世界书与预设'
          : resourceMatching.total
            ? [
                resourceMatching.native ? `原生 ${resourceMatching.native}` : '',
                resourceMatching.high ? `高匹配 ${resourceMatching.high}` : '',
                resourceMatching.medium ? `中匹配 ${resourceMatching.medium}` : '',
                resourceMatching.general ? `通用 ${resourceMatching.general}` : '',
                resourceMatching.low ? `低匹配 ${resourceMatching.low}` : '',
                `平均 ${resourceMatching.average}%`
              ].filter(Boolean).join(' · ')
            : '尚未选择补充世界书或预设',
        tone: resourceMatching.low > 0 ? 'review' : 'ready'
      },
      {
        label: '扩展依赖',
        value: !canInspect
          ? '完成前置条件后执行兼容预检'
          : !inspectionReady
            ? composition.status === 'error'
              ? '兼容预检失败，请重试'
              : '正在执行组装前兼容预检'
            : compatibilityAcknowledgementPending
                ? sourceRuntimeBlocked
                  ? `${runtimeCompatibility.missing} 项源运行时能力将被禁用，需确认安全派生版`
                  : '存在安全降级能力，需确认后继续'
                : sourceRuntimeBlocked
                  ? `安全派生已确认 · 禁用 ${runtimeCompatibility.missing} 项源运行时能力`
                  : runtimeCompatibility.degraded
                    ? '兼容降级已确认，未知能力保持禁用'
                    : runtimeCompatibility.review
                      ? scriptExecutionMode === 'review-required'
                        ? `${compatibilityRules.length} 个脚本等待逐项确认`
                        : scriptExecutionMode === 'compatibility-probe'
                          ? `${compatibilityRules.length} 个脚本将以开发兼容探针运行并记录`
                          : `${compatibilityRules.length} 个脚本将以本地观察模式运行并记录`
                      : '所选素材均可原生装配',
        tone: pendingScriptRules.length || compatibilityAcknowledgementPending || composition.status === 'error'
          ? 'blocked'
          : inspectionReady
            ? (sourceRuntimeBlocked || runtimeCompatibility.degraded ? 'review' : 'ready')
            : 'review'
      }
    ];

    let guidance = '条件齐备，可以直接创建；之后仍可在创作模式继续补充设定。';
    if (isOriginal && !originalReady) guidance = '原创剧本至少需要一段世界总纲，或选择一本世界书作为设定基础。';
    else if (!isOriginal && !basePack) guidance = '请先选择一个题材基线，系统需要它提供运行规则与视觉主题。';
    else if (baseBlocked || blockingIssues.length) guidance = `存在 ${Number(basePack?.compatibility?.blockingCount || 0) + blockingIssues.length} 个阻断项，请先修复后再创建。`;
    else if (promptSelectionNeedsConfirmation) guidance = `检测到草稿保留的 ${selectedPromptGroups.length} 个 Prompt / 预设。请在第 4 步重新勾选确认，避免把上一角色的规则带入当前剧本。`;
    else if (!inspectionReady && composition.status === 'error') guidance = `组装前兼容预检失败：${composition.error || '未知错误'}。请重试后再创建。`;
    else if (!inspectionReady) guidance = '正在执行组装前兼容预检；预检完成后即可创建，严格模式下还需完成逐项确认。';
    else if (compatibilityAcknowledgementPending && sourceRuntimeBlocked) guidance = `原资源依赖 ${runtimeCompatibility.missing} 项当前无法直接运行的扩展能力。可确认创建安全派生版：保留角色、世界书和 Prompt，明确禁用这些能力；若它本身是完整网页，请改走重前端导入。`;
    else if (compatibilityAcknowledgementPending) guidance = '检测到需要安全降级的扩展能力。请确认接受兼容处理后再创建剧本。';
    else if (sourceRuntimeBlocked) guidance = `将创建安全派生版，并记录被禁用的 ${runtimeCompatibility.missing} 项源运行时能力；原社区资源保持只读。`;
    else if (interactionConflicts.length) guidance = `${interactionConflicts[0].message} 创建后仍可在工作台切换为导演 / 共创流；每轮运行时会按实时模式重新裁决。`;
    else if (missingFields.length) guidance = `角色卡可创建，但缺少：${missingFields.map((item) => item.label || item.field).join('、')}。这些字段将暂由模型与基线补足。`;
    else if (resourceMatching.low) guidance = `已选择 ${resourceMatching.low} 项与当前角色低匹配的世界书或预设。仍可创建，但建议确认题材冲突是否出于你的主动设计。`;
    else if (runtimeCompatibility.review) guidance = scriptExecutionMode === 'review-required'
      ? `检测到 ${runtimeCompatibility.review} 项脚本能力。当前为严格模式，需完成内容哈希绑定的逐项确认后才会运行。`
      : scriptExecutionMode === 'compatibility-probe'
        ? `检测到 ${runtimeCompatibility.review} 项脚本能力。它们会在隔离 iframe 的开发兼容探针中运行并记录；外部资源与网络仅供本地调试，完成后应切回本地探索或严格审批。`
        : `检测到 ${runtimeCompatibility.review} 项脚本能力。它们会在本地隔离沙箱中观察运行并记录；你可随时切换为严格逐项确认。`;
    else if (conflictCount) guidance = `检测到 ${conflictCount} 组潜在设定重叠。当前合并策略可以继续创建，也可先查看下方冲突摘要。`;
    else if (baseInheritanceMode === 'genre' && inspectedWorldBookCount === 0 && !worldBooks.length) guidance = '当前只继承题材规则，不继承基线固定剧情；如需具体世界设定，请在第 3 步选择世界书。';
    else if (worldBookStoredTokens > worldBookEstimatedTokens && worldBookEstimatedTokens > 0) guidance = `世界书原文共约 ${formatTokenCount(worldBookStoredTokens)} tokens，继续完整保存在本地；运行时按常驻、关键词与递归触发动态检索，每轮世界书最多注入 ${formatTokenCount(worldBookEstimatedTokens)} tokens。`;
    else if (estimatedTokens > 60000) guidance = `当前每轮上下文上限约 ${formatTokenCount(estimatedTokens)} tokens；建议减少同时启用的预设模块，或提高 Provider 上下文预算。`;
    else if (warningCount) guidance = `素材可直接创建，评定器还有 ${warningCount} 条改进建议，可在资源库中稍后处理。`;
    else if (!character && !worldBooks.length && !isOriginal) guidance = '当前未添加自定义素材，将以所选题材基线创建一个可继续扩写的新剧本。';

    return {
      isOriginal,
      basePack,
      baseline,
      character,
      worldBooks,
      prompts: selectedPromptGroups,
      promptResources: prompts,
      promptSelectionNeedsConfirmation,
      checks,
      canInspect,
      canCreate,
      needsReview,
      inspectionReady,
      compatibilityReview,
      interactionReview,
      interactionConflicts,
      scriptExecutionMode,
      pendingScriptRules,
      sourceRuntimeBlocked,
      compatibilityAcknowledgementPending,
      estimatedTokens,
      worldBookEstimatedTokens,
      worldBookStoredTokens,
      resourceMatching,
      runtimeCompatibility,
      baseInheritanceMode,
      effectiveWorldBookCount,
      guidance
    };
  }

  function renderCustomStoryReadiness() {
    if (!els.storyCustomChecklist || !els.storyCustomCreate) return;
    const readiness = getCustomStoryReadiness();
    els.storyCustomChecklist.innerHTML = '';
    readiness.checks.forEach((check) => {
      const item = document.createElement('li');
      item.className = `is-${check.tone}`;
      const marker = document.createElement('span');
      marker.className = 'story-check-marker';
      marker.setAttribute('aria-hidden', 'true');
      const copy = document.createElement('span');
      const label = document.createElement('strong');
      label.textContent = check.label;
      const value = document.createElement('small');
      value.textContent = check.value;
      copy.append(label, value);
      item.append(marker, copy);
      els.storyCustomChecklist.append(item);
    });
    const inspecting = readiness.canInspect
      && !readiness.inspectionReady
      && state.customStoryComposition?.status !== 'error';
    const tone = readiness.canCreate
      ? (readiness.needsReview ? 'review' : 'ready')
      : inspecting
        ? 'review'
        : 'blocked';
    els.storyCustomReadinessBadge.className = `story-readiness-badge is-${tone}`;
    els.storyCustomReadinessBadge.textContent = readiness.canCreate
      ? (readiness.needsReview ? '可创建 · 建议审阅' : '可以直接创建')
      : inspecting
        ? '正在组装预检'
        : readiness.compatibilityAcknowledgementPending
          ? '待兼容确认'
          : '暂不可创建';
    els.storyCustomTokenEstimate.textContent = readiness.estimatedTokens
      ? `每轮上限 ${formatTokenCount(readiness.estimatedTokens)} tokens`
      : (readiness.isOriginal ? '原创轻量基线' : '使用基线体量');
    els.storyCustomGuidance.textContent = readiness.guidance;
    els.storyCustomCreate.disabled = !readiness.canCreate;
    renderCustomStoryConflicts(readiness);
    approvalController.render(readiness, state.customStoryComposition);
    if (state.customStoryStep === 'review') renderCustomStoryStackPreview(readiness);
    scheduleCustomStoryInspection(readiness);
  }

  function renderCustomStoryStackPreview(readiness = getCustomStoryReadiness()) {
    if (!els.storyCustomStackPreview) return;
    const baseLabel = readiness.isOriginal
      ? (readiness.baseline.worldName || '原创世界')
      : (readiness.basePack?.title || readiness.basePack?.id || '未选择');
    const characterLabel = readiness.character?.title
      || readiness.character?.payload?.name
      || (readiness.isOriginal ? '开局时创建主角' : readiness.basePack?.characterName || '沿用基线角色');
    const rows = [
      ['世界基线', baseLabel, readiness.isOriginal ? '原创规则' : '继承内容包'],
      ['主角角色卡', characterLabel, readiness.character ? '素材库角色' : '基线角色'],
      ['世界书', `${readiness.worldBooks.length} 份补充素材`, state.customStoryDraft.worldBookMergeMode === 'smart' ? '智能合并' : state.customStoryDraft.worldBookMergeMode === 'base-first' ? '基线优先' : '仅所选素材'],
      ['Prompt / 预设', `${readiness.prompts.length} 个补充预设`, readiness.promptSelectionNeedsConfirmation ? '待重新确认' : readiness.prompts.length ? '基线后注入' : '沿用基线'],
      [
        '素材匹配',
        readiness.resourceMatching.average === null
          ? '暂无可评定素材'
          : `平均 ${readiness.resourceMatching.average}%`,
        readiness.resourceMatching.low
          ? `${readiness.resourceMatching.low} 项低匹配`
          : readiness.resourceMatching.native
            ? `${readiness.resourceMatching.native} 项原生`
            : '未发现题材冲突'
      ],
      [
        '扩展运行时',
        readiness.runtimeCompatibility.missing
          ? `缺少 ${readiness.runtimeCompatibility.missing} 项`
          : readiness.runtimeCompatibility.review
            ? `${readiness.runtimeCompatibility.review} 项脚本待审核`
            : '无需额外运行时',
        readiness.runtimeCompatibility.review
          ? '审核后进入隔离沙箱'
          : readiness.runtimeCompatibility.degraded
            ? `${readiness.runtimeCompatibility.degraded} 项待转换`
            : '声明式能力原生运行'
      ],
      createWorldBookRuntimeBudgetRow(readiness, formatTokenCount)
    ];
    els.storyCustomStackPreview.innerHTML = '';
    rows.forEach(([label, value, note]) => {
      const row = document.createElement('div');
      row.className = 'story-custom-stack-row';
      const copy = document.createElement('span');
      copy.className = 'story-custom-stack-copy';
      const title = document.createElement('small');
      title.textContent = label;
      const detail = document.createElement('strong');
      detail.textContent = value;
      copy.append(title, detail);
      const badge = document.createElement('em');
      badge.className = 'story-custom-stack-note';
      badge.textContent = note;
      row.append(copy, badge);
      els.storyCustomStackPreview.append(row);
    });
  }

  function renderCustomStoryConflicts(readiness = getCustomStoryReadiness()) {
    renderCustomStoryConflictSummary({
      element: els.storyCustomConflicts,
      composition: state.customStoryComposition,
      readiness,
      documentObject: document
    });
  }

  function scheduleCustomStoryInspection(readiness = getCustomStoryReadiness()) {
    if (!readiness.canInspect) return;
    const request = buildCustomPackRequest({ includeCompatibilityReview: false });
    const key = JSON.stringify(request);
    if (state.customStoryComposition.key === key
      && ['scheduled', 'loading', 'ready', 'error'].includes(state.customStoryComposition.status)) return;
    timerApi.clearTimeout(customStoryInspectionTimer);
    const requestId = ++customStoryInspectionRequest;
    state.customStoryComposition = { key, status: 'scheduled', report: null, error: '' };
    customStoryInspectionTimer = timerApi.setTimeout(async () => {
      state.customStoryComposition = { key, status: 'loading', report: null, error: '' };
      renderCustomStoryConflicts();
      try {
        const payload = await apiRequest('/api/resource-library/packs/inspect', {
          method: 'POST',
          body: request
        });
        if (requestId !== customStoryInspectionRequest) return;
        state.customStoryComposition = { key, status: 'ready', report: payload.composition, error: '' };
      } catch (error) {
        if (requestId !== customStoryInspectionRequest) return;
        state.customStoryComposition = { key, status: 'error', report: null, error: humanizeApiError(error) };
      }
      renderCustomStoryReadiness();
    }, 180);
  }

  async function createCustomStoryFromDraft() {
    const readiness = getCustomStoryReadiness();
    if (!readiness.canCreate) {
      setStatus(els.storyCustomStatus, readiness.guidance, 'error');
      return;
    }
    const title = String(els.storyCustomTitle?.value || state.customStoryDraft.title || getCustomStorySuggestedTitle()).trim();
    state.customStoryDraft.title = title;
    persistCustomStoryDraft();
    els.storyCustomCreate.disabled = true;
    els.storyCustomCreate.textContent = '正在建立剧本...';
    setStatus(els.storyCustomStatus, `正在组装《${title}》并创建第一卷...`, 'busy');
    try {
      const request = buildCustomPackRequest({ title });
      const compatibilityUpgrade = state.customStoryCompatibilityUpgrade;
      const useCompatibilityUpgrade = Boolean(
        compatibilityUpgrade?.sourcePackId
        && compatibilityUpgrade.assemblySignature === createCompatibilityUpgradeAssemblySignature(request)
      );
      const packPayload = await apiRequest(useCompatibilityUpgrade
        ? `/api/resource-library/packs/${encodeURIComponent(compatibilityUpgrade.sourcePackId)}/compatibility-upgrade`
        : '/api/resource-library/packs', {
        method: 'POST',
        body: useCompatibilityUpgrade
          ? {
              title,
              description: request.description,
              compatibilityReview: request.compatibilityReview
            }
          : request
      });
      const result = await createAndOpenStoryProject(packPayload.pack, { title });
      state.customStoryDraft = createCustomStoryDraft({ basePackId: CUSTOM_STORY_BASE_PACK_ID });
      state.customStoryCompatibilityUpgrade = null;
      invalidateCustomStoryInspection();
      persistCustomStoryDraft();
      setStatus(els.appStatus, `已建立《${result.project.title}》，请从封面进入主角塑成。`, 'ok');
    } catch (error) {
      const reviewErrorCodes = new Set([
        'RESOURCE_PACK_REVIEW_STALE',
        'RESOURCE_PACK_REVIEW_REQUIRED',
        'RESOURCE_PACK_SCRIPT_APPROVAL_REQUIRED',
        'RESOURCE_PACK_COMPATIBILITY_ACK_REQUIRED'
      ]);
      if (reviewErrorCodes.has(String(error?.code || ''))) {
        invalidateCustomStoryInspection();
        persistCustomStoryDraft();
        setStatus(els.storyCustomStatus, '素材或兼容结果已变化，旧审批已失效；正在重新预检，请再次确认。', 'error');
      } else {
        setStatus(els.storyCustomStatus, `创建失败：${humanizeApiError(error)}`, 'error');
      }
    } finally {
      els.storyCustomCreate.textContent = '创建剧本并进入';
      renderCustomStoryReadiness();
    }
  }

  function stageStoryResourcesFromCommittedImport(payload, {
    basePackId,
    source = {},
    disposition = STORY_IMPORT_MODES.ATTACH
  } = {}) {
    if (payload.preview?.kind === 'plugin-manifest') {
      throw new Error('插件清单不能直接创建剧本，请从扩展页安装');
    }
    const resources = Array.isArray(payload.libraryResources) ? payload.libraryResources : [];
    const character = resources.find((resource) => resource.kind === 'character');
    const worldBooks = resources.filter((resource) => resource.kind === 'worldbook');
    const prompts = resources.filter(isPromptLibraryResource);
    if (!character && !worldBooks.length && !prompts.length) {
      throw new Error('导入内容中没有可用于剧本的角色卡、世界书或预设');
    }

    const independentCopy = disposition === STORY_IMPORT_MODES.INDEPENDENT;
    const resolvedBasePackId = independentCopy ? CUSTOM_STORY_BASE_PACK_ID : basePackId;
    const availableBase = resolvedBasePackId === CUSTOM_STORY_BASE_PACK_ID
      || (state.contentPacks || []).some((pack) => pack.id === basePackId && pack.custom !== true);
    if (!availableBase) throw new Error('所选题材基线已不可用，请返回书架重新选择');
    state.customStoryDraft.basePackId = resolvedBasePackId;
    state.customStoryDraft.creationMode = independentCopy ? STORY_IMPORT_MODES.INDEPENDENT : 'composed';
    if (independentCopy) {
      state.customStoryDraft.worldBookMergeMode = 'resources-only';
      state.customStoryDraft.characterResourceId = '';
      state.customStoryDraft.worldBookResourceIds = [];
      state.customStoryDraft.promptResourceIds = [];
      state.customStoryDraft.promptSelectionConfirmed = false;
      state.customStoryDraft.customBaseline = createImportedIndependentBaseline(payload.preview, {
        character,
        worldBooks,
        source,
        fallbackBasePackId: ''
      });
    }
    if (character) {
      state.customStoryDraft.characterResourceId = character.id;
      state.customStoryDraft.promptResourceIds = prompts.map((resource) => resource.id);
      state.customStoryDraft.promptSelectionConfirmed = prompts.length > 0;
    }
    state.customStoryDraft.worldBookResourceIds = Array.from(new Set([
      ...state.customStoryDraft.worldBookResourceIds,
      ...worldBooks.map((resource) => resource.id)
    ]));
    if (!character) {
      state.customStoryDraft.promptResourceIds = Array.from(new Set([
        ...state.customStoryDraft.promptResourceIds,
        ...prompts.map((resource) => resource.id)
      ]));
      if (prompts.length) state.customStoryDraft.promptSelectionConfirmed = true;
    }
    state.customStoryDraft.title = getImportedStoryTitle(payload.preview, source);
    state.customStoryDraft.titleCustomized = false;
    invalidateCustomStoryInspection();
    persistCustomStoryDraft();
    return { resourceCount: resources.length, character, worldBooks, prompts, independentCopy };
  }

  async function createStoryFromCommittedImport(payload, {
    basePackId,
    source = {},
    disposition = STORY_IMPORT_MODES.ATTACH
  } = {}) {
    if (payload.preview?.kind === 'plugin-manifest') {
      throw new Error('插件清单不能直接创建剧本，请从扩展页安装');
    }

    let pack = payload.pack || null;
    if (!pack) {
      const resources = Array.isArray(payload.libraryResources) ? payload.libraryResources : [];
      const character = resources.find((resource) => resource.kind === 'character');
      const worldBooks = resources.filter((resource) => resource.kind === 'worldbook');
      const prompts = resources.filter(isPromptLibraryResource);
      if (!character && !worldBooks.length && !prompts.length) {
        throw new Error('导入内容中没有可用于剧本的角色卡、世界书或预设');
      }

      const independentCopy = disposition === STORY_IMPORT_MODES.INDEPENDENT;
      const resolvedBasePackId = independentCopy ? CUSTOM_STORY_BASE_PACK_ID : basePackId;
      const isOriginal = resolvedBasePackId === CUSTOM_STORY_BASE_PACK_ID;
      const basePack = (state.contentPacks || []).find((item) => item.id === basePackId);
      if (!isOriginal && !basePack) throw new Error('所选题材基线已不可用，请返回书架重新选择');
      const title = getImportedStoryTitle(payload.preview, source);
      const independentBaseline = isOriginal
        ? createImportedIndependentBaseline(payload.preview, {
            character,
            worldBooks,
            source,
            fallbackBasePackId: ''
          })
        : null;
      const packPayload = await apiRequest('/api/resource-library/packs', {
        method: 'POST',
        body: {
          title,
          sessionTitle: title,
          description: isOriginal
            ? '由导入素材创建的原创剧本。'
            : `由本地素材创建，继承《${basePack.title || basePack.id}》的规则基线。`,
          basePackId: isOriginal ? '' : resolvedBasePackId,
          characterResourceId: character?.id || '',
          worldBookResourceIds: worldBooks.map((resource) => resource.id),
          promptResourceIds: prompts.map((resource) => resource.id),
          includeBaseContent: !independentCopy,
          worldBookMergeMode: independentCopy ? 'resources-only' : state.customStoryDraft.worldBookMergeMode,
          creationMode: independentCopy ? STORY_IMPORT_MODES.INDEPENDENT : 'composed',
          visualPackId: independentBaseline?.visualPackId || '',
          customBaseline: independentBaseline
        }
      });
      pack = packPayload.pack;
    }

    const result = await createAndOpenStoryProject(pack);
    return { pack, project: result.project, session: result.session };
  }

  function createImportedIndependentBaseline(preview = {}, {
    character,
    worldBooks = [],
    source = {},
    fallbackBasePackId = ''
  } = {}) {
    const summary = preview.summary || {};
    const card = character?.payload || {};
    const title = getImportedStoryTitle(preview, source).replace(/(?:的故事| · 新卷)$/u, '');
    const genre = String(summary.declaredGenre || (Array.isArray(summary.tags) ? summary.tags.join(' · ') : '') || '自定义角色世界').trim();
    const worldBookTitles = worldBooks.map((item) => item.title).filter(Boolean).slice(0, 6);
    const premise = String(
      card.scenario
      || card.description
      || (worldBookTitles.length ? `世界边界由《${worldBookTitles.join('》《')}》共同定义。` : '')
      || `围绕${summary.characterName || title || '导入角色'}展开的独立故事世界。`
    ).trim().slice(0, 5000);
    return createCustomBaselineDraft({
      templateId: 'blank',
      worldName: title || summary.characterName || '导入世界',
      genre,
      premise,
      proseStyle: '优先遵循导入角色卡的语言风格、示例对话与场景约束；未声明部分保持克制，不擅自借用其他剧本设定。',
      hardRules: '以本次导入的角色卡、附带世界书和所选补充素材为最高设定边界；不得混入原剧本的人物、力量体系、地点或历史。',
      visualPackId: inferImportedVisualPack(summary, fallbackBasePackId)
    });
  }

  function inferImportedVisualPack(_summary = {}, fallbackBasePackId = '') {
    return fallbackBasePackId
      ? getStoryPackVisualId(fallbackBasePackId)
      : 'neutral';
  }

  function getImportedStoryTitle(preview = {}, source = {}) {
    const summary = preview.summary || {};
    const fileTitle = String(source.fileName || '')
      .replace(/\.(?:json|png|ya?ml|txt)$/i, '')
      .trim();
    if (preview.kind === 'character-card') {
      return `${summary.characterName || fileTitle || '新角色'}的故事`;
    }
    if (preview.kind === 'world-book') {
      const previewTitle = String(preview.title || '').trim();
      return previewTitle && previewTitle !== '导入的世界书'
        ? previewTitle
        : (fileTitle || summary.titles?.[0] || '自定义世界');
    }
    return preview.title || fileTitle || '自定义剧本';
  }

  async function quickLaunchCharacterStory(characterResourceId, { basePackId = CUSTOM_STORY_BASE_PACK_ID } = {}) {
    const resources = Array.isArray(state.resourceLibrary) ? state.resourceLibrary : [];
    const character = resources.find((item) => (item.id === characterResourceId || item.raw?.id === characterResourceId) && (item.kind === 'character' || item.raw?.kind === 'character'));
    const resolvedChar = character?.raw || character;
    if (!resolvedChar) throw new Error('未找到指定的角色卡');

    const companionWorldBooks = getCompanionWorldBooks(resolvedChar, resources);
    const card = resolvedChar.payload || {};
    const charName = resolvedChar.title || card.name || '角色';
    const title = `${charName}之卷`;

    // Quick launch must not silently combine unrelated library presets.
    const selectedIds = new Set(collectSelectedPromptResourceIds());
    const prompts = resources.filter(resource => isPromptLibraryResource(resource) && selectedIds.has(resource.id));
    const preview = {
      kind: 'character-card',
      summary: {
        characterName: charName,
        declaredGenre: card.genre || (Array.isArray(card.tags) ? card.tags.join(' · ') : '') || '角色专属原创故事'
      }
    };

    return await createStoryFromCommittedImport({
      libraryResources: [resolvedChar, ...companionWorldBooks, ...prompts],
      preview
    }, {
      basePackId,
      disposition: STORY_IMPORT_MODES.INDEPENDENT,
      source: { fileName: charName }
    });
  }

  return {
    bindEvents,
    buildCustomPackRequest,
    closeCustomStoryDialog,
    createCustomStoryFromDraft,
    createStoryFromCommittedImport,
    quickLaunchCharacterStory,
    getCompanionWorldBooks,
    getCustomStoryReadiness,
    invalidateCustomStoryInspection,
    openCustomStoryDialog,
    openCompatibilityUpgradeReview,
    openDerivedStoryBuilder,
    persistCustomStoryDraft,
    renderCustomStoryBuilder,
    renderStoryImportBaseOptions,
    stageStoryResourcesFromCommittedImport
  };
}
