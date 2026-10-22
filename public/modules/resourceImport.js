import { createCommunityCompatibilitySection } from './importCompatibility.js';
import { STORY_IMPORT_MODES, evaluateStoryImportRoute } from './importRouting.js';
import {
  createCustomStoryApprovalController,
  createCustomStoryCompatibilityReview
} from './customStoryCompatibilityReview.js';
import { truncateText } from './utils.js';

const PACKAGE_IMPORT_KINDS = new Set([
  'plugin-manifest',
  'content-pack',
  'prompt-preset',
  'regex-preset'
]);

export function isPackageImportKind(kind) {
  return PACKAGE_IMPORT_KINDS.has(String(kind || ''));
}

export function matchesExpectedImportKind(expectedKind, actualKind) {
  const expected = String(expectedKind || '');
  const actual = String(actualKind || '');
  return !expected
    || (expected === 'character' && actual === 'character-card')
    || (expected === 'worldbook' && actual === 'world-book')
    || (expected === 'prompt' && ['prompt-module', 'prompt-preset', 'regex-preset'].includes(actual));
}

export function getImportActionLabel({
  canCommit = false,
  intent = '',
  kind = '',
  summary = {},
  disposition = STORY_IMPORT_MODES.ATTACH,
  verdict = '',
  runtimeReady = true,
  applyCurrent = false,
  updateCount = 0
} = {}) {
  if (!canCommit) {
    if (intent === 'create-story' && kind === 'plugin-manifest') return '此文件不能创建剧本';
    return verdict === 'duplicate' ? '已在素材库' : '修正后再导入';
  }
  if (!runtimeReady) {
    return intent === 'create-story' ? '保存原件并配置待完善副本' : '仅安全保存原件';
  }
  if (intent === 'create-story') {
    if (kind === 'content-pack') return '安装并创建剧本';
    return disposition === STORY_IMPORT_MODES.INDEPENDENT
      ? '存入并配置独立副本'
      : '存入并继续配置';
  }
  if (Number(updateCount || 0) > 0) return `导入为新版本（${Number(updateCount)} 份）`;
  if (kind === 'plugin-manifest') return '安装适配插件';
  if (kind === 'content-pack') return '安装内容包';
  if (kind === 'prompt-preset') {
    const count = Number(summary.promptModuleCount || 0);
    return count ? `存入素材库（${count} 个模块）` : '存入素材库';
  }
  if (kind === 'regex-preset') {
    const count = Number(summary.regexScriptCount || 0);
    return count ? `存入素材库（${count} 条规则）` : '存入素材库';
  }
  return applyCurrent ? '存入并载入' : '存入素材库';
}

export function summarizeImportCommitResult(payload = {}, {
  kind = '',
  summary = {},
  source = {}
} = {}) {
  const resources = Array.isArray(payload.libraryResources) ? payload.libraryResources : [];
  const created = resources.filter((item) => item.importStatus === 'created').length;
  const updated = resources.filter((item) => item.importStatus === 'updated').length;
  const duplicates = resources.filter((item) => item.importStatus === 'duplicate').length;
  const count = Number(payload.importedWorldBookCount || 0);
  const installAction = payload.installStatus === 'updated'
    ? '已更新'
    : payload.installStatus === 'duplicate'
      ? '已存在'
      : '已安装';

  if (kind === 'prompt-preset') {
    return `已导入预设《${summary.title || source.fileName || '未命名预设'}》：${Number(summary.promptModuleCount || created + updated + duplicates)} 个模块`;
  }
  if (kind === 'regex-preset') {
    return `已导入 Regex 配套《${summary.title || source.fileName || '未命名规则集'}》：安全映射 ${Number(summary.safeRegexScriptCount || 0)} 条，沙箱执行 ${Number(summary.sandboxedRegexScriptCount || 0)} 条，阻断 ${Number(summary.blockedRegexScriptCount || 0)} 条`;
  }
  if (payload.applyMode === 'plugin-registry') {
    return `${installAction}扩展：${payload.plugin?.name || payload.plugin?.id || '未命名插件'} v${payload.plugin?.version || ''}`;
  }
  if (payload.applyMode === 'content-pack-library') {
    return `${installAction}内容包：${payload.pack?.title || payload.pack?.id || '未命名内容包'} v${payload.pack?.version || ''}`;
  }
  return payload.applyMode === 'active-config'
    ? `已入库并载入：新增 ${created}，更新 ${updated}，重复 ${duplicates}，世界书 ${count} 条`
    : `已存入素材库：新增 ${created}，更新 ${updated}，重复 ${duplicates}`;
}

export function createResourceImportController({
  state,
  els,
  apiRequest = async () => ({}),
  getCurrentSessionId = () => 'main',
  setStatus = () => {},
  humanizeApiError = (error) => error?.message || String(error),
  inferMimeType = () => 'application/json',
  formatBytes = String,
  formatTokenCount = String,
  resourceKindLabel = (kind) => String(kind || '素材'),
  setResourceFlowStep = () => {},
  loadState = async () => {},
  loadResourceLibrary = async () => {},
  activateTab = () => {},
  activateResourceView = () => {},
  renderStoryLauncher = () => {},
  openStoryLauncher = () => {},
  openCustomStoryDialog = async () => {},
  createStoryFromCommittedImport = async () => ({ project: { title: '' } }),
  stageStoryResourcesFromCommittedImport = () => ({ independentCopy: false, resourceCount: 0 }),
  setAssetCenterStatus = () => {},
  getSourceLabel = (sourceId) => sourceId || '素材源',
  confirmAction = (message) => globalThis.confirm?.(message) === true,
  objectUrlApi = globalThis.URL
} = {}) {
  let pendingImportPayload = null;
  let pendingImportSource = null;
  let pendingImportPortraitUrl = '';
  let pendingImportCanCommit = false;
  let pendingImportKind = '';
  let pendingImportSummary = {};
  let pendingImportIntent = '';
  let pendingImportBasePackId = '';
  let pendingImportDisposition = STORY_IMPORT_MODES.ATTACH;
  let pendingImportUpdateCount = 0;
  let pendingImportBaseCanCommit = false;
  let pendingImportCompatibilityReview = null;
  let pendingImportCompatibilityDecision = createCustomStoryCompatibilityReview();

  function bindEvents() {
    els.characterCardImport?.addEventListener('change', () => importCharacterCardFile());
    els.pluginManifestImport?.addEventListener('change', () => importCharacterCardFile(els.pluginManifestImport));
    els.confirmImport?.addEventListener('click', () => commitPendingImport());
    els.cancelImport?.addEventListener('click', () => cancelPendingImport());
    els.closeImportReview?.addEventListener('click', () => cancelPendingImport());
    els.importApplyCurrent?.addEventListener('change', updateImportActionLabel);
    els.importReviewDialog?.addEventListener('cancel', (event) => {
      event.preventDefault();
      cancelPendingImport();
    });
  }

  async function previewImportSourceItem(item, button) {
    setStatus(els.sourceStatus, '正在下载并解析...', 'busy');
    button.disabled = true;
    try {
      const payload = await apiRequest('/api/import-sources/download', {
        method: 'POST',
        body: {
          source: item.sourceId || els.sourceSelect.value,
          id: item.id,
          downloadUrl: item.downloadUrl,
          fileName: `${sanitizeImportFileName(item.title || item.id || 'character-card')}.png`
        }
      });
      const source = {
        sourceId: item.sourceId || els.sourceSelect.value,
        site: getSourceLabel(item.sourceId || els.sourceSelect.value),
        url: item.sourceUrl || item.downloadUrl || '',
        author: item.author || item.creator || '',
        version: item.version || '',
        fileName: payload.payload?.fileName || ''
      };
      const inspected = await apiRequest('/api/import/preview', {
        method: 'POST',
        body: { payload: payload.payload, source }
      });
      pendingImportPayload = payload.payload;
      pendingImportSource = source;
      renderImportPreview(inspected.preview);
      setStatus(els.sourceStatus, '评定报告已生成', 'ok');
    } catch (error) {
      setStatus(els.sourceStatus, `预览失败：${humanizeApiError(error)}`, 'error');
    } finally {
      button.disabled = false;
    }
  }

  function getImportStatusTarget(intent = pendingImportIntent) {
    return intent === 'create-story' ? (els.storyCustomStatus || els.storyLauncherStatus) : els.characterCardStatus;
  }

  async function importCharacterCardFile(input = els.characterCardImport, options = {}) {
    const file = input?.files?.[0];
    if (!file) return;
    const expectedKind = String(input?.dataset?.assetImportKind || '');
    const intent = options.intent === 'create-story' ? 'create-story' : '';
    const statusTarget = getImportStatusTarget(intent);
    pendingImportIntent = intent;
    pendingImportBasePackId = intent ? String(options.basePackId || '') : '';
    pendingImportDisposition = STORY_IMPORT_MODES.ATTACH;
    setStatus(statusTarget, intent ? '正在评定剧本素材...' : '正在解析导入文件...', 'busy');
    setImportButtonsDisabled(true);
    try {
      const mimeType = file.type || inferMimeType(file.name);
      const query = new URLSearchParams({
        fileName: file.name,
        mimeType
      });
      const payload = await apiRequest(`/api/import/upload?${query}`, {
        method: 'POST',
        headers: { 'content-type': mimeType },
        rawBody: file
      });
      const actualKind = String(payload.preview?.kind || '');
      if (!matchesExpectedImportKind(expectedKind, actualKind)) {
        const labels = { character: '角色卡', worldbook: '世界书', prompt: 'Prompt 模块', 'prompt-bundle': '预设包' };
        throw new Error(`所选文件不是可识别的${labels[expectedKind] || '素材'}格式`);
      }
      pendingImportPayload = { uploadId: payload.upload?.uploadId || '' };
      pendingImportSource = { site: 'local-file', fileName: file.name };
      if (pendingImportPortraitUrl) objectUrlApi.revokeObjectURL(pendingImportPortraitUrl);
      pendingImportPortraitUrl = mimeType === 'image/png' ? objectUrlApi.createObjectURL(file) : '';
      renderImportPreview({ ...payload.preview, upload: payload.upload });
      setStatus(
        statusTarget,
        intent
          ? '素材评定完成；点击评定窗口底部的存入按钮后，才会回填到剧本配置。'
          : '导入预览已生成；请在评定窗口底部确认存入素材库。',
        'ok'
      );
    } catch (error) {
      clearPendingImport({ resetFile: false });
      setStatus(statusTarget, `解析失败：${humanizeApiError(error)}`, 'error');
    } finally {
      if (input) {
        input.value = '';
        delete input.dataset.assetImportKind;
      }
      setImportButtonsDisabled(false);
    }
  }

  async function commitPendingImport() {
    if (!pendingImportPayload) {
      setStatus(getImportStatusTarget(), '没有待确认的导入内容', 'error');
      return;
    }

    const importIntent = pendingImportIntent;
    const importKind = pendingImportKind;
    const importSummary = { ...pendingImportSummary };
    const importBasePackId = pendingImportBasePackId;
    const importDisposition = pendingImportDisposition;
    const importSource = pendingImportSource || {};
    const statusTarget = getImportStatusTarget(importIntent);
    setStatus(statusTarget, importIntent === 'create-story' ? '正在入库并准备自定义剧本...' : '正在写入导入内容...', 'busy');
    setImportButtonsDisabled(true);
    try {
      const isPackageImport = isPackageImportKind(pendingImportKind);
      const applyToActiveConfig = importIntent !== 'create-story' && !isPackageImport && els.importApplyCurrent?.checked === true;
      const payload = await apiRequest('/api/import/commit', {
        method: 'POST',
        body: {
          payload: pendingImportPayload,
          source: importSource,
          sessionId: getCurrentSessionId(),
          applyToActiveConfig,
          compatibilityReview: pendingImportKind === 'content-pack'
            ? pendingImportCompatibilityDecision
            : undefined
        }
      });
      if (importIntent === 'create-story') {
        if (pendingImportKind === 'content-pack') {
          const result = await createStoryFromCommittedImport(payload, {
            basePackId: importBasePackId,
            source: importSource,
            disposition: importDisposition
          });
          clearPendingImport({ resetFile: false });
          setStatus(els.appStatus, `已建立《${result.project.title}》，请从封面进入主角塑成。`, 'ok');
          return;
        }
        const staged = stageStoryResourcesFromCommittedImport(payload, {
          basePackId: importBasePackId,
          source: importSource,
          disposition: importDisposition
        });
        clearPendingImport({ resetFile: false });
        await loadResourceLibrary();
        renderStoryLauncher();
        openStoryLauncher({ focusSearch: false });
        openCustomStoryDialog({ resetStatus: false });
        setStatus(
          els.storyCustomStatus,
          staged.independentCopy
            ? `已保留 ${staged.resourceCount} 份原始素材，并切换为独立副本。请审阅世界边界后创建剧本。`
            : `已载入 ${staged.resourceCount} 份素材。请审阅缺失项，然后点击“创建剧本并进入”。`,
          'ok'
        );
        return;
      }
      const applied = payload.applyMode === 'active-config';
      clearPendingImport({ resetFile: false });
      if (applied) await loadState();
      else await loadResourceLibrary();
      const resultText = summarizeImportCommitResult(payload, {
        kind: importKind,
        summary: importSummary,
        source: importSource
      });
      setStatus(statusTarget, resultText, 'ok');
      setStatus(els.resourceLibraryStatus, resultText, 'ok');
      setAssetCenterStatus(resultText, 'ok');
      activateTab('sources');
      activateResourceView(importKind === 'plugin-manifest' ? 'extensions' : importKind === 'content-pack' ? 'composer' : 'library');
    } catch (error) {
      const prefix = importIntent === 'create-story' ? '创建失败' : '导入失败';
      setStatus(statusTarget, `${prefix}：${humanizeApiError(error)}`, 'error');
    } finally {
      setImportButtonsDisabled(false);
    }
  }


  function cancelPendingImport() {
    const importIntent = pendingImportIntent;
    clearPendingImport();
    if (importIntent === 'create-story') {
      setStatus(els.storyLauncherStatus, '已取消创建，自定义素材未写入。', 'ok');
      return;
    }
    const activeResourceView = els.resourceViewButtons.find((button) => button.classList.contains('active'))?.dataset.resourceView;
    activateResourceView(activeResourceView || 'library');
    setStatus(els.characterCardStatus, '已取消导入', 'ok');
    setStatus(els.sourceStatus, '已取消导入', 'ok');
  }

  function renderImportPreview(preview = {}) {
    const summary = preview.summary || {};
    const inspection = preview.inspection || {};
    const communityCompatibility = inspection.communityCompatibility || null;
    const resources = Array.isArray(inspection.resources) ? inspection.resources : [];
    const isPackageImport = isPackageImportKind(preview.kind);
    const isStoryImport = pendingImportIntent === 'create-story';
    const importBasePack = (state.contentPacks || []).find((pack) => pack.id === pendingImportBasePackId);
    const storyImportRoute = isStoryImport
      ? evaluateStoryImportRoute(preview, {
          basePackId: pendingImportBasePackId,
          basePackTitle: importBasePack?.title || ''
        })
      : null;
    pendingImportKind = preview.kind || '';
    pendingImportSummary = { ...summary, title: preview.title || summary.title || '' };
    pendingImportUpdateCount = Number(inspection.updateCount || resources.filter((item) => item.update?.available).length);
    pendingImportDisposition = storyImportRoute?.recommendedMode || STORY_IMPORT_MODES.ATTACH;
    pendingImportBaseCanCommit = inspection.canImport !== false
      && !(isStoryImport && preview.kind === 'plugin-manifest');
    pendingImportCanCommit = pendingImportBaseCanCommit;
    pendingImportCompatibilityReview = preview.kind === 'content-pack'
      ? inspection.compatibilityReview || null
      : null;
    pendingImportCompatibilityDecision = createCustomStoryCompatibilityReview();
    els.importPreview.innerHTML = '';

    if (els.importReviewKicker) els.importReviewKicker.textContent = isStoryImport ? '自定义世界' : '资源准入';
    if (els.importReviewTitle) els.importReviewTitle.textContent = isStoryImport ? '剧本素材评定' : '导入评定';

    const assessment = document.createElement('section');
    assessment.className = 'import-assessment';
    const portraitSource = preview.kind === 'character-card' && summary.hasEmbeddedPortrait
      ? getPendingImportPortraitDataUrl()
      : '';
    if (portraitSource) {
      const portrait = document.createElement('img');
      portrait.className = 'import-character-portrait';
      portrait.src = portraitSource;
      portrait.alt = `${summary.characterName || '导入角色'}卡面预览`;
      assessment.classList.add('has-portrait');
      assessment.append(portrait);
    }
    const score = document.createElement('div');
    score.className = `import-score import-score-${inspection.verdict || 'review'}`;
    const scoreValue = document.createElement('strong');
    scoreValue.textContent = String(Number(inspection.score || 0));
    const scoreUnit = document.createElement('span');
    scoreUnit.textContent = '/ 100';
    score.append(scoreValue, scoreUnit);

    const assessmentCopy = document.createElement('div');
    assessmentCopy.className = 'import-assessment-copy';
    const eyebrow = document.createElement('span');
    eyebrow.textContent = {
      'world-book': '世界书',
      'character-card': '角色卡',
      'prompt-preset': '酒馆 Prompt 预设',
      'regex-preset': 'SillyTavern Regex 配套规则',
      'content-pack': '版本化内容包',
      'plugin-manifest': '声明式适配插件'
    }[preview.kind] || '创作资源';
    const title = document.createElement('h3');
    title.textContent = preview.kind === 'world-book'
      ? (preview.title || summary.titles?.[0] || '未命名世界书')
      : preview.kind === 'character-card'
        ? (summary.characterName || '未命名角色')
        : (preview.title || summary.packId || summary.pluginId || '未命名资源包');
    const recommendation = document.createElement('p');
    recommendation.textContent = inspection.summary || '解析完成，可以审阅后存入素材库。';
    assessmentCopy.append(eyebrow, title, recommendation);

    const verdict = document.createElement('span');
    verdict.className = `import-verdict import-verdict-${inspection.verdict || 'review'}`;
    verdict.textContent = inspection.verdictLabel || inspection.grade || '待检查';
    assessment.append(score, assessmentCopy, verdict);
    els.importPreview.append(assessment);

    // ── 类目一：入库与剧本挂载策略 (可选) ──
    if (storyImportRoute && preview.kind !== 'plugin-manifest') {
      els.importPreview.append(createStoryImportRouteSection(storyImportRoute, importBasePack));
    }

    // ── 类目二：社区扩展与生态兼容 ──
    const compatibilitySection = createCommunityCompatibilitySection(communityCompatibility, {
      storyImport: isStoryImport,
      onStrategyChange: (decisions) => {
        pendingImportCompatibilityDecision = {
          ...pendingImportCompatibilityDecision,
          decisions
        };
        if (els.confirmImport) {
          els.confirmImport.textContent = '确认以此策略导入素材';
        }
      }
    });
    if (compatibilitySection) els.importPreview.append(compatibilitySection);
    if (pendingImportCompatibilityReview?.fingerprint) {
      els.importPreview.append(createImportCompatibilityApprovalSection());
    }

    // ── 类目三：结构合规与质量评定 ──
    if (Array.isArray(inspection.dimensions) && inspection.dimensions.length) {
      const dimensionSection = document.createElement('section');
      dimensionSection.className = 'import-dimensions';
      const heading = document.createElement('div');
      heading.className = 'import-section-heading';
      heading.innerHTML = '<strong>📊 结构合规与技术评定</strong><span>只评估格式规范、世界书与运行质量</span>';
      const dimensionList = document.createElement('div');
      dimensionList.className = 'import-dimension-list';
      inspection.dimensions.forEach((dimension) => {
        const row = document.createElement('div');
        row.className = `import-dimension is-${dimension.status || 'review'}`;
        const label = document.createElement('div');
        label.className = 'import-dimension-label';
        const name = document.createElement('strong');
        name.textContent = dimension.label || dimension.id;
        const value = document.createElement('span');
        value.textContent = `${Number(dimension.score || 0)} 分`;
        label.append(name, value);
        const track = document.createElement('div');
        track.className = 'import-dimension-track';
        const fill = document.createElement('span');
        fill.style.width = `${Math.max(0, Math.min(100, Number(dimension.score || 0)))}%`;
        track.append(fill);
        const note = document.createElement('small');
        note.textContent = dimension.summary || '';
        row.append(label, track, note);
        dimensionList.append(row);
      });
      dimensionSection.append(heading, dimensionList);
      els.importPreview.append(dimensionSection);
    }

    const list = document.createElement('ul');
    list.className = 'import-preview-list';
    if (preview.upload?.size) {
      appendImportPreviewItem(
        list,
        '源文件',
        `${formatBytes(preview.upload.size)} · 二进制暂存上传 · 确认入库后自动释放`
      );
    }
    if (preview.kind === 'character-card') {
      appendImportPreviewItem(list, '角色', summary.characterName || '未命名角色');
      appendImportPreviewItem(list, '开场白', summary.firstMessage ? truncateText(summary.firstMessage, 72) : '无');
      appendImportPreviewItem(list, '标签', Array.isArray(summary.tags) && summary.tags.length ? summary.tags.join('、') : '无');
      appendImportPreviewItem(list, '附带世界书', `${Number(summary.worldBookCount || 0)} 条`);
      appendImportPreviewItem(
        list,
        '角色图片',
        summary.hasEmbeddedPortrait
          ? `随卡导入${summary.portraitWidth && summary.portraitHeight ? ` · ${summary.portraitWidth}×${summary.portraitHeight}` : ''}`
          : '未附带，将使用默认头像'
      );
    } else if (preview.kind === 'world-book') {
      appendImportPreviewItem(list, '世界书条目', `${Number(summary.worldBookCount || 0)} 条`);
      appendImportPreviewItem(list, '标题示例', Array.isArray(summary.titles) && summary.titles.length ? summary.titles.join('、') : '无');
    } else if (preview.kind === 'content-pack') {
      appendImportPreviewItem(list, '内容包 ID', summary.packId || inspection.manifest?.id || '未声明');
      appendImportPreviewItem(list, '版本', summary.version || inspection.manifest?.version || '未声明');
      appendImportPreviewItem(list, '引擎范围', summary.engine || inspection.manifest?.engine || '未声明');
      appendImportPreviewItem(list, '主角色卡', summary.characterName || '未命名角色');
      appendImportPreviewItem(list, '世界书', `${Number(summary.worldBookCount || inspection.counts?.worldBook || 0)} 条`);
      appendImportPreviewItem(list, 'Prompt', `${Number(summary.promptModuleCount || inspection.counts?.promptModules || 0)} 个`);
      appendImportPreviewItem(list, '依赖', `${Number(summary.dependencyCount || inspection.dependencies?.length || 0)} 项`);
    } else if (preview.kind === 'plugin-manifest') {
      appendImportPreviewItem(list, '插件 ID', summary.pluginId || inspection.manifest?.id || '未声明');
      appendImportPreviewItem(list, '版本', summary.version || inspection.manifest?.version || '未声明');
      appendImportPreviewItem(list, '引擎范围', summary.engine || inspection.manifest?.engine || '未声明');
      appendImportPreviewItem(list, '格式适配器', `${Number(summary.adapterCount || inspection.manifest?.adapters?.length || 0)} 个`);
      appendImportPreviewItem(list, '依赖', `${Number(summary.dependencyCount || inspection.dependencies?.length || 0)} 项`);
    } else if (preview.kind === 'prompt-preset') {
      appendImportPreviewItem(list, '来源格式', summary.sourceFormat === 'tavern-helper-preset' ? '酒馆助手标准化预设' : 'SillyTavern 原生预设');
      appendImportPreviewItem(list, 'Prompt 模块', `${Number(summary.promptModuleCount || 0)} 个`);
      appendImportPreviewItem(list, '已启用提示', `${Number(summary.enabledPromptCount || 0)} 个`);
      appendImportPreviewItem(list, '内置锚点', `${Number(summary.placeholderCount || 0)} 个`);
      appendImportPreviewItem(
        list,
        'Regex 配套',
        `${Number(summary.regexScriptCount || 0)} 条 · 安全映射 ${Number(summary.safeRegexScriptCount || 0)} · 显示降级 ${Number(summary.degradedRegexScriptCount || 0)} · 沙箱执行 ${Number(summary.sandboxedRegexScriptCount || 0)} · 阻断 ${Number(summary.blockedRegexScriptCount || 0)}`
      );
      appendImportPreviewItem(list, '酒馆助手脚本', `${Number(summary.tavernHelperScriptCount || 0)} 个 · 保持禁用`);
      appendImportPreviewItem(
        list,
        '生成参数',
        summarizeImportedGenerationSettings(summary.generationSettings)
      );
    } else if (preview.kind === 'regex-preset') {
      appendImportPreviewItem(list, '来源格式', 'SillyTavern Regex 预设');
      appendImportPreviewItem(list, '规则总数', `${Number(summary.regexScriptCount || 0)} 条`);
      appendImportPreviewItem(list, '已启用', `${Number(summary.enabledRegexScriptCount || 0)} 条`);
      appendImportPreviewItem(list, '声明式安全映射', `${Number(summary.safeRegexScriptCount || 0)} 条`);
      appendImportPreviewItem(list, '静态显示降级', `${Number(summary.degradedRegexScriptCount || 0)} 条 · 不执行 HTML/JS`);
      appendImportPreviewItem(list, '沙箱执行', `${Number(summary.sandboxedRegexScriptCount || 0)} 条 · 隔离 iframe 渲染 · 含风险评估`);
      appendImportPreviewItem(list, '安全阻断', `${Number(summary.blockedRegexScriptCount || 0)} 条`);
    }
    if (!isPackageImport) {
      appendImportPreviewItem(
        list,
        '关键词示例',
        Array.isArray(summary.keywordSamples) && summary.keywordSamples.length ? summary.keywordSamples.join('、') : '无'
      );
      appendImportPreviewItem(list, '写入方式', summary.worldBookMode === 'append-dedupe' ? '追加并自动去重' : '按导入类型写入');
    }
    if (isStoryImport) {
      const basePack = (state.contentPacks || []).find((pack) => pack.id === pendingImportBasePackId);
      appendImportPreviewItem(
        list,
        '剧本基线',
        preview.kind === 'content-pack' ? '使用内容包自身规则' : (basePack?.title || pendingImportBasePackId || '未选择')
      );
    }
    appendImportPreviewItem(list, '格式适配', inspection.adapter?.label || inspection.adapter?.id || '通用适配');
    if (communityCompatibility) {
      appendImportPreviewItem(
        list,
        '扩展兼容',
        `${communityCompatibility.label || '已适配'} · 原生 ${Number(communityCompatibility.counts?.supported || 0)} / 转换 ${Number(communityCompatibility.counts?.degraded || 0)} / 缺失 ${Number(communityCompatibility.counts?.missing || 0)}`
      );
    }
    appendImportPreviewItem(list, '预计体量', `${formatTokenCount(inspection.estimatedTokens || 0)} tokens`);
    appendImportPreviewItem(
      list,
      isPackageImport ? '兼容结论' : '冲突检查',
      isPackageImport ? (inspection.verdictLabel || '待检查') : inspection.conflictCount ? `${inspection.conflictCount} 项` : '未发现'
    );
    const overview = document.createElement('section');
    overview.className = 'import-overview';
    const overviewHeading = document.createElement('div');
    overviewHeading.className = 'import-section-heading';
    overviewHeading.innerHTML = `<strong>🏛️ 素材规格与入库详情</strong><span>${isPackageImport ? '安装前不会执行任何第三方代码' : '解析数据与本地挂载策略'}</span>`;
    overview.append(overviewHeading, list);
    els.importPreview.append(overview);

    const updates = resources.filter((resource) => resource.update?.available);
    if (updates.length) {
      els.importPreview.append(createImportUpdateSection(updates));
    }

    if (resources.length) {
      const resourceReports = document.createElement('section');
      resourceReports.className = 'import-resource-reports';
      const reportHeading = document.createElement('div');
      reportHeading.className = 'import-section-heading';
      reportHeading.innerHTML = `<strong>资源明细</strong><span>${resources.length} 份独立素材</span>`;
      resourceReports.append(reportHeading);
      resources.forEach((resource) => resourceReports.append(createImportResourceReport(resource)));
      els.importPreview.append(resourceReports);
    }

    if (Array.isArray(inspection.dependencies) && inspection.dependencies.length) {
      const dependencySection = document.createElement('section');
      dependencySection.className = 'import-dependencies';
      const dependencyHeading = document.createElement('div');
      dependencyHeading.className = 'import-section-heading';
      dependencyHeading.innerHTML = `<strong>依赖检查</strong><span>${inspection.dependencies.length} 项声明</span>`;
      const dependencyList = document.createElement('div');
      dependencyList.className = 'import-dependency-list';
      inspection.dependencies.forEach((dependency) => {
        const row = document.createElement('div');
        row.className = `import-dependency is-${dependency.status || 'missing'}`;
        const identity = document.createElement('span');
        const name = document.createElement('strong');
        name.textContent = `${dependency.kind || 'plugin'} · ${dependency.id || '未命名依赖'}`;
        const range = document.createElement('small');
        range.textContent = `需要 ${dependency.range || '*'}${dependency.installedVersion ? ` · 当前 ${dependency.installedVersion}` : ''}`;
        identity.append(name, range);
        const status = document.createElement('span');
        status.textContent = dependency.status === 'ready' ? '已满足' : dependency.status === 'version-mismatch' ? '版本不符' : '未安装';
        row.append(identity, status);
        dependencyList.append(row);
      });
      dependencySection.append(dependencyHeading, dependencyList);
      els.importPreview.append(dependencySection);
    }

    const blocking = resources.flatMap((resource) => resource.diagnostics?.blockingIssues || []);
    const warnings = resources.flatMap((resource) => resource.diagnostics?.warnings || []);
    const risks = resources.flatMap((resource) => resource.diagnostics?.riskFlags || []);
    appendImportNoticeSection(els.importPreview, '必须处理', blocking, 'danger');
    appendImportNoticeSection(els.importPreview, '建议审阅', warnings, 'warning');
    appendImportNoticeSection(els.importPreview, '执行隔离', risks, 'neutral');
    if (isStoryImport && preview.kind === 'plugin-manifest') {
      appendImportNoticeSection(els.importPreview, '不能创建剧本', [{
        code: 'story-import-plugin-manifest',
        message: '这是适配插件清单，不是角色卡、世界书或内容包。请从资源库的扩展页安装。'
      }], 'danger');
    }

    if (els.importReviewDialog) {
      els.importReviewDialog.dataset.verdict = inspection.verdict || 'review';
      els.importReviewDialog.dataset.runtimeReady = communityCompatibility?.readyToPlay === false ? 'false' : 'true';
    }
    if (els.importApplyCurrent) els.importApplyCurrent.checked = false;
    if (els.importApplyCurrent) els.importApplyCurrent.disabled = isPackageImport || isStoryImport;
    if (els.importApplyOption) els.importApplyOption.hidden = isPackageImport || isStoryImport;
    els.confirmImport.hidden = false;
    els.cancelImport.hidden = false;
    setResourceFlowStep('review');
    updateImportActionLabel();
    setImportButtonsDisabled(false);
    if (els.importReviewDialog && !els.importReviewDialog.open) els.importReviewDialog.showModal();
  }

  function createStoryImportRouteSection(route, basePack) {
    const section = document.createElement('section');
    section.className = `import-story-route is-${route.compatibility || 'unknown'}`;
    const heading = document.createElement('div');
    heading.className = 'import-section-heading';
    const title = document.createElement('strong');
    title.textContent = '导入去向';
    const note = document.createElement('span');
    note.textContent = route.compatibility === 'mismatch' ? '检测到题材不一致' : '创建前可调整';
    heading.append(title, note);

    const choices = document.createElement('div');
    choices.className = 'import-story-route-choices';
    const options = [
      {
        mode: STORY_IMPORT_MODES.ATTACH,
        title: `挂载到${basePack?.title ? `《${basePack.title}》` : '当前基线'}`,
        description: '继承基线规则与世界书，把本次资源作为补充素材。',
        disabled: !route.canAttach
      },
      {
        mode: STORY_IMPORT_MODES.INDEPENDENT,
        title: '创建独立副本',
        description: '不继承当前世界书；保留原角色卡、附带设定、立绘、作者与来源。',
        disabled: false
      }
    ];
    options.forEach((option) => {
      const label = document.createElement('label');
      label.className = 'import-story-route-option';
      label.classList.toggle('is-recommended', route.recommendedMode === option.mode);
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'story-import-route';
      input.value = option.mode;
      input.checked = pendingImportDisposition === option.mode;
      input.disabled = option.disabled;
      const copy = document.createElement('span');
      const optionTitle = document.createElement('strong');
      optionTitle.textContent = option.title;
      const description = document.createElement('small');
      description.textContent = option.description;
      copy.append(optionTitle, description);
      label.append(input, copy);
      choices.append(label);
    });
    choices.addEventListener('change', (event) => {
      const input = event.target.closest('input[name="story-import-route"]');
      if (!input) return;
      pendingImportDisposition = input.value === STORY_IMPORT_MODES.INDEPENDENT
        ? STORY_IMPORT_MODES.INDEPENDENT
        : STORY_IMPORT_MODES.ATTACH;
      updateImportActionLabel();
    });

    const reason = document.createElement('p');
    reason.className = 'import-story-route-reason';
    reason.textContent = route.reason;
    section.append(heading, choices, reason);
    return section;
  }

  function getPendingImportPortraitDataUrl() {
    if (pendingImportPortraitUrl) return pendingImportPortraitUrl;
    const payload = pendingImportPayload || {};
    const mimeType = String(payload.mimeType || '').toLowerCase();
    const data = String(payload.data || '');
    if (!mimeType.includes('png') || !data) return '';
    if (data.startsWith('data:image/png')) return data;
    if (payload.encoding === 'base64') return `data:image/png;base64,${data}`;
    return '';
  }

  function createImportUpdateSection(resources) {
    const section = document.createElement('section');
    section.className = 'import-update-preview';
    const heading = document.createElement('div');
    heading.className = 'import-section-heading';
    heading.innerHTML = `<strong>发现素材更新</strong><span>${resources.length} 份素材将生成新版本；已创建故事保持不变</span>`;
    const list = document.createElement('div');
    list.className = 'import-update-list';
    resources.forEach((resource) => {
      const update = resource.update || {};
      const diff = update.diff || {};
      const details = document.createElement('details');
      details.className = 'import-update-item';
      details.open = true;
      const summary = document.createElement('summary');
      const identity = document.createElement('span');
      identity.textContent = `${resourceKindLabel(resource.kind)} · ${resource.title || '未命名素材'}`;
      const version = document.createElement('strong');
      version.textContent = `修订 ${Number(update.currentRevisionNumber || 1)} → ${Number(update.nextRevisionNumber || 2)}`;
      summary.append(identity, version);
      const body = document.createElement('div');
      body.className = 'import-update-body';
      const overview = document.createElement('p');
      const tokenDelta = Number(diff.tokenDelta || 0);
      overview.textContent = `${diff.summary || '内容有变化'}${tokenDelta ? ` · Token ${tokenDelta > 0 ? '+' : ''}${tokenDelta}` : ''}`;
      body.append(overview);
      if (update.securityReviewRequired) {
        const warning = document.createElement('div');
        warning.className = 'import-update-review';
        warning.textContent = '脚本、正则或运行时内容发生变更，旧审核不会沿用。';
        body.append(warning);
      }
      const changes = Array.isArray(diff.changes) ? diff.changes : [];
      if (changes.length) {
        const changeList = document.createElement('ul');
        changes.slice(0, 12).forEach((change) => {
          const row = document.createElement('li');
          const action = change.type === 'added' ? '新增' : change.type === 'removed' ? '移除' : '修改';
          row.textContent = `${action} · ${change.label || change.path}${change.after ? `：${change.after}` : ''}`;
          changeList.append(row);
        });
        body.append(changeList);
      }
      details.append(summary, body);
      list.append(details);
    });
    section.append(heading, list);
    return section;
  }

  function createImportResourceReport(resource) {
    const details = document.createElement('details');
    details.className = 'import-resource-report';
    details.open = resource.diagnostics?.verdict !== 'recommended';
    const summary = document.createElement('summary');
    const identity = document.createElement('span');
    identity.textContent = `${resourceKindLabel(resource.kind)} · ${resource.title || '未命名素材'}`;
    const score = document.createElement('strong');
    score.textContent = `${Number(resource.diagnostics?.score || 0)} 分`;
    summary.append(identity, score);
    const body = document.createElement('div');
    body.className = 'import-resource-report-body';
    const recommendation = document.createElement('p');
    recommendation.textContent = resource.diagnostics?.recommendation || '未发现阻断项。';
    const meta = document.createElement('div');
    meta.className = 'import-resource-report-meta';
    meta.textContent = [
      `${formatTokenCount(resource.diagnostics?.estimatedTokens || 0)} tokens`,
      resource.diagnostics?.missingFields?.length ? `缺少 ${resource.diagnostics.missingFields.length} 项` : '核心字段齐备',
      resource.diagnostics?.conflicts?.length ? `${resource.diagnostics.conflicts.length} 项库内冲突` : '无库内冲突'
    ].join(' · ');
    body.append(recommendation, meta);
    details.append(summary, body);
    return details;
  }

  function appendImportNoticeSection(parent, title, notices, tone) {
    const unique = [...new Map((notices || []).map((item) => [item.code || item.message, item])).values()];
    if (!unique.length) return;
    const section = document.createElement('section');
    section.className = `import-notices import-notices-${tone}`;
    const heading = document.createElement('strong');
    heading.textContent = title;
    const list = document.createElement('ul');
    unique.slice(0, 8).forEach((notice) => {
      const item = document.createElement('li');
      item.textContent = notice.message || String(notice);
      list.append(item);
    });
    section.append(heading, list);
    parent.append(section);
  }

  function appendImportPreviewItem(list, label, value) {
    const item = document.createElement('li');
    const key = document.createElement('span');
    key.className = 'import-preview-key';
    key.textContent = label;
    const text = document.createElement('span');
    text.textContent = value;
    item.append(key, text);
    list.append(item);
  }

  function summarizeImportedGenerationSettings(settings = {}) {
    const items = [
      ['上下文', settings.maxContext],
      ['最大输出', settings.maxCompletionTokens],
      ['温度', settings.temperature],
      ['Top P', settings.topP],
      ['流式', settings.stream === undefined ? undefined : settings.stream ? '开启' : '关闭']
    ].filter(([, value]) => value !== undefined && value !== '');
    return items.length
      ? `${items.map(([label, value]) => `${label} ${value}`).join(' · ')}（仅保存建议值）`
      : '未声明';
  }

  function createImportCompatibilityApprovalSection() {
    const element = document.createElement('section');
    const reviewState = {
      customStoryDraft: {
        compatibilityReview: pendingImportCompatibilityDecision
      }
    };
    // Script-only packs enter the local exploration lane as soon as their
    // preflight fingerprint is known. Packs with capability degradation still
    // require the user's explicit acknowledgement below.
    if (pendingImportCompatibilityReview?.fingerprint
      && !pendingImportCompatibilityReview.requiresCompatibilityAcknowledgement
      && !reviewState.customStoryDraft.compatibilityReview?.fingerprint) {
      reviewState.customStoryDraft.compatibilityReview = createCustomStoryCompatibilityReview({
        fingerprint: pendingImportCompatibilityReview.fingerprint,
        executionMode: 'local-observe'
      });
    }
    let controller;
    const getReadiness = () => {
      const review = pendingImportCompatibilityReview || {};
      const saved = createCustomStoryCompatibilityReview(reviewState.customStoryDraft.compatibilityReview);
      const matches = saved.fingerprint === review.fingerprint;
      const rules = Array.isArray(review.rules) ? review.rules : [];
      const strictReview = saved.executionMode === 'review-required';
      return {
        compatibilityReview: review,
        sourceRuntimeBlocked: review.sourceRuntimeBlocked === true,
        pendingScriptRules: review.requiresScriptApproval && strictReview
          ? rules.filter((rule) => !saved.scriptReviews.some((item) => (
            matches
            && item.scriptId === String(rule.scriptId || '')
            && item.contentHash === String(rule.contentHash || '')
          )))
          : [],
        compatibilityAcknowledgementPending: Boolean(
          review.requiresCompatibilityAcknowledgement
          && !(matches && saved.acknowledgeCompatibility)
        )
      };
    };
    const sync = () => {
      pendingImportCompatibilityDecision = createCustomStoryCompatibilityReview(
        reviewState.customStoryDraft.compatibilityReview
      );
      const readiness = getReadiness();
      pendingImportCanCommit = pendingImportBaseCanCommit
        && readiness.pendingScriptRules.length === 0
        && !readiness.compatibilityAcknowledgementPending;
      setImportButtonsDisabled(false);
      updateImportActionLabel();
    };
    controller = createCustomStoryApprovalController({
      state: reviewState,
      element,
      getReadiness,
      persistDraft: sync,
      renderReadiness: () => {
        const readiness = getReadiness();
        controller.render(readiness, { status: 'ready' });
        sync();
      },
      invalidateInspection: () => {},
      confirmAction
    });
    controller.bindEvents();
    const readiness = getReadiness();
    controller.render(readiness, { status: 'ready' });
    sync();
    return element;
  }

  function clearPendingImport({ resetFile = true } = {}) {
    if (pendingImportPortraitUrl) objectUrlApi.revokeObjectURL(pendingImportPortraitUrl);
    pendingImportPortraitUrl = '';
    pendingImportPayload = null;
    pendingImportSource = null;
    pendingImportCanCommit = false;
    pendingImportKind = '';
    pendingImportSummary = {};
    pendingImportIntent = '';
    pendingImportBasePackId = '';
    pendingImportDisposition = STORY_IMPORT_MODES.ATTACH;
    pendingImportUpdateCount = 0;
    pendingImportBaseCanCommit = false;
    pendingImportCompatibilityReview = null;
    pendingImportCompatibilityDecision = createCustomStoryCompatibilityReview();
    els.importPreview.innerHTML = '';
    if (els.importReviewDialog?.open) els.importReviewDialog.close();
    if (els.importReviewDialog) delete els.importReviewDialog.dataset.verdict;
    if (els.importReviewDialog) delete els.importReviewDialog.dataset.runtimeReady;
    if (els.importApplyCurrent) {
      els.importApplyCurrent.checked = false;
      els.importApplyCurrent.disabled = false;
    }
    if (els.importApplyOption) els.importApplyOption.hidden = false;
    if (els.importReviewKicker) els.importReviewKicker.textContent = '资源准入';
    if (els.importReviewTitle) els.importReviewTitle.textContent = '导入评定';
    if (resetFile) {
      els.characterCardImport.value = '';
      if (els.storyImportFile) els.storyImportFile.value = '';
      if (els.pluginManifestImport) els.pluginManifestImport.value = '';
    }
  }

  function setImportButtonsDisabled(disabled) {
    els.confirmImport.disabled = disabled || !pendingImportCanCommit;
    els.cancelImport.disabled = disabled;
  }

  function updateImportActionLabel() {
    if (!els.confirmImport) return;
    els.confirmImport.textContent = getImportActionLabel({
      canCommit: pendingImportCanCommit,
      intent: pendingImportIntent,
      kind: pendingImportKind,
      summary: pendingImportSummary,
      disposition: pendingImportDisposition,
      verdict: els.importReviewDialog?.dataset.verdict,
      runtimeReady: els.importReviewDialog?.dataset.runtimeReady !== 'false',
      applyCurrent: els.importApplyCurrent?.checked === true,
      updateCount: pendingImportUpdateCount
    });
  }

  function getPendingImportState() {
    return {
      payload: pendingImportPayload,
      source: pendingImportSource,
      canCommit: pendingImportCanCommit,
      kind: pendingImportKind,
      summary: { ...pendingImportSummary },
      intent: pendingImportIntent,
      basePackId: pendingImportBasePackId,
      disposition: pendingImportDisposition,
      compatibilityReview: createCustomStoryCompatibilityReview(pendingImportCompatibilityDecision)
    };
  }

  return {
    bindEvents,
    cancelPendingImport,
    clearPendingImport,
    commitPendingImport,
    getPendingImportState,
    importCharacterCardFile,
    previewImportSourceItem,
    renderImportPreview,
    updateImportActionLabel
  };
}

export function sanitizeImportFileName(value) {
  return String(value || 'asset')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'asset';
}
