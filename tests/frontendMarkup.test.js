import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const FRONTEND_STYLE_FILES = [
  'foundation.css',
  'asset-center.css',
  'heavy-frontend.css',
  'themes.css',
  'workbench-header.css',
  'bookshelf.css',
  'workbench-shell.css',
  'immersive.css',
  'workbench.css',
  'reading-modes.css',
  'reader-ui.css'
];

async function readFrontendCss() {
  return (await Promise.all(
    FRONTEND_STYLE_FILES.map((file) => readFile(`public/styles/${file}`, 'utf8'))
  )).join('\n');
}

test('frontend exposes provider presets and import review controls', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = `${await readFile('public/app.js', 'utf8')}
${await readFile('public/modules/characterPresets.js', 'utf8')}
${await readFile('public/modules/protagonistGenerator.js', 'utf8')}
${await readFile('public/modules/storyOpening.js', 'utf8')}
${await readFile('public/modules/journeySetup.js', 'utf8')}
${await readFile('public/modules/journeyDraft.js', 'utf8')}
${await readFile('public/modules/openingWorkflow.js', 'utf8')}
${await readFile('public/modules/appState.js', 'utf8')}
${await readFile('public/modules/resourceImport.js', 'utf8')}
${await readFile('public/modules/resourceWorkbench.js', 'utf8')}
${await readFile('public/modules/conversationActions.js', 'utf8')}
${await readFile('public/modules/usageInspector.js', 'utf8')}
${await readFile('public/modules/memoryInspector.js', 'utf8')}
${await readFile('public/modules/presetCatalog.js', 'utf8')}`;
  const providerSettings = await readFile('public/modules/providerSettings.js', 'utf8');
  const sessionSettings = await readFile('public/modules/sessionSettings.js', 'utf8');
  const releaseData = await readFile('public/modules/releaseData.js', 'utf8');
  const visualStage = await readFile('public/modules/visualStage.js', 'utf8');

  assert.match(html, /id="provider-preset"/);
  assert.match(html, /href="\/styles\.css\?v=\d{8}-\d+"/);
  assert.match(html, /src="\/app\.js\?v=\d{8}-\d+"/);
  assert.match(html, /id="provider-kind"/);
  assert.match(html, /<select id="provider-model"/);
  assert.match(html, /id="provider-model-custom"/);
  assert.match(html, /id="test-provider"/);
  assert.match(html, /id="provider-test-result"/);
  assert.match(html, /id="provider-temperature"[^>]+step="0\.01"/);
  assert.match(html, /<details class="provider-advanced-settings">\s*<summary>高级请求参数<\/summary>/);
  assert.match(html, /id="continue-message"[^>]+title="沿着上一轮旁白继续生成"/);
  assert.doesNotMatch(html, /id="continue-message"[^>]+data-help-key/);
  assert.match(html, /id="release-data-panel"/);
  assert.match(html, /id="create-backup"/);
  assert.match(html, /id="backup-select"/);
  assert.match(html, /id="restore-backup"/);
  assert.match(html, /id="import-preview"/);
  assert.match(html, /id="confirm-import"/);
  assert.match(html, /id="cancel-import"/);
  assert.match(html, /id="content-pack-select"/);
  assert.match(html, /id="apply-content-pack"/);
  assert.match(html, /题材内容包/);
  assert.match(html, /value="mingmo"/);
  assert.match(html, /明末风云内容包/);
  assert.match(html, /value="xianxia"/);
  assert.match(html, /太虚仙侠内容包/);
  assert.match(html, /破甲预设：明末历史文字/);
  assert.match(html, /破甲预设：太虚仙侠/);
  assert.match(html, /id="session-provider"/);
  assert.match(html, /id="save-session-settings"/);
  assert.match(html, /id="usage-view"/);
  assert.match(html, /用量统计/);
  assert.match(html, /data-tab="status"/);
  assert.match(html, /id="rule-status-view"/);
  assert.match(html, /id="usage-scope"/);
  assert.match(html, /id="refresh-usage"/);
  assert.match(html, /id="rewrite-chat-input"/);
  assert.match(html, /润色/);
  assert.match(html, /id="toggle-author-note"[^>]+aria-controls="author-note-panel"[^>]+aria-expanded="false"/);
  assert.match(html, /id="author-note-panel"[^>]+aria-hidden="true"/);
  assert.match(html, /id="random-protagonist"/);
  assert.match(html, /id="random-protagonist-genre"/);
  assert.match(html, /明末/);
  assert.match(html, /value="mingmo_chongzhen"/);
  assert.match(html, /崇祯（明末皇帝线）/);
  assert.match(html, /自定义主角模板/);
  assert.match(html, /data-tab="sources"/);
  for (const mode of ['eye-care', 'dark', 'bright', 'soft', 'modern', 'cyber']) {
    assert.match(html, new RegExp(`value="${mode}"`));
  }
  assert.match(html, /id="source-select"/);
  assert.match(html, /id="source-query"/);
  assert.match(html, /id="source-search"/);
  assert.match(html, /id="source-results"/);

  assert.match(app, /createProviderSettingsController/);
  assert.match(providerSettings, /PROVIDER_PRESETS/);
  assert.match(providerSettings, /models:/);
  assert.match(providerSettings, /renderProviderModelOptions/);
  assert.match(providerSettings, /resolveSelectedProviderModel/);
  assert.match(providerSettings, /testProviderConnection/);
  assert.match(providerSettings, /\/api\/providers\/test/);
  assert.match(releaseData, /createBackup/);
  assert.match(releaseData, /restoreBackup/);
  assert.match(providerSettings, /anthropic/);
  assert.match(providerSettings, /gemini/);
  assert.match(app, /\/api\/import\/preview/);
  assert.match(app, /\/api\/import\/commit/);
  assert.match(app, /adult-creative-mode/);
  assert.match(app, /成人创作沙盒/);
  assert.match(app, /PROTAGONIST_GENERATOR/);
  assert.match(app, /generateRandomProtagonistCard/);
  assert.match(app, /applyContentPack/);
  assert.match(app, /\/api\/content-packs/);
  assert.match(app, /generateLingyiProtagonistCard/);
  assert.match(app, /MINGMO_PROTAGONIST_GENERATOR/);
  assert.match(app, /generateMingmoProtagonistCard/);
  assert.match(app, /XIANXIA_PROTAGONIST_GENERATOR/);
  assert.match(app, /generateXianxiaProtagonistCard/);
  assert.match(app, /mingmo_chongzhen/);
  assert.match(app, /朱由检/);
  assert.match(app, /renderUsageView/);
  assert.match(app, /renderRuleStatus/);
  assert.match(app, /ruleSystem/);
  assert.match(app, /formatRuleFieldValue/);
  assert.match(app, /loadUsageStats/);
  assert.match(app, /\/api\/usage/);
  assert.match(app, /USAGE_REFRESH_INTERVAL_MS\s*=\s*30000/);
  assert.match(sessionSettings, /saveSessionProvider/);
  assert.match(sessionSettings, /\/api\/session\/settings/);
  assert.match(app, /formatTokenCount/);
  assert.match(app, /rewriteChatInput/);
  assert.match(app, /\/api\/rewrite/);
  assert.match(app, /searchImportSources/);
  assert.match(app, /\/api\/import-sources\/search/);
  assert.match(app, /\/api\/import-sources\/download/);
  assert.match(app, /renderSetupPanel/);
  assert.match(app, /function renderSetupPanel/);
  assert.match(app, /resolvePrologueTemplate/);
  assert.match(app, /getCurrentPrologueGenre/);
  assert.match(app, /const candidates = \[\s*selectedPack,\s*visualContentPack,\s*sessionGenre,\s*cardGenre,/);
  assert.match(app, /startJourney/);
  assert.match(app, /\/prologue-template\.json/);
  assert.match(app, /data-destiny-card/);
  assert.match(app, /epic-setup-footer/);
  assert.match(app, /epic-seal-hint/);
  assert.match(app, /返回创作台/);
  assert.match(app, /PROLOGUE_RANDOM_POOLS/);
  assert.match(app, /generateSetupFieldValue/);
  assert.match(app, /getSetupRandomContext/);
  assert.match(app, /buildJourneyPrompt/);
  assert.match(app, /buildJourneyWorldbookSnapshot/);
  assert.match(app, /renderJourneyDraft/);
  assert.match(app, /state\.pendingJourneyDraft/);
  assert.doesNotMatch(app, /els\.chatInput\.value = promptText;\s*await sendMessage\(\);/);
  assert.doesNotMatch(app, /input\.value = randomFrom\(field\.rolls\)/);
  assert.match(html, /value="lingyi_tangyue"/);
  assert.match(html, /唐月（灵异女刑警线）/);
  assert.match(html, /value="mingmo_luyiniang"/);
  assert.match(html, /陆宜娘（明末商帮线）/);
  assert.match(html, /value="xuanhuan_lingshuang"/);
  assert.match(html, /凌霜（听雨楼暗桩线）/);
  assert.match(html, /value="xianxia_wenxuezhao"/);
  assert.match(html, /闻雪照（断魂灯旧案线）/);

  const css = await readFrontendCss();
  assert.match(css, /data-theme="soft"/);
  assert.match(css, /data-theme="cyber"/);
  assert.match(visualStage, /xianxia-stage\.png/);
  assert.match(css, /\.epic-destiny-grid/);
  assert.match(css, /\.epic-journey-row/);
  assert.match(css, /\.epic-journey-draft/);
});

test('imported Character Card portraits appear across preview, stories, opening and chat', async () => {
  const app = `${await readFile('public/app.js', 'utf8')}
${await readFile('public/modules/characterPresentation.js', 'utf8')}
${await readFile('public/modules/storyCatalog.js', 'utf8')}
${await readFile('public/modules/storyPackCard.js', 'utf8')}
${await readFile('public/modules/characterCard.js', 'utf8')}
${await readFile('public/modules/resourceImport.js', 'utf8')}
${await readFile('public/modules/resourceWorkbench.js', 'utf8')}
${await readFile('public/modules/messagePresentation.js', 'utf8')}`;
  const css = await readFrontendCss();

  assert.match(app, /function getCharacterPortraitUrl/);
  assert.match(app, /function createCharacterPortraitImage/);
  assert.match(app, /function getPendingImportPortraitDataUrl/);
  assert.match(app, /createCharacterPortraitImage\(\s*pack\.characterPortrait,\s*'story-card-portrait'/);
  assert.match(app, /resolveSpeakerCharacter\(state\.config, displaySpeaker\)/);
  assert.match(app, /createCharacterPortraitImage\(speakerCharacter, 'message-avatar'/);
  assert.match(app, /buildSpeakerPortraitMap\(state\.config\)/);
  assert.match(app, /createCharacterPortraitImage\(card, 'character-overview-portrait'/);
  assert.match(app, /className = 'import-character-portrait'/);
  assert.match(app, /sessionId: getCurrentSessionId\(\)/);

  assert.match(css, /\.story-card-portrait\s*\{/);
  assert.match(css, /\.epic-protagonist-portrait\s*\{/);
  assert.match(css, /\.message-avatar\s*\{/);
  assert.match(css, /\.character-overview-portrait\s*\{/);
  assert.match(css, /\.import-character-portrait\s*\{/);
  assert.match(css, /\.resource-item-portrait\s*\{/);
});

test('story bookshelf starts new projects before entering the guided opening', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = `${await readFile('public/app.js', 'utf8')}
${await readFile('public/modules/storyCatalog.js', 'utf8')}
${await readFile('public/modules/storyDeletion.js', 'utf8')}
${await readFile('public/modules/storyOpening.js', 'utf8')}
${await readFile('public/modules/journeySetup.js', 'utf8')}
${await readFile('public/modules/openingWorkflow.js', 'utf8')}
${await readFile('public/modules/appState.js', 'utf8')}
${await readFile('public/modules/customStoryBuilder.js', 'utf8')}
${await readFile('public/modules/resourceImport.js', 'utf8')}
${await readFile('public/modules/resourceWorkbench.js', 'utf8')}`;
  const css = await readFrontendCss();

  assert.match(html, /id="open-story-launcher"/);
  assert.match(html, /id="story-launcher"/);
  assert.match(html, /id="continue-last-story"/);
  assert.match(html, /id="delete-continue-story"[^>]+删除当前运行进度/);
  assert.match(html, /id="story-project-list"/);
  assert.match(html, /id="view-all-stories-btn"[^>]+aria-pressed="false"/);
  assert.match(html, /id="view-all-stories-label">查看全部故事/);
  assert.match(html, /id="story-pack-grid"/);
  assert.match(html, /id="story-category-filter"/);
  assert.match(html, /id="story-view-grid"/);
  assert.match(html, /id="story-view-list"/);
  assert.match(html, /id="open-story-custom-dialog"/);
  assert.match(html, /id="story-custom-dialog"/);
  assert.match(html, /id="close-story-custom-dialog"/);
  assert.match(html, /id="cancel-story-custom-dialog"/);
  assert.match(html, /id="story-custom-status"/);
  assert.match(html, /id="story-import-base"/);
  assert.match(html, /id="story-import-trigger"/);
  assert.match(html, /id="story-import-file"/);
  assert.match(html, /id="story-custom-title"/);
  assert.match(html, /id="story-custom-library-summary"/);
  assert.match(html, /先从素材库选择角色卡、世界书与预设/);
  assert.match(html, /素材库没有？导入/);
  assert.match(html, /data-story-import-kind="character"/);
  assert.match(html, /id="story-custom-character"/);
  assert.match(html, /id="story-custom-character-background"/);
  assert.match(html, /id="story-custom-character-background-preview"/);
  assert.match(html, /id="story-custom-worldbook-mode"/);
  assert.match(html, /id="story-custom-baseline-fields"/);
  assert.match(html, /id="story-custom-baseline-template"/);
  assert.match(html, /id="story-custom-premise"/);
  assert.match(html, /id="story-custom-worldbook-list"/);
  assert.match(html, /id="story-custom-prompt-list"/);
  assert.match(html, /id="story-custom-steps"/);
  assert.match(html, /data-story-custom-step="review"/);
  assert.match(html, /id="story-custom-stack-preview"/);
  assert.match(html, /id="story-custom-next"/);
  assert.match(html, /id="story-custom-prev"/);
  assert.match(html, /id="story-custom-checklist"/);
  assert.match(html, /id="story-custom-conflicts"/);
  assert.match(html, /id="story-custom-create"/);
  assert.match(html, /id="story-edit-dialog"/);
  assert.match(html, /id="story-edit-form"/);
  assert.match(html, /创建自定义剧本/);
  assert.match(html, /id="open-advanced-session"/);
  assert.match(html, /选择世界与规则，或回到已经开始的故事/);
  assert.doesNotMatch(html, /LOCAL STORY ENGINE|NEW STORY|STEP 01/);
  assert.ok(
    html.indexOf('id="story-pack-grid"') < html.indexOf('id="open-story-custom-dialog"'),
    'the installed script catalog should appear before the custom story entry'
  );
  assert.ok(
    html.indexOf('id="open-story-custom-dialog"') < html.indexOf('id="story-custom-dialog"'),
    'the custom builder should live in a separate dialog after its launcher entry'
  );

  assert.match(app, /storyProjects:\s*'\/api\/story-projects'/);
  assert.match(app, /function renderStoryPackGrid/);
  assert.match(app, /function renderStoryCatalogFilters/);
  assert.match(app, /function setStoryCatalogView/);
  assert.match(app, /function renderStoryProjects/);
  assert.match(app, /function renderStoryImportBaseOptions/);
  assert.match(app, /function renderCustomStoryBuilder/);
  assert.match(app, /function setCustomStoryStep/);
  assert.match(app, /function renderCustomStoryStackPreview/);
  assert.match(app, /function renderCustomBaselineEditor/);
  assert.match(app, /function getCompanionWorldBooks/);
  assert.match(app, /function scheduleCustomStoryInspection/);
  assert.match(app, new RegExp('/api/resource-library/packs/inspect'));
  assert.match(app, /function openCustomStoryDialog/);
  assert.match(app, /function closeCustomStoryDialog/);
  assert.match(app, /function getCustomStoryReadiness/);
  assert.match(app, /async function createCustomStoryFromDraft/);
  assert.match(app, /intent: 'create-story'/);
  assert.match(app, /function stageStoryResourcesFromCommittedImport/);
  assert.match(app, /async function createStoryFromCommittedImport/);
  assert.match(app, /worldBookResourceIds: worldBooks\.map/);
  assert.match(app, /promptResourceIds: prompts\.map/);
  assert.match(app, /includeBaseContent: draft\.creationMode !== STORY_IMPORT_MODES\.INDEPENDENT/);
  assert.match(app, /function createStoryImportRouteSection/);
  assert.match(css, /\.import-story-route-choices\s*\{/);
  assert.match(app, /async function startStoryFromPack/);
  assert.match(app, /\/api\/story-projects\/\$\{encodeURIComponent\(projectPayload\.project\.id\)\}\/sessions/);
  assert.match(app, /async function continueStoryProject/);
  assert.match(app, /function openStoryEditDialog/);
  assert.match(app, /async function saveStoryEdit/);
  assert.match(app, /async function deleteStoryProject/);
  assert.match(app, /async function deleteStoryPack/);
  assert.match(app, /dataset\.editStoryProject/);
  assert.match(app, /dataset\.deleteStoryPack/);
  assert.match(app, /initializeStoryLauncherVisibility/);
  assert.match(app, /backgroundImage: stageBackground\?\.url/);
  assert.match(app, /boundPack\?\.custom === true[\s\S]*boundPack\.openingTemplate/);
  assert.match(app, /Array\.isArray\(field\?\.values\)[\s\S]*return randomFrom\(scopedValues\)/);
  assert.match(app, /const fieldDefault = String\(field\?\.defaultValue \|\| ''\)\.trim\(\)/);

  assert.match(css, /\.story-launcher\s*\{/);
  assert.match(css, /\.story-launcher-layout\s*\{[\s\S]*grid-template-columns:/);
  assert.match(css, /\.story-pack-grid\s*\{[\s\S]*overflow-y:\s*auto/);
  assert.match(css, /\.story-project-item:hover\s*\{\s*border-color:\s*var\(--accent\);\s*\}\s*\.story-project-copy\s*\{/);
  assert.match(css, /\.story-pack-grid\.is-list-view \.story-card-body\s*\{[\s\S]*background:\s*var\(--panel-raised\)/);
  assert.match(css, /\.story-custom-builder\s*\{[\s\S]*grid-template-columns:/);
  assert.match(css, /\.story-custom-steps\s*\{[\s\S]*grid-template-columns:/);
  assert.match(css, /\.story-custom-step-panel\[hidden\]\s*\{[\s\S]*display:\s*none/);
  assert.match(css, /\.story-custom-stack-preview\s*\{/);
  assert.match(css, /\.story-custom-entry\s*\{/);
  assert.match(css, /\.story-custom-dialog\s*\{/);
  assert.match(css, /\.story-custom-dialog::backdrop\s*\{/);
  assert.match(css, /\.story-custom-dialog-body\s*\{[\s\S]*overflow-y:\s*auto/);
  assert.match(css, /\.story-custom-readiness\s*\{/);
  assert.match(css, /\.story-custom-baseline-fields\s*\{/);
  assert.match(css, /\.story-character-background-option\s*\{/);
  assert.match(css, /\.story-custom-conflicts\s*\{/);
  assert.match(css, /\.story-custom-library-summary\s*\{/);
  assert.match(css, /\.story-category-filter\s*\{/);
  assert.match(css, /\.story-pack-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.story-pack-grid\.is-list-view\s*\{[\s\S]*grid-template-columns:\s*1fr/);
  assert.match(css, /\.story-script-card\s*\{[\s\S]*background-image:\s*var\(--story-card-image\)/);
  assert.match(css, /\.story-project-actions\s*\{/);
  assert.match(css, /\.story-project-actions\s*\{[\s\S]*white-space:\s*nowrap/);
  assert.match(css, /\.story-project-item\s*\{[\s\S]*grid-template-columns:\s*48px minmax\(0, 1fr\) auto/);
  assert.match(css, /\.story-launcher\.is-project-library-view \.story-project-list\s*\{[\s\S]*grid-template-columns:/);
  assert.match(css, /\.story-card-manage\s*\{/);
  assert.match(css, /\.story-edit-dialog\s*\{/);
  assert.match(css, /@media \(max-width: 820px\)[\s\S]*\.story-launcher\s*\{[\s\S]*overflow-y:\s*auto/);
  assert.match(css, /@media \(max-width: 820px\)[\s\S]*\.story-pack-grid\s*\{[\s\S]*overflow:\s*visible/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*\.story-pack-grid\s*\{[\s\S]*grid-template-columns:\s*1fr/);
});

test('empty story sessions enter a focused opening stage before the first message', async () => {
  const app = await readFile('public/modules/chat.js', 'utf8');
  const css = await readFrontendCss();

  assert.match(app, /const openingFocus = messages\.length === 0 && !state\.pendingJourneyDraft/);
  assert.match(app, /document\.body\.classList\.toggle\('story-opening-focus', openingFocus\)/);
  assert.match(css, /body\.story-opening-focus \.provider-panel/);
  assert.match(css, /body\.story-opening-focus \.immersive-right-sidebar/);
  assert.match(css, /body\.story-opening-focus \.chat-header-overlay/);
  assert.match(css, /body\.story-opening-focus \.composer/);
  assert.match(css, /body\.story-opening-focus \.messages\.has-cover-page/);
});

test('prologue templates are genre-aware and include destiny cards', async () => {
  const template = JSON.parse(await readFile('public/prologue-template.json', 'utf8'));
  const app = `${await readFile('public/app.js', 'utf8')}
${await readFile('public/modules/openingWorkflow.js', 'utf8')}`;

  assert.deepEqual(Object.keys(template.genres).sort(), ['lingyi', 'mingmo', 'xianxia', 'xuanhuan', 'yingxiongzhi']);
  assert.equal('themeGenreMap' in template, false);
  assert.equal('themes' in template, false);
  assert.doesNotMatch(app, /themeFallback|themeGenreMap|currentTheme/);

  for (const genre of ['xuanhuan', 'lingyi', 'mingmo', 'xianxia', 'yingxiongzhi']) {
    const tpl = template.genres[genre];
    assert.ok(tpl.title);
    assert.ok(tpl.tabs.worldSetting);
    assert.ok(tpl.tabs.rules);
    assert.ok(tpl.tabs.currentCrisis);
    assert.equal(Object.keys(tpl.fields).length >= 10, true);
    assert.equal(tpl.destinyCards.cards.length >= 8, true);
    assert.match(tpl.tabs.worldSetting.content, /【/);
    assert.match(tpl.tabs.rules.content, /【/);
    assert.match(tpl.tabs.currentCrisis.content, /【/);
  }

  assert.match(JSON.stringify(template.genres.lingyi), /死亡倒计时|禁忌标记|微笑命案/);
  assert.match(JSON.stringify(template.genres.mingmo), /密诏残页|银粮危机|崇祯末年/);
  assert.match(JSON.stringify(template.genres.xuanhuan), /雁回关|天机榜|秘境/);
  assert.match(JSON.stringify(template.genres.xianxia), /天命榜|本命神通|功法品阶/);
  assert.match(JSON.stringify(template.genres.yingxiongzhi), /乱世文章|三重旧账|信息隔离/);
});

test('reading modes are device preferences while chat backgrounds remain story-owned', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = `${await readFile('public/app.js', 'utf8')}
${await readFile('public/modules/contentPack.js', 'utf8')}
${await readFile('public/modules/openingWorkflow.js', 'utf8')}
${await readFile('public/modules/appState.js', 'utf8')}
${await readFile('public/modules/appEvents.js', 'utf8')}`;
  const visualStage = await readFile('public/modules/visualStage.js', 'utf8');
  const css = await readFrontendCss();

  assert.match(html, /id="background-mode"/);
  assert.match(html, /id="background-status"/);
  assert.match(html, /舞台背景：未设置/);
  assert.match(html, /阅读模式独立于剧本，剧本只提供舞台背景/);
  assert.match(html, /aria-label="阅读模式"/);
  assert.match(html, /清除背景/);
  assert.match(visualStage, /url:\s*'\/assets\/xuanhuan-luoyan-stage\.png'/);
  assert.match(visualStage, /url:\s*'\/assets\/lingyi-yongan-stage\.png'/);
  assert.match(visualStage, /url:\s*'\/assets\/mingmo-chongzhen-stage\.png'/);
  assert.match(visualStage, /url:\s*'\/assets\/wuxia-stage\.png'/);
  assert.match(visualStage, /url:\s*'\/assets\/xianxia-stage\.png'/);
  assert.match(visualStage, /CONTENT_PACK_VISUAL_PRESETS/);
  assert.match(visualStage, /xuanhuan:\s*\{[\s\S]*backgroundImage:\s*'\/assets\/xuanhuan-luoyan-stage\.png'/);
  assert.match(visualStage, /lingyi:\s*\{[\s\S]*backgroundImage:\s*'\/assets\/lingyi-yongan-stage\.png'/);
  assert.match(visualStage, /mingmo:\s*\{[\s\S]*backgroundImage:\s*'\/assets\/mingmo-chongzhen-stage\.png'/);
  assert.match(visualStage, /xianxia:\s*\{[\s\S]*backgroundImage:\s*'\/assets\/xianxia-stage\.png'/);
  assert.match(visualStage, /AVAILABLE_THEMES = \['eye-care', 'dark', 'bright', 'soft', 'modern', 'cyber'\]/);
  assert.match(visualStage, /'default-dark': 'dark'/);
  assert.doesNotMatch(visualStage.match(/CONTENT_PACK_VISUAL_PRESETS = \{[\s\S]*?\n\};/)?.[0] || '', /theme:/);
  assert.match(app, /function linkContentPackVisuals/);
  assert.match(app, /function handleContentPackSelectionChange/);
  assert.match(app, /正在同步规则、世界书、角色卡和舞台背景/);
  assert.match(app, /const payload = await applyContentPack\(\)/);
  assert.match(app, /contentPackControls\.hidden = Boolean\(state\.session\?\.storyProjectId\)/);
  assert.match(app, /visualContentPack/);
  assert.match(visualStage, /function normalizeBackgroundUrlForMatch/);
  assert.match(visualStage, /function backgroundUrlsMatch/);
  assert.match(visualStage, /getBackgroundLabelForUrl/);
  assert.match(app, /els\.contentPackSelect\?\.addEventListener\('change', \(\) => handleContentPackSelectionChange\(\)\)/);
  assert.match(app, /bind\(els\.themeSelect, 'change', \(\) => call\(actions\.saveReadingMode, els\.themeSelect\.value\)\)/);
  assert.match(app, /function syncSessionVisualState/);
  assert.match(app, /const visualContentPack = state\.session\?\.settings\?\.visualContentPack/);
  assert.match(app, /const candidates = \[\s*selectedPack,\s*visualContentPack,\s*sessionGenre/);
  assert.match(app, /const stageBackground = getStoryStageBackground\(payload\.appliedPack\)/);
  assert.match(app, /const visualPreset = await linkContentPackVisuals\(visualPackId, \{[\s\S]*backgroundImage: stageBackground\?\.url[\s\S]*backgroundFit: stageBackground\?\.fit[\s\S]*backgroundSource: stageBackground\?\.source/);
  assert.match(app, /已应用到会话：\$\{payload\.appliedPack\?\.title \|\| packId\} · 舞台背景：\$\{visualPreset\.label\}/);
  assert.match(visualStage, /preset\.url\s*\|\|/);
  assert.match(visualStage, /updateBackgroundModeUi/);
  assert.match(visualStage, /舞台背景：未设置/);
  assert.match(visualStage, /自定义舞台背景/);
  assert.match(visualStage, /舞台背景：\$\{label \|\| '自定义'\}/);
  assert.match(css, /var\(--chat-bg-image,\s*linear-gradient/);
  assert.match(visualStage, /classList\.toggle\('has-stage-background',\s*Boolean\(bg\)\)/);
  assert.match(css, /\.chat-panel\.has-stage-background\s*\{[\s\S]*var\(--chat-bg-image\);/);
  assert.match(css, /\.chat-panel\.has-stage-background::after\s*\{[\s\S]*mix-blend-mode:\s*normal;/);
  assert.match(css, /\.chat-panel\.has-stage-background \.message\.assistant,[\s\S]*backdrop-filter:\s*none;/);
  assert.match(css, /\.chat-panel\.background-fit-portrait\s*\{/);
  assert.doesNotMatch(css, /var\(--chat-bg-image,\s*url\('\/assets\/wuxia-stage\.png'\)\)/);
  assert.doesNotMatch(css, /var\(--chat-bg-image,\s*url\('\/assets\/xianxia-stage\.png'\)\)/);
  assert.doesNotMatch(css, /data-theme="(?:eye-care|dark|bright|soft|modern|cyber)"[^}]*url\(['"]?\/assets\//);
  assert.doesNotMatch(css, /\.chat-panel::before\s*\{[\s\S]*background-image:\s*var\(--chat-bg-image,\s*none\);/);
  assert.match(css, /grid-template-rows:\s*minmax\(320px,\s*45vh\)\s*minmax\(0,\s*1fr\);/);
  assert.match(css, /\.provider-scroll\s*\{[\s\S]*overflow-y:\s*auto;/);
});

test('v0.2 resource workbench keeps community imports, diagnostics and script composition in one adaptive panel', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = `${await readFile('public/app.js', 'utf8')}
${await readFile('public/modules/resourceImport.js', 'utf8')}
${await readFile('public/modules/resourceWorkbench.js', 'utf8')}
${await readFile('public/modules/pluginRegistry.js', 'utf8')}
${await readFile('public/modules/contentPack.js', 'utf8')}`;
  const css = await readFrontendCss();

  assert.match(html, /data-tab="sources"[^>]*>资源库</);
  assert.match(html, /data-resource-view="library"/);
  assert.match(html, /data-resource-view="online"/);
  assert.match(html, /data-resource-view="composer"/);
  assert.match(html, /id="resource-pack-form"/);
  assert.match(html, /id="resource-pack-worldbooks"/);
  assert.match(html, /id="resource-pack-prompts"/);
  assert.match(html, /class="resource-flow"/);
  assert.match(html, /id="import-review-dialog"/);
  assert.match(html, /id="import-apply-current"/);
  assert.match(html, /只存入素材库，不改变正在写的剧本/);
  assert.match(app, /\/api\/resource-library\/resources/);
  assert.match(app, /\/api\/resource-library\/packs/);
  assert.match(app, /function renderResourceWorkbench/);
  assert.match(app, /function createResourcePack/);
  assert.match(app, /preview\.inspection/);
  assert.match(app, /applyToActiveConfig/);
  assert.match(app, /function createImportResourceReport/);
  assert.match(app, /payload\.appliedPack\?\.visualPackId \|\| packId/);
  assert.match(css, /\.inspector-panel\.resource-workbench-open:not\(\.collapsed\)\s*\{[\s\S]*width:\s*420px/);
  assert.match(css, /\.resource-view\s*\{[\s\S]*min-height:\s*0;[\s\S]*overflow:\s*hidden/);
  assert.match(css, /\.resource-library-list[\s\S]*overflow-y:\s*auto/);
  assert.match(css, /\.import-review-dialog/);
  assert.match(css, /\.import-dimension-list/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.inspector-panel\.resource-workbench-open:not\(\.collapsed\)[\s\S]*width:\s*auto/);
});

test('v0.2.2 exposes versioned content packs and declarative plugin adapters in the resource workbench', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = `${await readFile('public/app.js', 'utf8')}
${await readFile('public/modules/resourceImport.js', 'utf8')}
${await readFile('public/modules/resourceWorkbench.js', 'utf8')}
${await readFile('public/modules/pluginRegistry.js', 'utf8')}
${await readFile('public/modules/appState.js', 'utf8')}`;
  const compatibility = await readFile('public/modules/importCompatibility.js', 'utf8');
  const css = await readFrontendCss();

  assert.match(html, /data-resource-view="extensions"/);
  assert.match(html, /data-resource-pane="extensions"/);
  assert.match(html, /id="plugin-manifest-import"/);
  assert.match(html, /id="plugin-list"/);
  assert.match(html, /id="adapter-list"/);
  assert.match(html, /声明式插件注册表/);
  assert.match(html, /id="import-apply-option"/);

  assert.match(app, /apiRequest\('\/api\/plugins'\)/);
  assert.match(app, /plugins:\s*'\/api\/plugins'/);
  assert.match(app, /function renderPluginRegistry/);
  assert.match(app, /function renderAdapterRegistry/);
  assert.match(app, /function handlePluginRegistryClick/);
  assert.match(app, /data-plugin-toggle/);
  assert.match(app, /data-plugin-delete/);
  assert.match(app, /data-resource-pack-export/);
  assert.match(app, /\/api\/content-packs\/\$\{encodeURIComponent\(packId\)\}\/export/);
  assert.match(app, /isPackageImportKind/);
  assert.match(app, /kind === 'plugin-manifest'/);
  assert.match(app, /kind === 'content-pack'/);
  assert.match(app, /安装适配插件/);
  assert.match(app, /安装内容包/);
  assert.match(app, /importApplyOption\.hidden = isPackageImport/);
  assert.match(app, /className = 'import-dependency-list'/);
  assert.match(app, /createCommunityCompatibilitySection/);
  assert.match(app, /communityCompatibility\.label/);
  assert.match(compatibility, /完整映射/);
  assert.match(compatibility, /安全降级/);
  assert.match(compatibility, /阻断运行/);
  assert.match(compatibility, /acceptance\?\.blockers/);

  assert.match(css, /\.resource-view-switch\s*\{[\s\S]*grid-template-columns:\s*repeat\(4,/);
  assert.match(css, /\.resource-extensions\s*\{/);
  assert.match(css, /\.plugin-registry-item\s*\{/);
  assert.match(css, /\.adapter-registry-row\s*\{/);
  assert.match(css, /\.import-dependency-list\s*\{/);
  assert.match(css, /\.import-community-compatibility\s*\{/);
  assert.match(css, /\.import-community-item\s*\{/);
  assert.match(css, /\.import-community-playability\.is-safe-degradation\s*\{/);
  assert.match(css, /\.import-community-playability\.is-blocked\s*\{/);
  assert.match(css, /\.import-apply-option\[hidden\]\s*\{[\s\S]*display:\s*none;/);
});

test('provider configuration uses an internal scroll body for expandable tools', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = `${await readFile('public/app.js', 'utf8')}
${await readFile('public/modules/appEvents.js', 'utf8')}`;
  const workspace = await readFile('public/modules/workspace.js', 'utf8');
  const css = await readFrontendCss();

  assert.match(html, /<div class="provider-scroll">[\s\S]*<form id="provider-form" class="form-grid">/);
  assert.match(html, /<aside id="provider-panel" class="panel provider-panel collapsed"/);
  assert.match(html, /id="open-provider-panel"/);
  assert.match(html, /展开接口配置/);
  assert.match(html, /aria-controls="provider-panel" aria-expanded="false"/);
  assert.match(html, /id="inspector-panel" class="panel inspector-panel collapsed"/);
  assert.match(html, /aria-controls="inspector-panel" aria-expanded="false"/);
  assert.match(html, /<details id="mcp-panel" class="provider-tool-panel"/);
  assert.match(html, /id="provider-reasoning-mode"[\s\S]*自动 · 显式思维链预设时关闭/);
  assert.match(html, /仅对 DeepSeek 官方 OpenAI 接口生效/);
  assert.match(html, /<\/details>\s*<\/div>\s*<\/aside>\s*<section class="panel chat-panel"/);

  assert.match(workspace, /function setWorkspacePanelExpanded/);
  assert.match(app, /call\(actions\.setWorkspacePanelExpanded, 'provider', true\)/);
  assert.match(app, /call\(actions\.setWorkspacePanelExpanded, 'provider', false\)/);
  assert.match(app, /call\(actions\.setWorkspacePanelExpanded, 'inspector', true\)/);
  assert.match(app, /call\(actions\.setWorkspacePanelExpanded, 'inspector', false\)/);
  assert.match(app, /call\(actions\.setWorkspaceActiveView, 'chat'\)/);
  assert.match(app, /button\.dataset\.mobileView === 'provider'[\s\S]*call\(actions\.setWorkspacePanelExpanded, 'provider', true\)/);
  assert.match(app, /button\.dataset\.mobileView === 'inspector'[\s\S]*call\(actions\.setWorkspacePanelExpanded, 'inspector', true\)/);

  assert.match(css, /\.provider-scroll\s*\{[\s\S]*overflow-y:\s*auto;/);
  assert.match(css, /\.provider-scroll\s*>\s*details\[open\]\s*\{[\s\S]*max-height:\s*min\(430px,\s*70vh\);/);
  assert.match(css, /@media \(max-width:\s*1180px\)[\s\S]*\.provider-scroll\s*>\s*details\[open\]\s*\{[\s\S]*max-height:\s*min\(270px,\s*48vh\);/);
  assert.doesNotMatch(css, /\.provider-panel\s*\.form-grid\s*\{[^}]*overflow:\s*visible;/);
  assert.match(css, /\.provider-panel\.collapsed,[\s\S]*\.inspector-panel\.collapsed\s*\{[\s\S]*width:\s*48px;[\s\S]*min-width:\s*48px;/);
  assert.match(css, /\.collapsed-rail-button\s*\{[\s\S]*display:\s*none;/);
  assert.match(css, /\.panel\.collapsed\s*>\s*\*:not\(\.collapsed-rail-button\)\s*\{[\s\S]*visibility:\s*hidden;/);
  assert.match(css, /\.panel\.collapsed\s+\.collapsed-rail-button\s*\{[\s\S]*display:\s*flex;[\s\S]*width:\s*100%;/);
  assert.match(css, /\.panel\.collapsed\s+\.collapsed-rail-button svg\s*\{[\s\S]*width:\s*32px;[\s\S]*height:\s*32px;/);
  assert.match(css, /@media \(max-width:\s*900px\)[\s\S]*\.provider-panel\.collapsed,[\s\S]*\.inspector-panel\.collapsed\s*\{[\s\S]*width:\s*auto;[\s\S]*min-width:\s*0;/);
});

test('world book inspector editor keeps long entry lists scrollable', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const css = await readFrontendCss();
  const app = await readFile('public/modules/inspector.js', 'utf8');

  assert.match(html, /<section class="tab-pane worldbook-pane" data-pane="worldbook"/);
  assert.match(html, /id="worldbook-entries-panel" class="worldbook-entries-panel" open/);
  assert.match(html, /class="advanced-data-panel worldbook-advanced-panel"/);
  assert.match(html, /高级 JSON 与导入导出/);
  assert.match(css, /\.worldbook-pane\s*\{[\s\S]*overflow-y:\s*auto;[\s\S]*scrollbar-gutter:\s*stable;/);
  assert.match(css, /\.worldbook-entries-list\s*\{[\s\S]*max-height:\s*min\(420px,\s*52vh\);[\s\S]*overflow-y:\s*auto;/);
  assert.match(css, /\.wb-editor-dialog\s*\{[\s\S]*display:\s*flex;[\s\S]*overflow:\s*hidden;/);
  assert.match(css, /\.wb-editor-body\s*\{[\s\S]*overflow-y:\s*auto;/);
  assert.match(css, /\.wb-editor-actions\s*\{[\s\S]*position:\s*sticky;/);
  assert.match(app, /body\.className = 'wb-editor-body';/);
  assert.match(app, /actions\.className = 'wb-editor-actions';/);
});

test('world book browser groups large lore libraries with search and readable previews', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const entry = await readFile('public/app.js', 'utf8');
  const app = `${entry}\n${await readFile('public/modules/inspector.js', 'utf8')}\n${await readFile('public/modules/worldbookWorkspace.js', 'utf8')}`;
  const css = await readFrontendCss();

  assert.match(html, /id="worldbook-search"/);
  assert.match(html, /id="worldbook-type-filter"/);
  assert.match(html, /id="worldbook-browser-count"/);
  assert.match(html, /世界圣经浏览与编辑/);
  assert.match(app, /const WORLD_BOOK_TYPE_LABELS =/);
  assert.match(app, /function createEntryRow/);
  assert.match(app, /function syncTypeFilter/);
  assert.match(app, /worldbookSearch\?\.addEventListener\('input', renderWorldbookEntries\)/);
  assert.match(app, /worldbookTypeFilter\?\.addEventListener\('change', renderWorldbookEntries\)/);
  assert.match(css, /\.worldbook-browser-toolbar\s*\{/);
  assert.match(css, /\.worldbook-entry-group-summary\s*\{/);
  assert.match(css, /\.immersive-worldbook-card-preview\s*\{/);
  assert.match(css, /-webkit-line-clamp:\s*4/);
});

test('inspector controls stay usable in narrow drawers', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const entry = await readFile('public/app.js', 'utf8');
  const app = `${entry}
${await readFile('public/modules/appEvents.js', 'utf8')}
${await readFile('public/modules/inspector.js', 'utf8')}`;
  const css = await readFrontendCss();

  assert.match(html, /<details class="group-section inspector-subsection">/);
  assert.match(html, /id="inspector-tab-select"/);
  assert.doesNotMatch(html, /class="preset-controls" style="[^"]*display:\s*flex/);
  assert.match(css, /\.inspector-panel\s+\.tab-pane\s*\{[\s\S]*overflow-y:\s*auto;[\s\S]*scrollbar-gutter:\s*stable;/);
  assert.match(css, /\.tabs\s*\{[\s\S]*display:\s*flex;[\s\S]*overflow-x:\s*auto;/);
  assert.match(css, /\.tab-button\s*\{[\s\S]*flex:\s*0\s+0\s+auto;/);
  assert.match(css, /\.preset-controls\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto;/);
  assert.match(css, /#character-card-editor,\s*#worldbook-editor,\s*#prompt-editor\s*\{[\s\S]*flex:\s*0\s+0\s+clamp\(180px,\s*32vh,\s*340px\);/);
  assert.match(css, /\.editor-actions\s+\.status-text:empty\s*\{[\s\S]*display:\s*none;/);
  assert.match(css, /\.inspector-subsection\s*\{[\s\S]*margin-top:\s*12px;/);
  assert.match(app, /bind\(els\.openProviderPanel, 'click', \(\) => call\(actions\.setWorkspacePanelExpanded, 'provider', true\)\)/);
  assert.match(app, /bind\(els\.toggleInspectorPanel, 'click', \(\) => call\(actions\.setWorkspacePanelExpanded, 'inspector', false\)\)/);
  assert.match(app, /button\.addEventListener\('click', \(\) => activateTab\(button\.dataset\.tab\)\)/);
  assert.match(app, /function syncInspectorTabSelect/);
  assert.match(app, /tabSelect\?\.addEventListener\('change'/);
  assert.match(app, /panel\?\.querySelectorAll\('\.tab-button\[data-tab\]'\)/);
  assert.match(app, /panel\?\.querySelectorAll\('\.tab-pane\[data-pane\]'\)/);
  assert.match(app, /pane\.hidden = !active/);
  assert.match(app, /button\.tabIndex = active \? 0 : -1/);
});

test('modern workbench composer keeps tools in compact editor flow', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = await readFile('public/app.js', 'utf8');
  const chat = await readFile('public/modules/chat.js', 'utf8');
  const composer = await readFile('public/modules/composer.js', 'utf8');
  const composerActionMenus = await readFile('public/modules/composerActionMenus.js', 'utf8');
  const conversationStream = await readFile('public/modules/conversationStream.js', 'utf8');
  const conversationActions = await readFile('public/modules/conversationActions.js', 'utf8');
  const css = await readFrontendCss();

  assert.match(html, /<div class="composer">/);
  assert.match(html, /class="composer-command-rail"[\s\S]*id="quick-replies-bar"[\s\S]*class="stage-actions"/);
  assert.match(html, /class="stage-actions"/);
  assert.equal((html.match(/data-composer-menu/g) || []).length, 2);
  assert.match(html, /<summary class="composer-menu-trigger">创作工具<\/summary>/);
  assert.match(html, /<summary class="composer-menu-trigger">显示<\/summary>/);
  assert.match(html, /data-tab-shortcut="health"[^>]*>兼容状态<\/button>/);
  assert.match(html, /aria-label="导演控制"[\s\S]*id="target-speaker-btn"[\s\S]*id="toggle-author-note"/);
  assert.match(html, /aria-label="文本处理"[\s\S]*id="continue-message"[\s\S]*id="rewrite-chat-input"[\s\S]*data-action-template=/);
  assert.match(html, /id="send-message" class="send-button"/);
  assert.doesNotMatch(css, /--quick-replies-block:/);
  assert.match(css, /\.composer\s*\{[\s\S]*position:\s*relative;[\s\S]*z-index:\s*3;/);
  assert.match(css, /\.composer-command-rail\s*\{[^}]*overflow:\s*visible;/);
  assert.match(css, /\.composer-command-rail \.quick-replies-bar\s*\{[^}]*overflow-x:\s*auto;/);
  assert.match(css, /\.stage-actions\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*overflow:\s*visible;/);
  assert.match(css, /\.composer-menu-panel\s*\{[^}]*position:\s*fixed;/);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*\.composer-menu-panel\s*\{[\s\S]*animation:\s*none;/);
  assert.match(composer, /createComposerActionMenusController/);
  assert.match(composerActionMenus, /function bindEvents/);
  assert.match(composerActionMenus, /function positionMenu/);
  assert.match(composerActionMenus, /Math\.min\(Math\.max\(gutter, preferredLeft\), maxLeft\)/);
  assert.match(composerActionMenus, /containingLeftOffset/);
  assert.match(composerActionMenus, /containingBottomOffset/);
  assert.match(composerActionMenus, /requestAnimationFrame/);
  assert.match(composerActionMenus, /event\.key !== 'Escape'/);
  assert.match(css, /\.quick-replies-bar\s*\{[\s\S]*flex-wrap:\s*nowrap;[\s\S]*overflow-x:\s*auto;/);
  assert.match(css, /\.chat-form\s*\{[\s\S]*display:\s*flex;[\s\S]*align-items:\s*flex-end;/);
  assert.match(css, /\.send-button\s*\{[\s\S]*position:\s*absolute;[\s\S]*border-radius:\s*50%;/);
  assert.match(composer, /state\.chatStreaming = Boolean\(streaming\)/);
  assert.match(composer, /els\.sendMessageButton\.disabled = !availability\.canSend/);
  assert.match(composer, /els\.chatInput\.disabled = availability\.actionPending/);
  assert.match(composer, /els\.chatInput\?\.addEventListener\('keydown'/);
  assert.match(composer, /function shouldSubmitChatInput/);
  assert.match(composer, /!event\.shiftKey/);
  assert.match(composer, /!event\.isComposing/);
  assert.match(composer, /event\.keyCode !== 229/);
  assert.match(composer, /els\.chatForm\?\.requestSubmit\(\)/);
  assert.match(composer, /canRepairFormat: hasAssistantReply && !busy/);
  assert.match(composer, /autoButton\.onclick =/);
  assert.match(conversationActions, /function isSilentQuickReply/);
  assert.match(conversationStream, /hideUserMessage/);
  assert.match(chat, /shouldHideAuxiliaryMessage\(message, messages\[index \+ 1\]\)/);
  assert.match(chat, /function captureScrollState/);
  assert.match(chat, /function restoreScrollState/);
  assert.match(chat, /autoFollowLatest = isNearBottom\(\)/);
  assert.match(css, /\.messages\s*\{[\s\S]*overflow-anchor:\s*none;/);
});

test('empty session cover guides opening flow through content packs', async () => {
  const entry = await readFile('public/app.js', 'utf8');
  const app = `${entry}\n${await readFile('public/modules/chat.js', 'utf8')}\n${await readFile('public/modules/utils.js', 'utf8')}\n${await readFile('public/modules/storyOpening.js', 'utf8')}\n${await readFile('public/modules/openingWorkflow.js', 'utf8')}\n${await readFile('public/modules/journeySetup.js', 'utf8')}\n${await readFile('public/modules/journeyDraft.js', 'utf8')}\n${await readFile('public/modules/contentPack.js', 'utf8')}`;
  const css = await readFrontendCss();

  assert.match(app, /OPENING_GENRE_OPTIONS/);
  assert.match(app, /function setOpeningGenre/);
  assert.match(app, /function renderOpeningWorkflow/);
  assert.match(app, /function startGuidedJourney/);
  assert.match(app, /className = 'epic-start-flow'/);
  assert.match(app, /classList\.add\('has-cover-page'\)/);
  assert.match(app, /className = 'epic-cover-actions'/);
  assert.match(app, /className = 'epic-current-script'/);
  assert.match(app, /className = 'epic-opening-error'/);
  assert.match(app, /function createOpeningErrorPanel/);
  assert.match(app, /function renderJourneyDraft\(draft\)[\s\S]*createOpeningErrorPanel\(\)/);
  assert.match(app, /PROVIDER_QUOTA_EXHAUSTED/);
  assert.match(css, /\.epic-opening-error\s*\{/);
  assert.match(app, /function getBoundStoryPackId/);
  assert.match(app, /await applyContentPack\(\)/);
  assert.match(app, /renderSetupPanel\(resolvePrologueTemplate\(\)\.tpl\)/);
  assert.match(css, /\.messages\.has-cover-page\s*\{[\s\S]*padding-bottom:\s*clamp\(74px,\s*10vh,\s*112px\);/);
  assert.match(css, /\.messages\.has-cover-page\s+\.epic-cover-page\s*\{[^}]*height:\s*auto;/);
  assert.match(css, /\.messages\.has-cover-page\s+\.epic-cover-page\s*\{[^}]*max-height:\s*min\(640px,\s*calc\(100%\s*-\s*8px\)\);/);
  assert.match(css, /\.messages\.has-cover-page\s+\.epic-cover-page\s*\{[^}]*overflow-y:\s*auto;/);
  assert.match(css, /\.epic-start-flow\s*\{[^}]*flex:\s*0 0 auto;[^}]*min-height:\s*0;[^}]*overflow:\s*visible;/);
  assert.doesNotMatch(css, /calc\(100vh\s*-\s*270px\)/);
  assert.match(css, /\.epic-cover-actions\s*\{[^}]*position:\s*relative;/);
  assert.doesNotMatch(css, /\.epic-cover-actions\s*\{[^}]*position:\s*sticky;/);
  assert.match(css, /\.epic-start-flow\s*\{/);
  assert.match(css, /\.epic-flow-steps\s*\{/);
  assert.match(css, /\.epic-flow-status\s*\{[\s\S]*display:\s*none;/);
  assert.match(css, /\.epic-current-script\s*\{/);
  assert.match(css, /\.epic-current-script-stats\s*\{/);
  assert.doesNotMatch(css, /\.epic-genre-grid\s*\{/);
});

test('guided opening fuses a script dossier with protagonist and optional opening elements', async () => {
  const app = `${await readFile('public/app.js', 'utf8')}\n${await readFile('public/modules/journeySetup.js', 'utf8')}\n${await readFile('public/modules/journeyDraft.js', 'utf8')}`;
  const css = await readFrontendCss();

  assert.match(app, /function appendDossierContent/);
  assert.match(app, /\{ key: 'dossier', label: '开局卷宗', step: '01' \}/);
  assert.match(app, /\{ key: 'protagonist', label: customOpening \? '主角确认' : '主角塑成', step: '02' \}/);
  assert.match(app, /destinyCards\.length[\s\S]*\{ key: 'destiny', label: choiceStepLabel, step: '03' \}/);
  assert.match(app, /buildJourneyWorldbookSnapshot\(6\)/);
  assert.match(app, /epic-dossier-worldbook/);
  assert.match(app, /maxDestinySelections/);
  assert.match(app, /collectSelectedDestinyCards\(\)\.length > maxDestinySelections/);
  assert.match(app, /activatePane\('dossier'\)/);
  assert.match(app, /sealButton\.addEventListener\('click', finishJourney\)/);
  assert.match(app, /\$\{choiceCounterLabel\} \$\{selectedDestiny\}\/\$\{maxDestinySelections\}/);

  assert.match(css, /\.epic-dossier-grid\s*\{/);
  assert.match(css, /\.epic-dossier-section\s*\{/);
  assert.match(css, /\.epic-dossier-worldbook\s*\{/);
  assert.match(css, /\.epic-setup-footer\s*\{/);
  assert.match(css, /\.epic-destiny-counter\.is-limit\s*\{/);
  assert.match(css, /@media \(max-width:\s*900px\)[\s\S]*\.epic-dossier-grid,[\s\S]*grid-template-columns:\s*1fr;/);
});

test('desktop launch defaults to an immersive stage instead of a configuration workbench', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const css = await readFrontendCss();

  assert.match(html, /<aside id="provider-panel" class="panel provider-panel collapsed"/);
  assert.match(html, /<aside id="inspector-panel" class="panel inspector-panel collapsed"/);
  assert.match(html, /data-tab="status"[\s\S]*aria-selected="true">世界模拟/);
  assert.match(html, /<section class="tab-pane[^\"]*active" data-pane="status"/);
  assert.match(html, /data-tab="memory"[\s\S]*aria-selected="false"[^>]*>记忆/);
  assert.match(css, /\.immersive-right-sidebar\s*\{[\s\S]*top:\s*108px;[\s\S]*bottom:\s*126px;/);
  assert.match(css, /\.immersive-sidebar-tab\s*\{[\s\S]*min-height:\s*86px;[\s\S]*opacity:\s*0\.74;/);
  assert.match(css, /\.stage-actions\s*\{[\s\S]*width:\s*max-content;[\s\S]*margin:\s*0 auto 5px;[\s\S]*opacity:\s*0\.78;/);
});

test('module help popover is wired for subtle contextual guidance', async () => {
  const app = await readFile('public/app.js', 'utf8');
  const moduleHelp = await readFile('public/modules/moduleHelp.js', 'utf8');
  const html = await readFile('public/index.html', 'utf8');
  const css = await readFrontendCss();

  assert.match(app, /createModuleHelpController/);
  assert.match(app, /moduleHelp:\s*bindModuleHelpEvents/);
  assert.match(moduleHelp, /export const MODULE_HELP/);
  assert.match(moduleHelp, /function showModuleHint/);
  assert.match(moduleHelp, /function resolveModuleHelpKey/);
  assert.match(moduleHelp, /module-hint-popover/);
  assert.match(html, /data-tab-shortcut="authoring" data-help-key="authoring"/);
  assert.match(html, /data-tab="authoring"[^>]+data-help-key="authoring"/);
  assert.match(html, /id="worldbook-preset-select"[^>]+data-help-key="worldbook"/);
  assert.match(html, /id="character-preset-select"[^>]+data-help-key="character"/);
  assert.match(html, /id="prompt-preset-select"[^>]+data-help-key="prompt"/);
  assert.match(css, /\.module-hint-popover\s*\{[\s\S]*position:\s*fixed;[\s\S]*backdrop-filter:\s*blur/);
  assert.match(css, /\.module-hint-title\s*\{/);
  assert.match(css, /\.module-hint-close\s*\{/);
});

test('immersive sidebar shell is wired and hidden by default', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = (await Promise.all([
    'public/app.js',
    'public/modules/openingWorkflow.js',
    'public/modules/immersiveDossier.js',
    'public/modules/immersiveLedgers.js',
    'public/modules/immersiveGrowthLedger.js',
    'public/modules/immersiveMemoryLedger.js',
    'public/modules/immersiveSituationLedger.js',
    'public/modules/immersiveCharacterArchiveActions.js',
    'public/modules/immersiveSidebar.js'
  ].map((file) => readFile(file, 'utf8')))).join('\n');
  const css = await readFrontendCss();

  assert.match(html, /id="immersive-right-sidebar"/);
  assert.match(html, /id="immersive-sidebar-tabs"/);
  assert.match(html, /id="immersive-sidebar-body"/);
  assert.match(app, /immersiveRightSidebar/);
  assert.match(app, /function renderImmersiveSidebar/);
  assert.match(app, /getLightFrontendPanels/);
  assert.match(app, /function renderImmersiveCommunityPanel/);
  assert.match(app, /function renderImmersiveCharacterCards/);
  assert.match(app, /function renderImmersiveWorldRules/);
  assert.match(app, /function getCurrentStoryPresentation/);
  assert.match(app, /function filterCustomStoryRecords/);
  assert.match(app, /function getCustomOpeningProtagonistSnapshot/);
  assert.match(app, /const deduplicated = new Map\(\)/);
  assert.match(app, /record\.item \|\| record\.subject \|\| record\.id/);
  assert.match(app, /record\.description \|\| record\.progress \|\| record\.notes/);
  assert.match(app, /当前态势.*决策线索.*角色档案.*人物网络.*成长轨迹.*叙事记忆.*世界规则/s);
  assert.match(app, /导演注记/);
  assert.match(app, /function renderImmersiveDirectorNotes/);
  assert.match(app, /record\.limits \|\| record\.restrictions/);
  assert.match(app, /record\.consequences/);
  assert.match(app, /presentation\.custom[\s\S]*parseImmersiveDocumentSections/);
  assert.match(app, /function resolveImmersiveCharacterPortrait/);
  assert.match(app, /createCharacterPortraitImage\(portraitSource, 'immersive-character-portrait'/);
  assert.match(app, /function selectImmersiveSidebarTab/);
  assert.match(app, /sidebar\.tabs/);
  assert.match(css, /\.hidden\s*\{[\s\S]*display:\s*none\s*!important;/);
  assert.match(css, /\.immersive-right-sidebar\s*\{[\s\S]*right:\s*calc\(300px \+ 16px\);/);
  assert.match(css, /\.workspace:has\(\.inspector-panel\.collapsed\) \.immersive-right-sidebar\s*\{/);
  assert.match(css, /\.immersive-sidebar-tabs\s*\{/);
  assert.match(css, /\.immersive-sidebar-tab\s*\{/);
  assert.match(css, /\.immersive-sidebar-tab\.active\s*\{/);
  assert.match(css, /\.immersive-character-card\s*\{[\s\S]*grid-template-columns:\s*76px minmax\(0,\s*1fr\);/);
  assert.match(css, /\.immersive-character-portrait,[\s\S]*\.immersive-character-monogram\s*\{/);
  assert.match(css, /\.immersive-community-prose\s*\{/);
  assert.match(css, /\.immersive-director-note\s*\{/);
});

test('layout polish keeps the narrative stage dominant and composer compact', async () => {
  const css = await readFrontendCss();

  assert.match(css, /\.workspace\s*\{[\s\S]*gap:\s*12px;/);
  assert.match(css, /\.provider-panel\s*\{[\s\S]*width:\s*232px;/);
  assert.match(css, /\.inspector-panel\s*\{[\s\S]*width:\s*300px;/);
  assert.match(css, /\.chat-panel\s*\{[\s\S]*box-shadow:\s*0 24px 60px rgba\(0,\s*0,\s*0,\s*0\.38\)/);
  assert.match(css, /\.provider-panel,\s*\.inspector-panel\s*\{[\s\S]*background:\s*rgba\(11,\s*15,\s*18,\s*0\.86\);/);
  assert.match(css, /\.composer\s*\{[\s\S]*margin:\s*0 18px 18px;[\s\S]*border-radius:\s*18px;[\s\S]*backdrop-filter:\s*blur\(14px\);/);
  assert.match(css, /:root\[data-theme\]\s+\.composer\s*\{[\s\S]*background:\s*var\(--reading-composer\);/);
  assert.match(css, /\.stage-actions\s*\{[\s\S]*padding:\s*4px 5px 5px;[\s\S]*max-height:\s*30px;/);
  assert.match(css, /\.stage-actions \.tool-button\s*\{[\s\S]*height:\s*24px;[\s\S]*font-size:\s*11px;/);
  assert.match(css, /\.chat-form textarea\s*\{[\s\S]*min-height:\s*44px;[\s\S]*max-height:\s*132px;[\s\S]*border-radius:\s*16px;/);
});

test('immersive visual direction makes the stage feel game-like instead of generic chat', async () => {
  const css = await readFrontendCss();

  assert.match(css, /\.chat-panel::before\s*\{[\s\S]*border:\s*1px solid rgba\(129,\s*212,\s*202,\s*0\.22\);/);
  assert.match(css, /\.chat-panel::after\s*\{[\s\S]*linear-gradient\(120deg,\s*transparent 0 38%,\s*rgba\(129,\s*212,\s*202,\s*0\.1\) 38% 39%,/);
  assert.match(css, /\.chat-panel > \*\s*\{[\s\S]*position:\s*relative;[\s\S]*z-index:\s*1;/);
  assert.match(css, /\.epic-cover-page\s*\{[\s\S]*radial-gradient\(circle at 50% 0%,\s*rgba\(129,\s*212,\s*202,\s*0\.16\),\s*transparent 44%\);/);
  assert.match(css, /\.epic-cover-page::before,[\s\S]*\.epic-cover-page::after\s*\{[\s\S]*border:\s*1px solid rgba\(214,\s*166,\s*74,\s*0\.4\);/);
  assert.match(css, /\.composer::before\s*\{[\s\S]*background:\s*linear-gradient\(90deg,\s*transparent,\s*rgba\(129,\s*212,\s*202,\s*0\.44\),\s*transparent\);/);
  assert.match(css, /\.stage-actions\s*\{[\s\S]*background:\s*rgba\(2,\s*8,\s*10,\s*0\.34\);/);
  assert.match(css, /\.immersive-sidebar-tab\s*\{[\s\S]*min-width:\s*42px;[\s\S]*border-radius:\s*14px 5px 5px 14px;/);
});

test('interaction drawer inherits the active reading palette instead of the legacy dark overlay', async () => {
  const css = await readFrontendCss();

  assert.match(css, /:root\[data-theme\]\s+\.immersive-sidebar-content\s*\{[\s\S]*border-color:\s*var\(--reading-border\);[\s\S]*background:\s*color-mix\(in srgb, var\(--panel\) 95%, transparent\);[\s\S]*color:\s*var\(--reading-content\);/);
  assert.match(css, /:root\[data-theme\]\s+\.immersive-sidebar-tab\.active,[\s\S]*background:\s*color-mix\(in srgb, var\(--accent\) 11%, var\(--panel-raised\)\);/);
  assert.match(css, /:root\[data-theme\]\s+\.immersive-relationship-graph\s*\{[\s\S]*color-mix\(in srgb, var\(--panel-deep\) 92%, transparent\);/);
  assert.match(css, /:root\[data-theme="eye-care"\]\s+\.immersive-sidebar-content\s*\{[\s\S]*background:\s*rgba\(248, 241, 232, 0\.97\);/);
});

test('narrow workbench switches to single-stage mode before panels crush the chat', async () => {
  const css = await readFrontendCss();
  const app = await readFile('public/app.js', 'utf8');
  const workspace = await readFile('public/modules/workspace.js', 'utf8');

  assert.match(css, /@media \(max-width:\s*900px\)\s*\{[\s\S]*\.workspace\s*\{[\s\S]*grid-template-columns:\s*1fr;/);
  assert.match(css, /@media \(max-width:\s*900px\)\s*\{[\s\S]*\.app-shell\s*\{[\s\S]*height:\s*100dvh;/);
  assert.match(css, /@media \(max-width:\s*900px\)[\s\S]*\.provider-panel,[\s\S]*\.inspector-panel,[\s\S]*width:\s*auto;/);
  assert.match(css, /@media \(max-width:\s*900px\)[\s\S]*\.workspace\s*\{[\s\S]*height:\s*auto;[\s\S]*min-height:\s*0;/);
  assert.match(css, /@media \(max-width:\s*900px\)[\s\S]*\.send-button\s*\{[\s\S]*width:\s*40px;[\s\S]*height:\s*40px;/);
  assert.match(css, /@media \(max-width:\s*900px\)\s*\{[\s\S]*\.workspace\[data-active-view="chat"\] \.chat-panel/);
  assert.match(css, /@media \(max-width:\s*900px\)[\s\S]*\.messages\.has-cover-page\s*\{[\s\S]*align-items:\s*stretch;[\s\S]*justify-content:\s*flex-start;/);
  assert.match(css, /@media \(max-width:\s*900px\)[\s\S]*\.messages\.has-cover-page\s+\.epic-cover-page\s*\{[\s\S]*height:\s*auto;[\s\S]*max-height:\s*none;[\s\S]*overflow:\s*visible;/);
  assert.match(workspace, /matchMedia\('\(max-width:\s*900px\)'\)/);
  assert.doesNotMatch(css, /@media \(max-width:\s*760px\)/);
  assert.doesNotMatch(app, /max-width:\s*760px/);
});

test('memory inspector leads with a creator overview and keeps raw data optional', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const memoryInspector = await readFile('public/modules/memoryInspector.js', 'utf8');
  const css = await readFrontendCss();

  assert.match(html, /id="memory-overview"/);
  assert.match(html, /<details class="advanced-data-panel">[\s\S]*原始记忆数据[\s\S]*id="memory-view"/);
  assert.match(memoryInspector, /function renderMemoryOverview/);
  assert.match(memoryInspector, /长期叙事记忆/);
  assert.match(memoryInspector, /当前叙事坐标/);
  assert.match(css, /\.memory-overview\s*\{/);
  assert.match(css, /\.memory-metrics\s*\{/);
  assert.match(css, /\.memory-context-grid,/);
});

test('immersive option cards from markdown have dedicated styling', async () => {
  const markdown = await readFile('public/markdown.js', 'utf8');
  const css = await readFrontendCss();

  assert.match(markdown, /parseImmersiveOptions/);
  assert.match(markdown, /immersive-options-card/);
  assert.match(css, /\.immersive-options-card\s*\{/);
  assert.match(css, /\.immersive-options-stamp\s*\{/);
  assert.match(css, /\.immersive-options-title\s*\{/);
  assert.match(css, /\.immersive-option-item\s*\{/);
});

test('streaming preview removes both empty state and cover page shells', async () => {
  const stream = await readFile('public/modules/conversationStream.js', 'utf8');

  assert.match(stream, /querySelectorAll\('\.empty-state,\s*\.epic-cover-page'\)/);
  assert.match(stream, /classList\.remove\('has-cover-page'\)/);
  assert.match(stream, /extractRoleplayPresentation\(preview\.content\)/);
});

test('roleplay control output stays out of chat and legacy actions render as choices', async () => {
  const presentation = await readFile('public/modules/messagePresentation.js', 'utf8');
  const parser = await readFile('public/modules/roleplayResponse.js', 'utf8');

  assert.match(presentation, /const rawVisibleContent = toolActivity \? '' : \(presentation \? presentation\.content : \(message\.content \|\| ''\)\);/);
  assert.match(presentation, /visibleContent: renderAgentActionCards\(rawVisibleContent\),/);
  assert.doesNotMatch(presentation, /presentation\?\.content \|\| message\.content/);
  assert.match(presentation, /isWebSearchToolMessage/);
  assert.match(presentation, /toolActivity/);
  assert.match(presentation, /presentation\?\.recommendedActions/);
  assert.match(parser, /<recommended_actions\\b/);
  assert.match(parser, /extractCommunityActions\(normalizedSource\)/);
  assert.match(parser, /COMMUNITY_ACTION_BLOCKS = \['w2g', 'dream_option'\]/);
  assert.match(parser, /communityComment:\s*cleanPanelText/);
  assert.match(parser, /extractBlocks\(normalizedSource, 'bginfor'\)/);
  assert.match(presentation, /createCommunityPanelsNode/);
});

test('immersive world rules expose structured topology, factions, calendar, economy and cultivation systems', async () => {
  const app = await readFile('public/modules/immersiveSidebar.js', 'utf8');
  const worldRules = await readFile('public/modules/immersiveWorldRules.js', 'utf8');

  assert.match(app, /from '\.\/immersiveWorldRules\.js'/);
  assert.match(worldRules, /function getImmersiveWorldSystemGroups\(systems,/);
  assert.match(worldRules, /地点拓扑/);
  assert.match(worldRules, /人物与日程/);
  assert.match(worldRules, /势力演化/);
  assert.match(worldRules, /历法与天候/);
  assert.match(worldRules, /经济铁律/);
  assert.match(worldRules, /修行刻度与反噬/);
});

test('character preset library covers more genre-matched roles', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = `${await readFile('public/app.js', 'utf8')}
${await readFile('public/modules/characterPresets.js', 'utf8')}`;

  const requiredPresetIds = [
    'xuanhuan_wangshen',
    'xuanhuan_youquan',
    'xianxia_chisong',
    'xianxia_suyue',
    'lingyi_baiqiao',
    'lingyi_xuhe',
    'mingmo_zhaotiejing',
    'mingmo_shenruoxu'
  ];

  requiredPresetIds.forEach((id) => {
    assert.match(html, new RegExp(`value="${id}"`));
    assert.match(app, new RegExp(`${id}: \\{`));
  });

  const supplementalPresetIds = [
    'xuanhuan_jiangwenque',
    'xuanhuan_tieqing',
    'xuanhuan_sumubai',
    'xuanhuan_wubanjin',
    'lingyi_linsu',
    'lingyi_zhaopo',
    'lingyi_qianshouyi',
    'lingyi_shenwanqiu',
    'mingmo_hesanlang',
    'mingmo_cuidangtou',
    'xianxia_yunqianhe',
    'xianxia_fengjiuyi'
  ];

  supplementalPresetIds.forEach((id) => {
    assert.match(html, new RegExp(`value="${id}"`));
    assert.match(app, new RegExp(`${id}: createSupplementalCharacterPreset\\(`));
  });

  assert.match(app, /独立目标、资源、恐惧和底线/);
  assert.match(app, /随身带/);
  assert.match(app, /追踪：/);
});

test('work modes separate creation, immersion, settings and debug while exposing the current content stack', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = `${await readFile('public/app.js', 'utf8')}
${await readFile('public/modules/domElements.js', 'utf8')}
${await readFile('public/modules/contentPack.js', 'utf8')}`;
  const workspace = await readFile('public/modules/workspace.js', 'utf8');
  const css = await readFrontendCss();

  assert.match(html, /id="work-mode-switch"/);
  assert.match(html, /data-work-mode="creative"/);
  assert.match(html, /data-work-mode="immersive"/);
  assert.match(html, /data-work-mode="settings"/);
  assert.match(html, /data-work-mode="debug"/);
  assert.match(html, /id="exit-immersive-mode"/);
  assert.match(html, /阅读模式/);
  assert.match(html, /舞台背景/);
  assert.match(html, /id="content-stack-status"/);
  assert.match(html, /id="content-stack-items"/);
  assert.match(html, /id="inspector-panel-title"/);
  assert.match(html, /应用到会话/);
  assert.match(workspace, /const WORK_MODES =/);
  assert.match(app, /workModeButtons: '#work-mode-switch \.work-mode-button\[data-work-mode\]'/);
  assert.doesNotMatch(app, /workModeButtons: '\[data-work-mode\]'/);
  assert.match(workspace, /function activateWorkMode/);
  assert.match(workspace, /document\.documentElement\.dataset\.workMode = safeMode/);
  assert.match(workspace, /inspectorPanelTitle\.textContent = config\.panelTitle/);
  assert.match(workspace, /safeMode === 'creative' \|\| safeMode === 'immersive'/);
  assert.match(app, /function renderContentStack/);
  assert.match(app, /function setContentPackPreviewStatus/);
  assert.match(app, /仅视觉预览/);
  assert.match(app, /混合创作栈/);
  assert.match(app, /已同步/);
  assert.match(app, /\['主线', activeArc\]/);
  assert.match(app, /\['参考', referenceSummary\]/);
  assert.match(app, /narrativeState\.activeArc/);
  assert.match(app, /extensions\?\.inspirationRefs/);
  assert.match(css, /\.work-mode-switch\s*\{/);
  assert.match(css, /:root\[data-work-mode="immersive"\] \.chat-panel/);
  assert.match(css, /\.tool-button:not\(\[data-immersive-action\]\)/);
  assert.match(css, /\.exit-immersive-button/);
  assert.match(css, /\.content-stack-summary\s*\{/);
  assert.match(css, /\[data-work-mode="creative"\]/);
  assert.match(css, /\[data-mode-groups~="settings"\]/);
  assert.match(css, /\[data-mode-groups~="debug"\]/);
  assert.match(css, /:root\[data-work-mode="settings"\] \.chat-panel/);
  assert.match(css, /:root\[data-work-mode="debug"\] \.chat-panel/);
  assert.match(css, /:root\[data-work-mode="settings"\] \.inspector-panel,[\s\S]*width:\s*min\(1180px, 100%\)/);
  assert.match(css, /:root\[data-work-mode="debug"\] \.inspector-panel \.drawer-toggle[\s\S]*display:\s*none !important/);
});

test('chat header exposes persistent narrative route controls', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const sessionSettings = await readFile('public/modules/sessionSettings.js', 'utf8');
  const sessionSettingModes = await readFile('public/modules/sessionSettingModes.js', 'utf8');
  const css = await readFrontendCss();

  assert.match(html, /id="narrative-mode-switch"/);
  assert.match(html, /aria-label="叙事约束"/);
  assert.match(html, /data-narrative-mode="free"/);
  assert.match(html, /data-narrative-mode="stable"/);
  assert.match(html, /data-narrative-mode="strict"/);
  assert.match(html, /id="session-roleplay-mode"/);
  assert.match(sessionSettings, /async function saveNarrativeMode/);
  assert.match(sessionSettings, /async function saveRoleplayMode/);
  assert.match(sessionSettingModes, /NARRATIVE_MODES\.includes\(mode\) \? mode : 'stable'/);
  assert.match(sessionSettingModes, /ROLEPLAY_MODES\.includes\(mode\) \? mode : 'dm'/);
  assert.match(css, /\.narrative-mode-switch\s*\{/);
  assert.match(css, /\.narrative-mode-button\.active\s*\{/);
});

test('character cards use a readable overview and warn before cross-genre loading', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = `${await readFile('public/app.js', 'utf8')}\n${await readFile('public/modules/characterCard.js', 'utf8')}`;
  const css = await readFrontendCss();

  assert.match(html, /id="character-overview"/);
  assert.match(html, /class="advanced-data-panel character-advanced-panel"/);
  assert.match(html, /高级 JSON 编辑/);
  assert.match(app, /function renderCharacterOverview/);
  assert.match(app, /function inferCharacterContentPackId/);
  assert.match(app, /function confirmCharacterCompatibility/);
  assert.match(app, /题材冲突：当前故事是/);
  assert.match(app, /button\.textContent = '仍然加载'/);
  assert.match(css, /\.character-overview\s*\{/);
  assert.match(css, /\.character-compatibility-warning\s*\{/);
  assert.match(css, /\.character-advanced-panel #character-card-editor/);
});

test('Hero script is wired through selectors, visuals, guided opening and dynamic character presets', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = `${await readFile('public/app.js', 'utf8')}
${await readFile('public/modules/protagonistGenerator.js', 'utf8')}
${await readFile('public/modules/storyOpening.js', 'utf8')}
${await readFile('public/modules/journeyDraft.js', 'utf8')}
${await readFile('public/modules/appState.js', 'utf8')}`;
  const css = await readFrontendCss();
  const template = JSON.parse(await readFile('public/prologue-template.json', 'utf8'));

  assert.match(html, /<option value="yingxiongzhi">英雄志群像内容包<\/option>/);
  assert.match(html, /<option value="yingxiongzhi">英雄志<\/option>/);
  assert.match(app, /id: 'yingxiongzhi'/);
  assert.match(app, /CONTENT_PACK_VISUAL_PRESETS[\s\S]*yingxiongzhi:/);
  assert.match(app, /const appliedPackId = String\(getAppliedContentPackId\(\) \|\| ''\)\.trim\(\)/);
  assert.match(app, /if \(appliedPackId\)[\s\S]*loadContentPackCharacterPresets\(appliedPackId/);
  assert.match(app, /generateYingxiongzhiProtagonistCard/);
  assert.match(app, /extensions\?\.visibility/);
  assert.match(css, /\.epic-current-script\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto/);
  assert.match(css, /\.messages\.has-cover-page \.epic-cover-page\s*\{[\s\S]*overflow-y:\s*auto/);
  assert.equal(template.genres.yingxiongzhi.title, '英 雄 志');
  assert.equal(template.genres.yingxiongzhi.destinyCards.cards.length, 8);
  assert.ok(template.genres.yingxiongzhi.sidebar.tabs.includes('剧情节点'));
  assert.ok(template.genres.yingxiongzhi.fields.knownInformation);
  assert.ok(template.genres.yingxiongzhi.fields.blindSpot);
});

test('v0.4 status inspector exposes world clock, NPC projections and event ledger', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = `${await readFile('public/app.js', 'utf8')}\n${await readFile('public/modules/worldSimulation.js', 'utf8')}`;
  const css = await readFrontendCss();

  assert.match(html, /id="simulation-view-switch"/);
  assert.match(html, /data-simulation-view="director"/);
  assert.match(html, /data-simulation-view="public"/);
  assert.match(html, /id="simulation-actors"/);
  assert.match(html, /id="simulation-events"/);
  assert.match(html, /data-simulation-advance="1440"/);
  assert.match(html, /id="simulation-actors-editor"/);

  assert.match(app, /function renderWorldSimulation/);
  assert.match(app, /async function advanceWorldSimulation/);
  assert.match(app, /async function saveSimulationActors/);
  assert.match(app, /\/api\/sessions\/\$\{encodeURIComponent\(sessionId\)\}\/simulation\?view=\$\{view\}/);
  assert.match(app, /\/simulation\/advance/);
  assert.match(app, /\/simulation\/actors/);
  assert.match(app, /state\.simulationPublicSnapshot/);

  assert.match(css, /\.world-simulation-panel\s*\{/);
  assert.match(css, /\.simulation-view-switch\s*\{/);
  assert.match(css, /\.simulation-actors-editor-panel \.json-editor/);
  assert.match(css, /\.status-pane\s*\{[\s\S]*overflow-y:\s*auto;/);
});

test('frontend exposes the full-screen narrative asset center', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = await readFile('public/app.js', 'utf8');
  const css = await readFrontendCss();
  const assetCenter = await readFile('public/modules/assetCenter.js', 'utf8');
  const assetLibrary = await readFile('public/modules/assetLibrary.js', 'utf8');

  assert.match(html, /id="open-asset-center"/);
  assert.match(html, /id="asset-center"/);
  assert.match(html, /id="asset-center-categories"/);
  assert.match(html, /id="asset-center-grid"/);
  assert.match(html, /id="asset-center-detail"/);
  assert.match(html, /id="asset-center-organize"/);
  assert.match(html, /id="asset-center-batch-bar"/);
  assert.match(html, /角色卡/);
  assert.match(html, /世界书/);
  assert.match(html, /预设 \/ Prompt/);

  assert.match(app, /createAssetCenterController/);
  assert.match(assetLibrary, /function openAssetCenter/);
  assert.match(assetLibrary, /function saveAssetMetadata/);
  assert.match(assetLibrary, /method: 'PATCH'/);
  assert.match(assetCenter, /export function buildAssetCatalog/);
  assert.match(assetCenter, /export function filterAssetCatalog/);
  assert.match(assetCenter, /export function paginateAssetCatalog/);
  assert.match(assetCenter, /data-asset-action = 'favorite'|action === 'favorite'/);
  assert.match(assetCenter, /function applyBatchMetadata/);
  assert.match(assetCenter, /function createPreviewPanel/);
  assert.match(assetCenter, /function createEvaluationPanel/);
  assert.match(assetCenter, /function createVersionPanel/);
  assert.match(assetCenter, /function createWorldbookManagementPanel/);
  assert.match(assetCenter, /function createPromptManagementPanel/);
  assert.match(assetCenter, /action === 'worldbook-add'/);
  assert.match(assetCenter, /action === 'prompt-edit'/);
  assert.match(html, /data-asset-import-kind="character"/);
  assert.match(html, /data-asset-import-kind="worldbook"/);
  assert.match(html, /data-asset-import-kind="prompt"/);
  assert.equal((html.match(/id="asset-center-detail"/g) || []).length, 1);
  assert.equal((html.match(/id="asset-center-status"/g) || []).length, 1);
  assert.equal((html.match(/id="asset-center-organize"/g) || []).length, 1);

  assert.match(css, /\.asset-center\s*\{/);
  assert.match(css, /\.asset-center-layout\s*\{/);
  assert.match(css, /\.asset-center-grid\s*\{[\s\S]*overflow-y:\s*auto/);
  assert.match(css, /\.asset-center-detail\s*\{[\s\S]*overflow-y:\s*auto/);
  assert.match(css, /\.asset-batch-bar\s*\{/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.asset-center-layout/);
});

test('guided opening keeps world book payload in system context instead of visible chat', async () => {
  const journeyDraft = await readFile('public/modules/journeyDraft.js', 'utf8');
  const app = `${await readFile('public/app.js', 'utf8')}\n${await readFile('public/modules/utils.js', 'utf8')}\n${journeyDraft}`;
  const promptBuilder = journeyDraft.match(/export function buildJourneyPrompt\([\s\S]*?\n}\n\nexport function createJourneyDraftController/)?.[0] || '';

  assert.match(app, /具体内容已由系统上下文提供，此处不再重复/);
  assert.doesNotMatch(promptBuilder, /worldbookSnapshot\.entries\.forEach/);
  assert.match(app, /PROVIDER_REASONING_ONLY_RESPONSE/);
});

test('narrative workspace separates reading, choices and structured character dossiers', async () => {
  const app = (await Promise.all([
    'public/app.js',
    'public/modules/messagePresentation.js',
    'public/modules/recommendedActionsView.js',
    'public/modules/conversationActions.js',
    'public/modules/immersiveDossier.js',
    'public/modules/immersiveLedgers.js',
    'public/modules/immersiveGrowthLedger.js',
    'public/modules/immersiveMemoryLedger.js',
    'public/modules/immersiveSituationLedger.js',
    'public/modules/immersiveSidebar.js'
  ].map((file) => readFile(file, 'utf8')))).join('\n');
  const css = await readFrontendCss();

  assert.match(app, /function renderImmersiveProtagonistCard/);
  assert.match(app, /function renderImmersiveIntelligenceLedger/);
  assert.match(app, /function renderImmersiveGrowthLedger/);
  assert.match(app, /function renderImmersiveMemoryLedger/);
  assert.match(app, /function renderImmersiveSituationLedger/);
  assert.match(app, /梦入神机\|梦如神机/);
  assert.match(app, /神府造化\|神机造化/);
  assert.match(app, /function parseImmersiveStatusFields/);
  assert.match(app, /immersive-protagonist-facts/);
  assert.match(app, /narrative-choice-panel/);
  assert.match(app, /recommended-actions-list/);
  assert.match(app, /recommendation-number/);
  assert.match(app, /target: 'recommended-action'/);
  assert.match(app, /function buildRecommendedActionFallback/);
  assert.match(app, /正在结合主角与当前场景组织行动/);
  assert.match(css, /\.immersive-protagonist-card\s*\{/);
  assert.match(css, /\.immersive-protagonist-facts\s*,/);
  assert.match(css, /\.immersive-dossier-header\s*\{/);
  assert.match(css, /\.immersive-ledger-section,/);
  assert.match(css, /\.immersive-progress-facts\s*\{/);
  assert.match(css, /\.immersive-memory-row\s*\{/);
  assert.match(css, /\.recommended-actions-list\s*\{[\s\S]*display:\s*grid/);
  assert.match(css, /\.recommendation-custom-row\s*\{/);
  assert.match(css, /\.recommendation-button\.is-expanding\s*\{/);
  assert.match(css, /\.message\s*\{[\s\S]*width:\s*min\(100%,\s*960px\)/);
});

test('third-party script governance is modular, review-gated and network-denied', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = await readFile('public/app.js', 'utf8');
  const governance = await readFile('public/modules/scriptGovernance.js', 'utf8');
  const sandbox = await readFile('public/modules/sandboxRenderer.js', 'utf8');

  assert.match(html, /第三方脚本只有在人工审核并绑定当前内容哈希后才会执行/);
  assert.match(app, /createScriptGovernanceController/);
  assert.doesNotMatch(app, /function renderSandboxAuditPanel/);
  assert.match(governance, /script-reviews/);
  assert.match(governance, /script-executions/);
  assert.match(sandbox, /connect-src 'none'/);
  assert.match(sandbox, /frame-src 'none'/);
  assert.match(sandbox, /isRuleApproved/);
  assert.match(sandbox, /contentHash/);
});

test('independent heavy frontends expose a separate reviewed and isolated operator flow', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = await readFile('public/app.js', 'utf8');
  const controller = await readFile('public/modules/heavyFrontendRuntime.js', 'utf8');
  const css = await readFile('public/styles/heavy-frontend.css', 'utf8');

  assert.match(html, /data-asset-import-kind="heavy-frontend"/);
  assert.match(html, /id="heavy-frontend-manager"/);
  assert.match(html, /id="heavy-frontend-frame"[^>]+sandbox="allow-scripts allow-same-origin"/);
  assert.doesNotMatch(html, /id="heavy-frontend-frame"[^>]+allow-(?:popups|forms|downloads|top-navigation)/);
  assert.match(app, /createHeavyFrontendRuntimeController/);
  assert.match(controller, /当前内容哈希/);
  assert.match(controller, /runtimeOrigin/);
  assert.match(controller, /event\.source !== ui\.playerFrame/);
  assert.match(controller, /maxOutputTokensPerCall/);
  assert.match(css, /\.heavy-frontend-review-badge\.approved/);
  assert.match(css, /\.heavy-frontend-player-usage/);
});

test('reader header keeps global status exposed to users and assistive technology', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const readerCss = await readFile('public/styles/reader-ui.css', 'utf8');

  assert.match(html, /<output id="app-status" class="product-status" aria-live="polite" aria-atomic="true">/);
  assert.match(readerCss, /\.product-tagline\s*\{\s*display:\s*none !important;/);
  assert.doesNotMatch(readerCss, /\.product-identity p,\s*\.product-tagline/);
  assert.match(readerCss, /#app-status\s*\{[\s\S]*display:\s*inline-flex/);
});

test('reader choices stay native, legible action cards instead of raw option lists', async () => {
  const parser = await readFile('public/modules/roleplayResponse.js', 'utf8');
  const presentation = await readFile('public/modules/messagePresentation.js', 'utf8');
  const actionsView = await readFile('public/modules/recommendedActionsView.js', 'utf8');
  const readerCss = await readFile('public/styles/reader-ui.css', 'utf8');

  assert.match(parser, /LEGACY_CHOICE_HEADING_PATTERN/);
  assert.match(parser, /extractLegacyRecommendedActions/);
  assert.match(presentation, /from '\.\/recommendedActionsView\.js'/);
  assert.match(actionsView, /from '\.\/actionPanelPresentation\.js'/);
  assert.match(actionsView, /resolveActionPanelPresentation\(characterCard, session\)/);
  assert.match(actionsView, /heading\.textContent = presentation\.title/);
  assert.match(actionsView, /recommendation-custom-input/);
  assert.match(readerCss, /\.recommended-actions-list\s*\{[\s\S]*display:\s*grid/);
  assert.match(readerCss, /\.recommendation-number\s*\{[\s\S]*display:\s*inline-flex/);
});

test('reader rail owns the right edge in creative and immersive modes', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const readerCss = await readFile('public/styles/reader-ui.css', 'utf8');

  assert.match(html, /data-work-mode="debug"[^>]*aria-label="打开调试与检查工作台"/);
  assert.match(
    readerCss,
    /:root\[data-work-mode="creative"\] \.inspector-panel,[\s\S]*:root\[data-work-mode="immersive"\] \.inspector-panel\s*\{[\s\S]*display:\s*none\s*!important;/
  );
});
