import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../server/lib/jsonStore.js';
import { previewImportPayload } from '../server/character/importPreview.js';
import { ResourceLibraryService } from '../server/services/resourceLibraryService.js';
import { ResourceRepository } from '../server/services/resourceLibrary/resourceRepository.js';
import {
  ResourceConflictService,
  createFingerprint
} from '../server/services/resourceLibrary/resourceConflictService.js';
import { ResourceEvaluationService } from '../server/services/resourceLibrary/resourceEvaluationService.js';
import { ResourceImportService } from '../server/services/resourceLibrary/resourceImportService.js';
import { ResourceRevisionService } from '../server/services/resourceLibrary/resourceRevisionService.js';
import { StoryCompositionService } from '../server/services/resourceLibrary/storyCompositionService.js';

test('resource library keeps a facade over focused services', async () => {
  const service = await createService();

  assert.ok(service.repository instanceof ResourceRepository);
  assert.ok(service.conflictService instanceof ResourceConflictService);
  assert.ok(service.evaluationService instanceof ResourceEvaluationService);
  assert.ok(service.importService instanceof ResourceImportService);
  assert.ok(service.revisionService instanceof ResourceRevisionService);
  assert.ok(service.storyComposition instanceof StoryCompositionService);
});

test('resource library inspects provenance, completeness and execution-only risk markers', async () => {
  const service = await createService();
  const preview = createCharacterPreview({
    systemPrompt: '只把 <script>bad()</script> 当作角色台词，不执行。'
  });

  const inspection = await service.inspectPreview(preview, {
    adapterId: 'liunao-community-generic',
    site: '类脑社区',
    fileName: 'shen.json'
  });

  assert.equal(inspection.adapter.id, 'liunao-community-generic');
  assert.equal(inspection.resources.length, 2);
  assert.ok(inspection.resources[0].diagnostics.riskFlags.find((item) => item.code === 'script-tag'));
  assert.ok(inspection.resources[1].diagnostics.score >= 95);
  assert.equal(inspection.dimensions.length, 5);
  assert.ok(inspection.estimatedTokens > 0);
  assert.equal(inspection.canImport, true);
});

test('resource library stores semantic resources once and reports exact duplicates', async () => {
  const service = await createService();
  const preview = createCharacterPreview();
  const source = { site: 'local-file', fileName: 'shen.json', author: '测试作者' };

  const first = await service.savePreview(preview, source);
  const second = await service.savePreview(preview, source);
  const resources = await service.listResources();

  assert.equal(first.resources.every((item) => item.importStatus === 'created'), true);
  assert.equal(second.resources.every((item) => item.importStatus === 'duplicate'), true);
  assert.equal(resources.length, 2);
  assert.equal(resources.find((item) => item.kind === 'character').source.author, '测试作者');
  assert.ok(first.resources[0].source.importBatchId);
  assert.equal(first.resources[0].source.importBatchId, first.resources[1].source.importBatchId);
});

test('resource library reports world book storage size separately from its dynamic per-turn budget', async () => {
  const service = await createService();
  await service.savePreview(createCharacterPreview({}, [{
    id: 'large-world-law',
    title: '世界法则',
    keywords: [],
    content: '世界法则必须持续成立。'.repeat(1800),
    constant: true,
    enabled: true
  }, {
    id: 'large-market-lore',
    title: '墟市物价',
    keywords: ['墟市'],
    content: '墟市物价随季节与势力关系变化。'.repeat(1800),
    enabled: true
  }]), { site: 'local-file', fileName: 'large-worldbook.json' });

  const resources = await service.listResources();
  const worldBook = resources.find((item) => item.kind === 'worldbook');

  assert.equal(worldBook.diagnostics.worldBookRuntime.mode, 'constant-and-triggered');
  assert.equal(worldBook.diagnostics.worldBookRuntime.perTurnTokenCap, 6000);
  assert.ok(worldBook.diagnostics.storedPayloadEstimatedTokens > worldBook.diagnostics.estimatedTokens);
  assert.ok(worldBook.diagnostics.estimatedTokens <= 6000);
});

test('pack preflight exposes unresolved Character Filter tag IDs as exact compatibility differences', async () => {
  const service = await createService();
  const tagId = '31f7b74e-9828-4cd2-b7ac-3d93840d471c';
  const preview = previewImportPayload({
    fileName: 'private-tag-filter.json',
    data: JSON.stringify({
      entries: [{
        uid: 9,
        comment: '仅限武侠角色',
        keys: ['门派'],
        content: '门派只接待武林中人。',
        enabled: true,
        character_filter: { tags: [tagId], isExclude: false }
      }]
    })
  });
  const saved = await service.savePreview(preview, { site: 'local-file', fileName: 'private-tag-filter.json' });
  const worldBook = saved.resources.find((item) => item.kind === 'worldbook');
  const composition = await service.inspectPackComposition({
    title: '标签预检',
    includeBaseContent: false,
    worldBookResourceIds: [worldBook.id],
    customBaseline: { premise: '测试世界。' }
  });

  assert.equal(composition.communityCompatibility.counts.degraded, 1);
  assert.equal(composition.compatibilityReview.requiresCompatibilityAcknowledgement, true);
  assert.equal(composition.compatibilityReview.differences[0].id, 'worldbook-character-filter-tag-registry');
  assert.deepEqual(composition.compatibilityReview.differences[0].evidence, [`仅限武侠角色：${tagId}`]);

  const pack = await createPackWithPreflightApproval(service, {
    title: '标签预检',
    includeBaseContent: false,
    worldBookResourceIds: [worldBook.id],
    customBaseline: { premise: '测试世界。' }
  });
  const audit = pack.resourceManifest.composition.compatibilityReview;
  assert.equal(audit.status, 'approved');
  assert.equal(audit.acknowledgedCompatibility, true);
  assert.equal(audit.compatibilityDifferences[0].id, 'worldbook-character-filter-tag-registry');
  assert.deepEqual(audit.compatibilityDifferences[0].evidence, [`仅限武侠角色：${tagId}`]);

  const mapped = await service.applyWorldBookTagRegistry(worldBook.id, {
    registryDocument: { settings: { tags: [{ id: tagId, name: '武侠' }] } }
  });
  const afterMapping = await service.inspectPackComposition({
    title: '标签预检 · 已修复',
    includeBaseContent: false,
    worldBookResourceIds: [worldBook.id],
    customBaseline: { premise: '测试世界。' }
  });
  const history = await service.listResourceRevisions(worldBook.id);

  assert.equal(mapped.resource.revision.changeType, 'tag-registry-mapping');
  assert.deepEqual(mapped.report.appliedMappings, [{ id: tagId, name: '武侠' }]);
  assert.deepEqual(mapped.report.unresolvedAfter, []);
  assert.equal(afterMapping.communityCompatibility.counts.degraded, 0);
  assert.equal(
    afterMapping.compatibilityReview.differences.some(
      (item) => item.id === 'worldbook-character-filter-tag-registry'
    ),
    false
  );
  assert.equal(history.revisions[0].changeType, 'tag-registry-mapping');
});

test('resource library imports same-source changes as revisions and can roll back without mutating packs', async () => {
  const service = await createService();
  const sourceV1 = {
    site: 'local-file',
    fileName: 'tingyu-card.json',
    version: '1.0.0'
  };
  const first = await service.savePreview(createCharacterPreview(), sourceV1);
  const characterV1 = first.resources.find((item) => item.kind === 'character');
  const worldBookV1 = first.resources.find((item) => item.kind === 'worldbook');
  const pack = await service.createPack({
    title: '听雨旧卷',
    characterResourceId: characterV1.id,
    worldBookResourceIds: [worldBookV1.id]
  });
  const previewV2 = createCharacterPreview({
    description: '背负旧案、正在追查新证人的年轻刀客。',
    systemPrompt: '保持武侠叙事边界。<script>auditMe()</script>'
  }, [{
    id: 'lore-tingyu',
    title: '听雨楼',
    keywords: ['听雨楼'],
    content: '听雨楼开始按秘密的危险程度定价。',
    enabled: true
  }]);
  const sourceV2 = { ...sourceV1, version: '2.0.0' };

  const inspection = await service.inspectPreview(previewV2, sourceV2);
  const updated = await service.savePreview(previewV2, sourceV2, { inspection });
  const characterV2 = updated.resources.find((item) => item.kind === 'character');
  const worldBookV2 = updated.resources.find((item) => item.kind === 'worldbook');
  const history = await service.listResourceRevisions(characterV2.id);
  const firstRevision = history.revisions.find((item) => item.number === 1);

  assert.equal(inspection.updateCount, 2);
  assert.equal(inspection.resources.every((item) => item.update?.available), true);
  assert.equal(inspection.resources[0].update.diff.changed, true);
  assert.equal(updated.resources.every((item) => item.importStatus === 'updated'), true);
  assert.equal(characterV2.id, characterV1.id);
  assert.equal(worldBookV2.id, worldBookV1.id);
  assert.equal(characterV2.revision.number, 2);
  assert.equal(characterV2.revision.count, 2);
  assert.equal(characterV2.revision.securityReview.required, true);
  assert.equal(history.revisions.length, 2);
  assert.equal(history.revisions[0].current, true);
  assert.match(characterV2.payload.description, /新证人/);
  assert.match(worldBookV2.payload.entries[0].content, /危险程度/);
  assert.doesNotMatch(pack.characterCard.description, /新证人/);
  assert.equal(pack.resourceManifest.resourceRevisionIds[characterV1.id], characterV1.revision.headId);

  const rolledBack = await service.rollbackResource(characterV2.id, firstRevision.id);
  const afterRollback = await service.listResourceRevisions(characterV2.id);
  assert.equal(rolledBack.revision.number, 3);
  assert.equal(rolledBack.revision.changeType, 'rollback');
  assert.equal(rolledBack.revision.restoredFromRevisionId, firstRevision.id);
  assert.equal(rolledBack.payload.description, characterV1.payload.description);
  assert.equal(afterRollback.revisions.length, 3);
  assert.doesNotMatch(pack.characterCard.description, /新证人/);
});

test('resource library derives missing character fields from greetings, prompts and companion lore', async () => {
  const service = await createService();
  const preview = createCharacterPreview({
    personality: '',
    scenario: '',
    systemPrompt: '',
    postHistoryInstructions: '',
    exampleDialog: [],
    firstMessage: '{{char}}：雨停之前，我只回答一个问题。'
  }, [{
    id: 'character-profile',
    title: '人物性格',
    content: '性格：寡言克制，对承诺近乎固执。',
    enabled: true
  }, {
    id: 'opening-scene',
    title: '开局场景',
    content: '当前场景：听雨楼闭门之后，旧案证人带伤来访。',
    enabled: true
  }, {
    id: 'roleplay-rules',
    title: '扮演约束',
    content: '必须保持武侠时代语境，不得主动透露旧案真凶。',
    enabled: true
  }]);

  const saved = await service.savePreview(preview, { site: '类脑社区' });
  const character = saved.resources.find((item) => item.kind === 'character');

  assert.match(character.payload.personality, /寡言克制|承诺/);
  assert.match(character.payload.scenario, /听雨楼|旧案证人/);
  assert.match(character.payload.postHistoryInstructions, /武侠时代语境|不得主动透露/);
  assert.ok(character.payload.exampleDialog.some((item) => item.includes('雨停之前')));
  assert.deepEqual(
    character.payload.extensions.local_roleplay_agent.enrichment.generatedFields,
    ['personality', 'scenario', 'postHistoryInstructions', 'exampleDialog']
  );
  assert.equal(character.diagnostics.missingFields.some((item) => ['personality', 'scenario'].includes(item.field)), false);
  assert.equal(character.diagnostics.warnings.some((item) => item.code === 'CHARACTER_WITHOUT_BEHAVIOR_RULE'), false);
  assert.equal(character.diagnostics.warnings.some((item) => item.code === 'CHARACTER_WITHOUT_DIALOG_EXAMPLE'), false);
});

test('resource library classifies multi-NPC cards as scenario containers without borrowing one NPC profile', async () => {
  const service = await createService();
  const preview = createCharacterPreview({
    name: '绝世仙宗',
    role: '个人创作主角',
    description: '',
    personality: '',
    scenario: '',
    exampleDialog: [],
    firstMessage: '宗门杂役刘一在夜巡时遇见一位陌生长老。'
  }, [
    { id: 'sifu', title: '丝苻_基础信息', content: '性格：克制而敏锐。', enabled: true },
    { id: 'zhuqing', title: '竹青_基础信息', content: '性格：慵懒而疏离。', enabled: true },
    { id: 'yaotai', title: '瑶台_基础信息', content: '性格：淡然冷静。', enabled: true }
  ]);

  const saved = await service.savePreview(preview, { site: '类脑社区' });
  const character = saved.resources.find((item) => item.kind === 'character');
  const contentMode = character.payload.extensions.local_roleplay_agent.contentMode;

  assert.equal(contentMode.kind, 'scenario-container');
  assert.deepEqual(contentMode.characterNames, ['丝苻', '竹青', '瑶台']);
  assert.equal(character.payload.personality, '');
  assert.equal(character.payload.scenario, '');
  assert.deepEqual(character.payload.exampleDialog, []);
  assert.deepEqual(
    character.payload.extensions.local_roleplay_agent.enrichment.generatedFields,
    []
  );
});

test('resource library reevaluates legacy assets and preserves authored character fields', async () => {
  const service = await createService();
  await service.store.write('library/resources/legacy-character.json', {
    id: 'legacy-character',
    kind: 'character',
    title: '旧版听雨刀客',
    summary: '旧素材',
    tags: ['武侠'],
    collections: [],
    favorite: false,
    format: 'character-card-v2',
    fingerprint: 'legacy',
    source: {
      site: '类脑社区',
      importBatchId: 'legacy-batch',
      importedAt: '2026-07-01T00:00:00.000Z'
    },
    diagnostics: { score: 0 },
    payload: {
      name: '沈观澜',
      description: '背负旧案的刀客。',
      personality: '作者明确写下的冷静性格。',
      scenario: '',
      firstMessage: '沈观澜：城门将在子时关闭。',
      exampleDialog: [],
      systemPrompt: '',
      postHistoryInstructions: '',
      extensions: {}
    },
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z'
  });
  await service.store.write('library/resources/legacy-worldbook.json', {
    id: 'legacy-worldbook',
    kind: 'worldbook',
    title: '旧案开局',
    fingerprint: 'legacy-worldbook',
    source: { site: '类脑社区', importBatchId: 'legacy-batch' },
    payload: {
      entries: [{
        id: 'legacy-opening',
        title: '开局场景与行为规则',
        content: '当前场景：城门戒严，证人失踪。必须隐瞒官府密令。',
        enabled: true
      }]
    }
  });

  const result = await service.reevaluateResource('legacy-character');

  assert.equal(result.resource.payload.personality, '作者明确写下的冷静性格。');
  assert.match(result.resource.payload.scenario, /城门戒严|证人失踪/);
  assert.match(result.resource.payload.postHistoryInstructions, /隐瞒官府密令/);
  assert.ok(result.resource.payload.exampleDialog.length > 0);
  assert.ok(result.resource.diagnostics.communityCompatibility);
  assert.ok(result.resource.diagnostics.score > 0);
  assert.deepEqual(result.enrichment.generatedFields, ['scenario', 'postHistoryInstructions', 'exampleDialog']);
  assert.equal(await service.reevaluateResource('missing-resource'), null);
});

test('resource library allows a duplicate character import to backfill its card portrait', async () => {
  const service = await createService();
  await service.savePreview(createCharacterPreview(), { site: 'local-file' });
  const embeddedPortraitPreview = createCharacterPreview();
  embeddedPortraitPreview.summary = { hasEmbeddedPortrait: true };
  const previewInspection = await service.inspectPreview(embeddedPortraitPreview, { site: 'local-file' });
  const assetId = 'a'.repeat(64);
  const previewWithPortrait = createCharacterPreview({
    portrait: {
      assetId,
      url: `/api/character-images/${assetId}.png`,
      mimeType: 'image/png',
      width: 512,
      height: 768,
      source: 'embedded-character-card'
    }
  });

  const inspection = await service.inspectPreview(previewWithPortrait, { site: 'local-file' });
  const saved = await service.savePreview(previewWithPortrait, { site: 'local-file' }, { inspection });
  const resources = await service.listResources();
  const character = resources.find((item) => item.kind === 'character');

  assert.equal(previewInspection.canImport, true);
  assert.equal(previewInspection.resources[0].diagnostics.conflicts[0].type, 'portrait-update');
  assert.equal(inspection.canImport, true);
  assert.equal(inspection.resources[0].diagnostics.conflicts[0].type, 'portrait-update');
  assert.ok(inspection.resources[0].diagnostics.warnings.find((item) => item.code === 'PORTRAIT_UPDATE'));
  assert.equal(saved.resources.find((item) => item.kind === 'character').importStatus, 'updated');
  assert.equal(saved.resources.find((item) => item.kind === 'worldbook').importStatus, 'duplicate');
  assert.equal(resources.length, 2);
  assert.equal(character.payload.portrait.url, `/api/character-images/${assetId}.png`);
});

test('resource library composes a custom pack from a base pack and selected resources', async () => {
  const service = await createService();
  const saved = await service.savePreview(createCharacterPreview({
    extensions: {
      regex_scripts: [{ findRegex: '/<status>[\\s\\S]*?<\\/status>/g', replaceString: '' }],
      quick_replies: [{ label: '问旧案', command: '/send 追问旧案' }],
      mvu: { values: { clueCount: 0 } },
      tavern_helper: {
        quickReplySet: [{ label: '查看线索', command: '/send <%= scene.name %>里还有什么线索？' }],
        variables: { values: { relationship: { shen: 12 } } },
        panels: [{ title: '关系档案', fields: [{ label: '好感', path: 'relationship.shen' }] }]
      }
    }
  }), { site: '类脑社区' });
  const character = saved.resources.find((item) => item.kind === 'character');
  const worldBook = saved.resources.find((item) => item.kind === 'worldbook');
  const basePack = {
    id: 'xianxia',
    title: '太虚仙侠',
    promptModules: [{ id: 'base-prompt', title: '基线', content: '遵循仙侠规则', enabled: true }],
    worldBook: [{ id: 'base-lore', title: '太虚界', content: '仙门治世。', keywords: ['太虚界'], enabled: true }],
    characterCard: { name: '旧主角' },
    characterPresets: [{ id: 'old-actor', characterCard: { name: '旧同伴' } }],
    groupMembers: [{ id: 'old-group', name: '旧群聊成员' }],
    memory: { memoryCards: [], worldState: { flags: { genre: 'xianxia' } } },
    ruleSystem: { id: 'xianxia-rules', title: '仙侠规则', boundary: '仙侠', panels: [] }
  };

  const pack = await createPackWithPreflightApproval(service, {
    title: '听雨仙途',
    basePackId: 'xianxia',
    characterResourceId: character.id,
    worldBookResourceIds: [worldBook.id]
  }, { basePack });

  assert.match(pack.id, /^custom-/);
  assert.equal(pack.characterCard.name, '沈观澜');
  assert.deepEqual(pack.characterPresets, [{ id: 'old-actor', characterCard: { name: '旧同伴' } }]);
  assert.deepEqual(pack.groupMembers, [{ id: 'old-group', name: '旧群聊成员' }]);
  assert.equal(pack.visualPackId, 'xianxia');
  assert.equal(pack.memory.resourcePackId, pack.id);
  assert.equal(pack.ruleSystem.contentPackId, pack.id);
  assert.ok(pack.worldBook.find((entry) => entry.title === '听雨楼'));
  assert.ok(pack.worldBook.find((entry) => entry.title === '太虚界'));
  assert.equal(pack.lightFrontend.regexTransforms.length, 1);
  assert.equal(pack.lightFrontend.quickReplies[0].template, '追问旧案');
  assert.ok(pack.lightFrontend.quickReplies.find((item) => item.label === '查看线索'));
  assert.equal(pack.lightFrontend.mvu.values.chat.clueCount, 0);
  assert.equal(pack.lightFrontend.mvu.values.chat.relationship.shen, 12);
  assert.equal(pack.lightFrontend.panels[0].title, '关系档案');
  assert.deepEqual(pack.lightFrontend.adapters[0].mappedCapabilities, ['quick-replies', 'sidebar-panels', 'mvu-state']);
  assert.equal(pack.lightFrontend.adapters[0].mode, 'declarative-partial');
  assert.equal(pack.openingTemplate.source, 'custom-pack');
  assert.equal(pack.openingTemplate.title, '听雨仙途');
  assert.equal(pack.openingTemplate.genre, 'xianxia');
  assert.equal(pack.openingTemplate.destinyCards.cards.some((card) => card.title.includes('雁回')), false);
  const summary = (await service.listPacks())[0];
  assert.equal(summary.basePackId, 'xianxia');
  assert.equal(summary.openingTemplate.title, '听雨仙途');
  assert.equal(summary.openingTemplate.genre, 'xianxia');
});

test('custom packs use a safe playable derivative while the asset library keeps the original community card', async () => {
  const service = await createService();
  const saved = await service.savePreview(createCharacterPreview({
    name: '九渊',
    raw: {
      extensions: {
        tavern_helper: { scripts: [{ code: 'advanceWorld()' }] },
        regex_scripts: [{ replaceString: '<script>advanceWorld()</script>' }]
      }
    },
    extensions: {
      speech: '冷峻而具体。',
      tavern_helper: { scripts: [{ code: 'advanceWorld()' }] }
    }
  }, [{
    id: 'twelve-realms',
    title: '十二国疆域',
    keywords: ['十二国'],
    content: '两百余据点拥有不同物价、税率与灵气浓度。',
    enabled: true
  }, {
    id: 'npc-runtime',
    title: '在场NPC生成引擎',
    keywords: [],
    content: '<% if (state.location) { %>推进人物日程<% } %>',
    enabled: true,
    constant: true
  }]), { site: '类脑社区' });
  const character = saved.resources.find((item) => item.kind === 'character');
  const worldBook = saved.resources.find((item) => item.kind === 'worldbook');

  const pack = await createPackWithPreflightApproval(service, {
    title: '九渊独立副本',
    includeBaseContent: false,
    characterResourceId: character.id,
    worldBookResourceIds: [worldBook.id]
  });
  const storedCharacter = await service.getResource(character.id);
  const storedWorldBook = await service.getResource(worldBook.id);

  assert.equal(storedCharacter.payload.raw.extensions.tavern_helper.scripts[0].code, 'advanceWorld()');
  assert.ok(storedWorldBook.payload.entries.find((entry) => entry.id === 'npc-runtime'));
  assert.equal(pack.characterCard.raw, undefined);
  assert.equal(pack.characterCard.extensions.tavern_helper, undefined);
  assert.ok(pack.worldBook.find((entry) => entry.id === 'twelve-realms'));
  assert.equal(pack.worldBook.some((entry) => entry.id === 'npc-runtime'), false);
  assert.ok(pack.worldBook.find((entry) => entry.id === 'community-runtime-compatibility-contract'));
  assert.equal(pack.worldSystems.topology.nodes[0].name, '十二国疆域');
  assert.equal(pack.resourceManifest.composition.playableWorldBook.safetyMode, 'safe-degradation');
  assert.equal(pack.resourceManifest.composition.playableWorldBook.blockedCount, 1);
  assert.equal(pack.resourceManifest.composition.playableCharacter.rawExcluded, true);
  assert.equal(pack.openingTemplate.destinyCards.stepLabel, '开局要素');
  assert.equal(pack.openingTemplate.destinyCards.maxSelections, 0);
  assert.deepEqual(pack.openingTemplate.destinyCards.cards, []);
});

test('custom pack opening template follows imported character lore instead of its visual fallback', async () => {
  const service = await createService();
  const saved = await service.savePreview(createCharacterPreview({
    name: '云照影',
    description: '玄幻仙侠世界中的散修，身负特殊体质。',
    personality: '谨慎克制，不轻信宗门许诺。',
    scenario: '她在宗门试炼前夜发现自己的灵根与旧案有关。',
    firstMessage: '试炼钟声将在子时敲响，云照影必须在封山前找到被调换的名册。'
  }), { site: '类脑社区' });
  const character = saved.resources.find((item) => item.kind === 'character');
  const worldBook = saved.resources.find((item) => item.kind === 'worldbook');

  const pack = await service.createPack({
    title: '云照影的独立仙途',
    visualPackId: 'xuanhuan',
    includeBaseContent: false,
    characterResourceId: character.id,
    worldBookResourceIds: [worldBook.id]
  });

  assert.equal(pack.openingTemplate.genre, 'xianxia');
  assert.equal(pack.openingTemplate.title, '云照影的独立仙途');
  assert.match(pack.openingTemplate.subtitle, /云照影/);
  assert.ok(Object.values(pack.openingTemplate.tabs).some((tab) => tab.label === '听雨楼'));
  assert.equal(pack.openingTemplate.destinyCards.cards.some((card) => /雁回|粮仓灯火|天机榜异动/.test(card.title)), false);
  assert.match(pack.openingTemplate.fields.goal.defaultValue, /宗门试炼|散修|特殊体质/);
  assert.match(pack.openingTemplate.fields.openingPressure.defaultValue, /试炼钟声|封山|名册/);
  assert.doesNotMatch(pack.openingTemplate.fields.goal.defaultValue, /天道残缺|落雷秘境/);
  assert.doesNotMatch(pack.openingTemplate.fields.openingPressure.defaultValue, /落雷秘境/);
});

test('scenario character cards define the player role without inheriting system protagonist randomness', async () => {
  const service = await createService();
  const saved = await service.savePreview(createCharacterPreview({
    name: '女仆之家',
    description: '',
    personality: '',
    role: '个人创作主角',
    scenario: '庄园管理报告。提交人：庄园管家神宫寺遥。收件人：主人。',
    firstMessage: '神宫寺遥将人员配置与财务报告放在桌上，请主人审阅并决定今天的安排。'
  }, [{
    id: 'compatibility-note',
    title: '修真词汇兼容说明',
    content: '部分旧素材会提及灵气、境界与功法，但不属于本剧本的主线设定。',
    enabled: true
  }]), { site: '类脑社区' });
  const character = saved.resources.find((item) => item.kind === 'character');
  const worldBook = saved.resources.find((item) => item.kind === 'worldbook');

  const pack = await service.createPack({
    title: '女仆之家的故事',
    visualPackId: 'lingyi',
    includeBaseContent: false,
    characterResourceId: character.id,
    worldBookResourceIds: [worldBook.id]
  });
  const template = pack.openingTemplate;
  const serialized = JSON.stringify(template.fields);

  assert.equal(template.source, 'custom-pack');
  assert.equal(template.genreLabel, '角色卡原生剧本');
  assert.equal(template.protagonist.mode, 'scenario-role');
  assert.equal(template.protagonist.name, '主人');
  assert.equal(template.protagonist.role, '庄园主人');
  assert.equal(template.protagonist.allowSystemRandom, false);
  assert.equal(template.fields.name.defaultValue, '主人');
  assert.equal(template.fields.role.defaultValue, '庄园主人');
  assert.match(template.fields.goal.defaultValue, /人员配置|财务报告|今天的安排/);
  assert.match(template.fields.openingPressure.defaultValue, /神宫寺遥|主人审阅/);
  assert.ok(Object.keys(template.fields).length <= 5);
  assert.deepEqual(template.sidebar.tabs, [
    '当前态势',
    '决策线索',
    '角色档案',
    '人物网络',
    '成长轨迹',
    '叙事记忆',
    '世界规则',
  ]);
  assert.doesNotMatch(serialized, /个人创作主角|筑基|雷火|天命榜|落雷秘境/);
});

test('custom opening fields extract protagonist goals, risks, relationships, and alternate greetings from imported lore', async () => {
  const service = await createService();
  const saved = await service.savePreview(createCharacterPreview({
    name: '仙侠雌竞-我是炉鼎体质',
    description: '凌霄宗外门杂役，身负不为人知的特殊体质。',
    scenario: '',
    firstMessage: '【作者署名】',
    alternateGreetings: [
      '三月初春，凌霄山脉云雾缭绕。{{user}}提着包裹站在外门杂役院前，江小鲤气喘吁吁地向他跑来。'
    ]
  }, [{
    id: 'protagonist-profile',
    title: '{{user}}人设',
    content: `<男主角>
[角色：凌霄宗外门杂役，特殊体质拥有者]
[背景与家庭生活：小渔村孤儿，从小与江小鲤相依为命。实际上拥有修真界第一体质"荒古肾体"，一旦暴露便会引来争夺。]
</男主角>`,
    enabled: true
  }, {
    id: 'constitution-risk',
    title: '体质发现与后果',
    content: `体质发现与后果
- 宗门高层：秘密圈养，当做宗门至宝
保密的重要性：荒古肾体一旦暴露，将成为整个修真界的焦点，无数势力会出手争夺。`,
    enabled: true
  }]), { site: '类脑社区' });
  const character = saved.resources.find((item) => item.kind === 'character');
  const worldBook = saved.resources.find((item) => item.kind === 'worldbook');

  const pack = await service.createPack({
    title: '炉鼎体质的故事',
    includeBaseContent: false,
    characterResourceId: character.id,
    worldBookResourceIds: [worldBook.id]
  });
  const fields = pack.openingTemplate.fields;

  assert.equal(fields.role.defaultValue, '凌霄宗外门杂役，特殊体质拥有者');
  assert.match(fields.goal.defaultValue, /荒古肾体|江小鲤/);
  assert.doesNotMatch(fields.goal.defaultValue, /["”]|。。/);
  assert.match(fields.secret.defaultValue, /一旦暴露|整个修真界|争夺/);
  assert.notEqual(fields.secret.defaultValue, '体质发现与后果');
  assert.match(fields.relationshipStyle.defaultValue, /江小鲤|相依为命/);
  assert.match(fields.openingPressure.defaultValue, /外门杂役院|江小鲤/);
  assert.doesNotMatch(JSON.stringify(fields), /天道残缺|同命格敌手|落雷秘境/);
});

test('genre inheritance keeps portable rules without importing the base story route or memory', async () => {
  const service = await createService();
  const saved = await service.savePreview(createCharacterPreview(), { site: '类脑社区' });
  const character = saved.resources.find((item) => item.kind === 'character');
  const worldBook = saved.resources.find((item) => item.kind === 'worldbook');
  const basePack = {
    id: 'xianxia',
    title: '太虚仙侠',
    promptModules: [
      {
        id: 'xianxia-core-rules',
        title: '修行通用规则',
        content: '修行必须支付代价。',
        enabled: true,
        extensions: { inheritanceScope: 'genre' }
      },
      {
        id: 'xianxia-core-route-contract',
        title: '断魂灯固定主线',
        content: '始终追查断魂灯。',
        enabled: true,
        extensions: { inheritanceScope: 'story' }
      }
    ],
    worldBook: [
      {
        id: 'portable-cultivation-rules',
        title: '修行通则',
        content: '境界突破必须积累。',
        enabled: true,
        extensions: { inheritanceScope: 'genre' }
      },
      { id: 'base-lore', title: '太虚界', content: '落雷山脉藏有断魂灯。', enabled: true }
    ],
    characterCard: { name: '旧主角' },
    characterPresets: [{ id: 'old-actor', characterCard: { name: '闻雪照' } }],
    groupMembers: [{ id: 'old-group', name: '赤松子' }],
    memory: {
      rollingSummary: '闻雪照正在追查断魂灯。',
      worldState: {
        flags: { genre: 'xianxia' },
        quests: [{ title: '补全断魂灯', status: 'active' }]
      },
      memoryCards: [{ id: 'old-plot', title: '旧主线', content: '落雷山脉' }]
    },
    ruleSystem: {
      id: 'xianxia-rules',
      title: '太虚规则',
      boundary: '只使用太虚人物与旧案。',
      panels: [{ id: 'old-route', title: '断魂灯', content: '固定主线' }]
    }
  };

  const pack = await service.createPack({
    title: '导入角色新卷',
    basePackId: 'xianxia',
    baseInheritanceMode: 'genre',
    characterResourceId: character.id,
    worldBookResourceIds: [worldBook.id]
  }, { basePack });

  assert.equal(pack.resourceManifest.baseInheritanceMode, 'genre');
  assert.deepEqual(pack.characterPresets, []);
  assert.deepEqual(pack.groupMembers, []);
  assert.ok(pack.worldBook.find((entry) => entry.title === '修行通则'));
  assert.ok(pack.worldBook.find((entry) => entry.title === '听雨楼'));
  assert.equal(pack.worldBook.some((entry) => entry.title === '太虚界'), false);
  assert.ok(pack.promptModules.find((module) => module.id === 'xianxia-core-rules'));
  assert.equal(pack.promptModules.some((module) => module.id === 'xianxia-core-route-contract'), false);
  assert.equal(pack.memory.rollingSummary, '');
  assert.deepEqual(pack.memory.memoryCards, []);
  assert.equal(pack.memory.worldState.flags.genre, 'xianxia');
  assert.deepEqual(pack.ruleSystem.panels, []);
  assert.match(pack.ruleSystem.boundary, /角色卡及其同批世界书决定/);
});

test('resource library can promote an imported character portrait to the story stage background', async () => {
  const service = await createService();
  const assetId = 'b'.repeat(64);
  const saved = await service.savePreview(createCharacterPreview({
    portrait: {
      assetId,
      url: `/api/character-images/${assetId}.png`,
      mimeType: 'image/png',
      width: 512,
      height: 768,
      source: 'embedded-character-card'
    }
  }), { site: '类脑社区' });
  const character = saved.resources.find((item) => item.kind === 'character');

  const pack = await service.createPack({
    title: '听雨新卷',
    characterResourceId: character.id,
    useCharacterPortraitAsBackground: true,
    customBaseline: {
      worldName: '听雨江湖',
      genre: '低魔武侠',
      premise: '门派以驿路和盐道争夺生计。'
    }
  });
  const summary = (await service.listPacks())[0];

  assert.deepEqual(pack.stageBackground, {
    url: `/api/character-images/${assetId}.png`,
    assetId,
    source: 'character-portrait',
    fit: 'portrait',
    label: '沈观澜立绘'
  });
  assert.equal(pack.resourceManifest.useCharacterPortraitAsBackground, true);
  assert.deepEqual(summary.stageBackground, pack.stageBackground);
});

test('resource library previews world book conflicts and smart merge replaces same-title base entries', async () => {
  const service = await createService();
  const saved = await service.savePreview(createCharacterPreview(), { site: '类脑社区' });
  const worldBook = saved.resources.find((item) => item.kind === 'worldbook');
  const basePack = {
    id: 'wuxia',
    title: '武侠基线',
    promptModules: [],
    worldBook: [{
      id: 'base-tingyu',
      title: '听雨楼',
      content: '听雨楼只是一间普通客栈。',
      keywords: ['听雨楼'],
      enabled: true
    }],
    characterCard: { name: '旧主角' },
    memory: { memoryCards: [], worldState: { flags: { genre: 'wuxia' } } },
    ruleSystem: { id: 'wuxia-rules', title: '武侠规则', boundary: '武侠', panels: [] }
  };

  const composition = await service.inspectPackComposition({
    worldBookResourceIds: [worldBook.id],
    worldBookMergeMode: 'smart'
  }, { basePack });
  assert.equal(composition.summary.sameTitleConflicts, 1);
  assert.equal(composition.summary.replacedBaseEntries, 1);
  assert.equal(composition.summary.finalEntries, 1);

  const pack = await service.createPack({
    title: '听雨新卷',
    worldBookResourceIds: [worldBook.id],
    worldBookMergeMode: 'smart'
  }, { basePack });
  assert.equal(pack.worldBook.length, 1);
  assert.equal(pack.worldBook[0].content, '听雨楼以消息定价，不问来路。');
  assert.equal(pack.resourceManifest.composition.sameTitleConflicts, 1);
});

test('resource library validates prompt id conflicts and external runtime requirements before composition', async () => {
  const service = await createService();
  const savedPrompt = await service.savePromptResource({
    id: 'base-prompt',
    title: '社区叙事预设',
    content: '依赖酒馆助手更新变量；最终行文保持克制。',
    source: { site: '类脑社区' }
  });
  const prompt = savedPrompt.resources[0];
  const basePack = {
    id: 'wuxia',
    title: '武侠基线',
    promptModules: [{ id: 'base-prompt', title: '基线叙事', content: '遵循江湖规则。', enabled: true }],
    worldBook: [],
    characterCard: { name: '旧主角' },
    memory: { memoryCards: [], worldState: { flags: { genre: 'wuxia' } } },
    ruleSystem: { id: 'wuxia-rules', title: '武侠规则', boundary: '武侠', panels: [] }
  };

  const inspection = await service.inspectPackComposition({
    promptResourceIds: [prompt.id]
  }, { basePack });

  assert.equal(inspection.summary.promptIdConflicts, 1);
  assert.equal(inspection.summary.replacedPromptModules, 1);
  assert.equal(inspection.promptModules.final, 1);
  assert.equal(inspection.communityCompatibility.level, 'external-runtime');
  assert.equal(inspection.communityCompatibility.counts.missing, 1);
  assert.equal(inspection.compatibilityReview.sourceRuntimeBlocked, true);
  assert.equal(inspection.compatibilityReview.safeDerivativeAvailable, true);
  assert.ok(inspection.compatibilityReview.blockers.some((item) => item.id === 'tavern-helper'));

  const packInput = {
    title: '社区预设卷',
    promptResourceIds: [prompt.id]
  };
  await assert.rejects(
    () => service.createPack(packInput, { basePack }),
    (error) => error.code === 'RESOURCE_PACK_REVIEW_REQUIRED'
  );
  const pack = await createPackWithPreflightApproval(service, packInput, { basePack });
  assert.equal(pack.promptModules.length, 1);
  assert.equal(pack.promptModules[0].title, '社区叙事预设');
  assert.equal(pack.resourceManifest.composition.promptModules.promptIdConflicts, 1);
  assert.equal(pack.resourceManifest.composition.compatibilityReview.status, 'safe-derivative-approved');
  assert.ok(pack.resourceManifest.composition.compatibilityReview.disabledCapabilities
    .some((item) => item.id === 'tavern-helper'));
});

test('pack preflight stabilizes legacy resource revisions before binding approval fingerprints', async () => {
  const service = await createService();
  const saved = await service.savePromptResource({
    id: 'legacy-script-preset',
    title: '旧版脚本预设',
    content: '依赖酒馆助手更新状态；正文保持叙事克制。'
  });
  const prompt = saved.resources[0];
  const legacy = structuredClone(prompt);
  delete legacy.revision;
  await service.repository.writeResource(prompt.id, legacy);
  await service.repository.removeResourceRevisions(prompt.id);

  const input = {
    title: '旧素材稳定预检卷',
    promptResourceIds: [prompt.id],
    customBaseline: {
      worldName: '旧素材稳定预检卷',
      premise: '验证预检和正式创建使用同一资源版本。'
    }
  };
  const inspection = await service.inspectPackComposition(input);
  const review = inspection.compatibilityReview;
  const versioned = await service.getResource(prompt.id);

  assert.ok(versioned.revision?.headId);
  assert.equal(review.rules.length, 0);
  assert.equal(review.requiresCompatibilityAcknowledgement, true);
  const pack = await service.createPack({
    ...input,
    compatibilityReview: {
      fingerprint: review.fingerprint,
      approvedScriptHashes: review.rules.map((rule) => rule.contentHash),
      acknowledgeCompatibility: review.requiresCompatibilityAcknowledgement
    }
  });
  assert.equal(pack.resourceManifest.composition.compatibilityReview.fingerprint, review.fingerprint);
});

test('pack preflight reports preset player-agency conflicts against the selected roleplay mode', async () => {
  const service = await createService();
  const playerWriting = await service.savePromptResource({
    id: 'preset-player-writing',
    title: '抢话规则',
    content: '自动替用户补写动作和对白。'
  });
  const dialogueDensity = await service.savePromptResource({
    id: 'preset-dialogue-density',
    title: '对话增多',
    content: '增加 NPC 之间的有效对白。'
  });
  const promptResourceIds = [
    playerWriting.resources[0].id,
    dialogueDensity.resources[0].id
  ];
  const basePack = {
    id: 'interaction-baseline',
    title: '互动基线',
    promptModules: [],
    worldBook: [],
    characterCard: { name: '测试主角' },
    memory: { memoryCards: [], worldState: {} },
    ruleSystem: { id: 'test-rules', title: '测试规则', boundary: '测试', panels: [] }
  };

  const dmInspection = await service.inspectPackComposition({
    promptResourceIds,
    roleplayMode: 'dm'
  }, { basePack });
  assert.equal(dmInspection.compatibilityReview.interaction.roleplayMode, 'dm');
  assert.equal(dmInspection.compatibilityReview.interaction.semantics.requestsPlayerWriting, true);
  assert.equal(dmInspection.compatibilityReview.interaction.semantics.requestsMoreDialogue, true);
  assert.ok(dmInspection.compatibilityReview.interaction.conflicts
    .some((item) => item.type === 'preset-player-writing-conflict'));

  const directorInspection = await service.inspectPackComposition({
    promptResourceIds,
    roleplayMode: 'director'
  }, { basePack });
  assert.equal(directorInspection.compatibilityReview.interaction.roleplayMode, 'director');
  assert.equal(directorInspection.compatibilityReview.interaction.hasConflict, false);
});

test('resource library stores SillyTavern preset modules in order and reports disabled runtime dependencies', async () => {
  const service = await createService();
  const preview = previewImportPayload({
    fileName: 'community-preset.json',
    mimeType: 'application/json',
    data: JSON.stringify({
      name: '社区长篇预设',
      settings: { max_context: 48000, temperature: 0.76 },
      prompts: [
        {
          id: 'main',
          name: '主提示',
          enabled: true,
          role: 'system',
          content: '先遵循世界边界，再推进人物关系。',
          position: { type: 'relative' }
        },
        {
          id: 'history-rule',
          name: '历史后约束',
          enabled: true,
          role: 'user',
          content: '不得跳出角色解释规则。',
          position: { type: 'in_chat', depth: 1, order: 5 }
        }
      ],
      extensions: {
        regex_scripts: [{
          scriptName: '状态过滤',
          findRegex: '/<state>[\\s\\S]*?<\\/state>/g',
          replaceString: '',
          placement: [2],
          markdownOnly: true
        }],
        tavern_helper: { scripts: [{ id: 'state-hook' }] }
      }
    })
  });

  const inspection = await service.inspectPreview(preview, {
    site: '类脑社区',
    fileName: 'community-preset.json'
  });
  const saved = await service.savePreview(preview, {
    site: '类脑社区',
    fileName: 'community-preset.json'
  }, { inspection });

  assert.equal(inspection.adapter.id, 'sillytavern-prompt-preset');
  assert.equal(inspection.resources.length, 1);
  assert.equal(inspection.resources[0].kind, 'prompt-bundle');
  assert.equal(inspection.communityCompatibility.level, 'external-runtime');
  assert.equal(
    inspection.communityCompatibility.requirements.find((item) => item.id === 'prompt-preset-order').status,
    'supported'
  );
  assert.equal(
    inspection.communityCompatibility.requirements.find((item) => item.id === 'tavern-helper').status,
    'missing'
  );
  assert.equal(saved.resources.length, 1);
  assert.equal(saved.resources[0].kind, 'prompt-bundle');
  assert.equal(saved.resources[0].payload.promptModules.length, 3);
  assert.equal(saved.resources[0].payload.promptModules[0].title, '主提示');
  assert.equal(saved.resources[0].payload.promptModules[1].position, 'in_chat');
  assert.equal(saved.resources[0].payload.promptModules[1].depth, 1);
  assert.equal(saved.resources[0].payload.promptModules[2].enabled, false);
  assert.equal(saved.resources[0].payload.promptModules[2].extensions.sillyTavernRuntimeCompanion.kind, 'regex');
  assert.deepEqual(saved.resources[0].collections, ['社区长篇预设']);
  assert.equal(
    saved.resources[0].payload.generationSettings.maxContext,
    48000
  );
  assert.equal(
    saved.resources[0].payload.promptModules[0].extensions.sillyTavernPreset.generationSettings,
    undefined
  );

  const pack = await createPackWithPreflightApproval(service, {
    title: '社区预设运行卷',
    promptResourceIds: [saved.resources[0].id],
    customBaseline: {
      worldName: '社区预设运行卷',
      genre: '长篇角色扮演',
      premise: '验证提示词与配套 Regex 能共同进入剧本运行时。'
    }
  });
  assert.equal(pack.promptModules.length, 3);
  assert.equal(
    pack.promptModules.some((module) => module.extensions?.sillyTavernRuntimeCompanion),
    false
  );
  assert.equal(pack.lightFrontend.regexTransforms.length, 1);
  assert.equal(pack.lightFrontend.regexTransforms[0].name, '状态过滤');
  assert.equal(pack.lightFrontend.executesThirdPartyCode, false);
});

test('custom pack creation requires the exact preflight script hash before storing executable rules', async () => {
  const service = await createService();
  const preview = previewImportPayload({
    fileName: 'scripted-preset.json',
    mimeType: 'application/json',
    data: JSON.stringify({
      name: '动态面板预设',
      prompts: [{
        id: 'main',
        name: '主提示',
        enabled: true,
        role: 'system',
        content: '遵循角色卡与世界书。'
      }],
      extensions: {
        regex_scripts: [{
          scriptName: '联网动态面板',
          findRegex: '/<widget>[\\s\\S]*?<\\/widget>/g',
          replaceString: '<script>fetch("https://example.com/panel")</script>',
          placement: [2],
          markdownOnly: true
        }]
      }
    })
  });
  const imported = await service.savePreview(preview, {
    site: '类脑社区',
    fileName: 'scripted-preset.json'
  });
  const promptBundle = imported.resources[0];
  const input = {
    title: '脚本审批测试卷',
    promptResourceIds: [promptBundle.id],
    customBaseline: {
      worldName: '脚本审批测试卷',
      premise: '验证第三方脚本必须在组装结束前完成审核。'
    }
  };
  const inspection = await service.inspectPackComposition(input);
  const review = inspection.compatibilityReview;

  assert.equal(review.contractVersion, 2);
  assert.equal(review.requiresScriptApproval, true);
  assert.equal(review.rules.length, 1);
  assert.equal(review.rules[0].riskLevel, 'high');
  assert.ok(review.rules[0].risks.includes('network-request'));
  assert.match(review.rules[0].source, /fetch/);
  assert.match(review.rules[0].pattern, /widget/);
  await assert.rejects(
    () => service.createPack(input),
    (error) => error.code === 'RESOURCE_PACK_REVIEW_REQUIRED'
  );
  await assert.rejects(
    () => service.createPack({
      ...input,
      compatibilityReview: {
        fingerprint: 'sha256:stale-review',
        approvedScriptHashes: [review.rules[0].contentHash],
        acknowledgeCompatibility: false
      }
    }),
    (error) => error.code === 'RESOURCE_PACK_REVIEW_STALE'
  );
  await assert.rejects(
    () => service.createPack({
      ...input,
      compatibilityReview: {
        fingerprint: review.fingerprint,
        approvedScriptHashes: ['sha256:wrong'],
        acknowledgeCompatibility: false
      }
    }),
    (error) => error.code === 'RESOURCE_PACK_SCRIPT_APPROVAL_REQUIRED'
  );

  const pack = await service.createPack({
    ...input,
    compatibilityReview: {
      fingerprint: review.fingerprint,
      approvedScriptHashes: [review.rules[0].contentHash],
      acknowledgeCompatibility: review.requiresCompatibilityAcknowledgement
    }
  });
  assert.deepEqual(pack.lightFrontend.trustedScriptIds, [review.rules[0].scriptId]);
  assert.equal(pack.lightFrontend.scriptReviews[0].contentHash, review.rules[0].contentHash);
  assert.equal(pack.resourceManifest.composition.compatibilityReview.contractVersion, 2);
  assert.equal(pack.resourceManifest.composition.compatibilityReview.status, 'safe-derivative-approved');
  assert.ok(pack.resourceManifest.composition.compatibilityReview.disabledCapabilities
    .some((item) => item.id === 'executable-extension'));
});

test('resource library creates a runnable original pack without a parent content pack', async () => {
  const service = await createService();
  const pack = await service.createPack({
    title: '九州残卷',
    worldBookMergeMode: 'smart',
    customBaseline: {
      worldName: '九州残卷',
      genre: '低魔武侠',
      premise: '九州诸侯割据，江湖门派依附盐路与驿道生存。',
      proseStyle: '克制对白，重人情与制度后果。',
      hardRules: '伤势、路引与钱粮必须持续有效。',
      visualPackId: 'yingxiongzhi'
    }
  });

  assert.equal(pack.resourceManifest.basePackId, '');
  assert.equal(pack.visualPackId, 'yingxiongzhi');
  assert.equal(pack.worldBook.length, 2);
  assert.equal(pack.worldBook.every((entry) => entry.constant), true);
  assert.equal(pack.promptModules.length, 1);
  assert.match(pack.promptModules[0].content, /克制对白/);
  assert.match(pack.ruleSystem.boundary, /伤势/);
});

test('legacy custom packs can be re-inspected into a new audited pack without overwriting the source', async () => {
  const service = await createService();
  const source = await service.createPack({
    title: '九州旧卷',
    customBaseline: {
      worldName: '九州旧卷',
      genre: '低魔武侠',
      premise: '盐路中断后，各门派必须重新选择盟友。',
      proseStyle: '克制对白与行动后果。',
      hardRules: '伤势、钱粮与路引持续有效。',
      visualPackId: 'neutral'
    }
  });
  const legacy = await service.getPack(source.id);
  delete legacy.resourceManifest.composition.compatibilityReview;
  delete legacy.resourceManifest.customBaseline;
  await service.repository.writePack(legacy.id, legacy);

  const preview = await service.inspectPackCompatibilityUpgrade(legacy.id);
  const review = preview.compatibilityReview;
  const upgraded = await service.createPackCompatibilityUpgrade(legacy.id, {
    compatibilityReview: {
      fingerprint: review.fingerprint,
      approvedScriptHashes: [],
      acknowledgeCompatibility: review.requiresCompatibilityAcknowledgement
    }
  });
  const unchanged = await service.getPack(legacy.id);

  assert.equal(preview.rebuildable, true);
  assert.equal(preview.createsNewPack, true);
  assert.equal(preview.keepsExistingBindings, true);
  assert.equal(preview.resourceRevisionChanges.length, 0);
  assert.notEqual(upgraded.id, legacy.id);
  assert.equal(upgraded.title, '九州旧卷 · 兼容复审版');
  assert.equal(upgraded.resourceManifest.compatibilityUpgrade.sourcePackId, legacy.id);
  assert.equal(upgraded.resourceManifest.compatibilityUpgrade.contractVersion, 2);
  assert.equal(upgraded.resourceManifest.composition.compatibilityReview.contractVersion, 2);
  assert.ok(upgraded.worldBook.some((item) => /盐路中断/u.test(item.content)));
  assert.ok(upgraded.promptModules.some((item) => /克制对白/u.test(item.content)));
  assert.equal(unchanged.resourceManifest.composition.compatibilityReview, undefined);
});

test('legacy packs use stored source fingerprints when revision history predates the revision system', async () => {
  const service = await createService();
  const imported = await service.savePreview(createCharacterPreview(), {
    site: 'local-file',
    fileName: 'legacy-fingerprint-character.json'
  });
  const character = imported.resources.find((item) => item.kind === 'character');
  const source = await service.createPack({
    title: '指纹可确认旧卷',
    characterResourceId: character.id,
    customBaseline: { worldName: '指纹可确认旧卷', premise: '验证 revision 系统上线前的素材。' },
    includeBaseContent: false
  });
  const legacyPack = await service.getPack(source.id);
  delete legacyPack.resourceManifest.composition.compatibilityReview;
  delete legacyPack.resourceManifest.resourceRevisionIds;
  await service.repository.writePack(legacyPack.id, legacyPack);
  const legacyResource = await service.getResource(character.id);
  delete legacyResource.revision;
  await service.repository.writeResource(legacyResource.id, legacyResource);

  const unchangedPreview = await service.inspectPackCompatibilityUpgrade(legacyPack.id);
  const unchanged = unchangedPreview.resourceRevisionChanges[0];

  assert.equal(unchanged.comparisonBasis, 'fingerprint');
  assert.equal(unchanged.fingerprintConfirmed, true);
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.revisionUnknown, false);

  await service.repository.writeResource(legacyResource.id, {
    ...legacyResource,
    fingerprint: 'changed-content-fingerprint'
  });
  const changedPreview = await service.inspectPackCompatibilityUpgrade(legacyPack.id);
  const changed = changedPreview.resourceRevisionChanges[0];

  assert.equal(changed.comparisonBasis, 'fingerprint');
  assert.equal(changed.fingerprintConfirmed, false);
  assert.equal(changed.changed, true);
  assert.equal(changed.revisionUnknown, false);
});

test('compatibility upgrade folds legacy preset fragments into one versioned prompt bundle without rewriting the source pack', async () => {
  const service = await createService();
  const importedAt = '2026-07-29T04:40:03.637Z';
  const importBatchId = 'legacy-preset-batch';
  const modules = [
    {
      id: 'legacy-module-b',
      title: '第二模块',
      enabled: false,
      content: '第二模块保持停用。',
      sequence: 2
    },
    {
      id: 'legacy-module-a',
      title: '第一模块',
      enabled: true,
      content: '第一模块保持启用。',
      sequence: 1
    },
    {
      id: 'legacy-runtime',
      title: 'Regex 运行伴侣',
      enabled: false,
      content: '',
      sequence: 3,
      runtimeCompanion: { kind: 'regex', ruleCount: 4 }
    }
  ];
  for (const module of modules) {
    const payload = {
      id: module.id,
      title: module.title,
      enabled: module.enabled,
      content: module.content,
      extensions: {
        sillyTavernPreset: {
          presetTitle: '旧版社区预设',
          sourceFormat: 'sillytavern-preset',
          sequence: module.sequence,
          generationSettings: { maxContext: 200000 },
          promptLayout: modules.map((item) => ({ id: item.id, enabled: item.enabled }))
        },
        ...(module.runtimeCompanion
          ? { sillyTavernRuntimeCompanion: module.runtimeCompanion }
          : {})
      }
    };
    await service.repository.writeResource(module.id, {
      id: module.id,
      kind: 'prompt',
      title: module.title,
      summary: module.content,
      tags: ['SillyTavern'],
      collections: ['旧版社区预设'],
      favorite: false,
      format: 'sillytavern-prompt-preset',
      fingerprint: createFingerprint(payload),
      source: {
        site: 'local-file',
        fileName: 'legacy-community-preset.json',
        importBatchId,
        importedAt
      },
      diagnostics: { score: 80, estimatedTokens: 100 },
      payload,
      createdAt: importedAt,
      updatedAt: importedAt
    });
  }

  const source = await service.createPack({
    title: '旧分片剧本',
    promptResourceIds: modules.map((module) => module.id),
    customBaseline: {
      worldName: '旧分片剧本',
      premise: '验证旧预设分片只在新派生剧本中折叠。'
    }
  });
  const legacy = await service.getPack(source.id);
  delete legacy.resourceManifest.composition.compatibilityReview;
  await service.repository.writePack(legacy.id, legacy);

  const preview = await service.inspectPackCompatibilityUpgrade(legacy.id);
  const migration = preview.promptBundleMigration;
  const targetResourceId = migration.items[0].targetResourceId;

  assert.equal(preview.rebuildable, true);
  assert.equal(preview.assemblyInput.promptResourceIds.length, 3);
  assert.equal(preview.composition.promptModules.selected, 1);
  assert.equal(migration.sourceResourceCount, 3);
  assert.equal(migration.targetBundleCount, 1);
  assert.equal(migration.moduleCount, 2);
  assert.equal(migration.enabledModuleCount, 1);
  assert.equal(migration.runtimeCompanionCount, 1);
  assert.equal(await service.getResource(targetResourceId), null);

  const review = preview.compatibilityReview;
  const upgraded = await service.createPackCompatibilityUpgrade(legacy.id, {
    compatibilityReview: {
      fingerprint: review.fingerprint,
      approvedScriptHashes: review.rules.map((rule) => rule.contentHash),
      acknowledgeCompatibility: review.requiresCompatibilityAcknowledgement
    }
  });
  const bundle = await service.getResource(targetResourceId);
  const unchanged = await service.getPack(legacy.id);

  assert.equal(bundle.kind, 'prompt-bundle');
  assert.deepEqual(bundle.payload.promptModules.map((module) => module.id), [
    'legacy-module-a',
    'legacy-module-b',
    'legacy-runtime'
  ]);
  assert.deepEqual(bundle.payload.promptModules.map((module) => module.enabled), [true, false, false]);
  assert.equal(bundle.payload.generationSettings.maxContext, 200000);
  assert.equal(bundle.payload.promptModules[0].extensions.sillyTavernPreset.generationSettings, undefined);
  assert.deepEqual(upgraded.resourceManifest.promptResourceIds, [targetResourceId]);
  assert.equal(upgraded.resourceManifest.compatibilityUpgrade.promptBundleMigration.sourceResourceCount, 3);
  assert.deepEqual(unchanged.resourceManifest.promptResourceIds, modules.map((module) => module.id));
});

test('compatibility upgrade refuses to fabricate a pack after an original resource was removed', async () => {
  const service = await createService();
  const imported = await service.savePreview(createCharacterPreview(), {
    site: 'local-file',
    fileName: 'legacy-character.json'
  });
  const character = imported.resources.find((item) => item.kind === 'character');
  const source = await service.createPack({
    title: '缺失素材旧卷',
    characterResourceId: character.id,
    customBaseline: { worldName: '缺失素材旧卷', premise: '验证缺失素材时失败关闭。' },
    includeBaseContent: false
  });
  const legacy = await service.getPack(source.id);
  delete legacy.resourceManifest.composition.compatibilityReview;
  await service.repository.writePack(legacy.id, legacy);
  await service.removeResource(character.id);

  const preview = await service.inspectPackCompatibilityUpgrade(legacy.id);

  assert.equal(preview.rebuildable, false);
  assert.ok(preview.issues.some((item) => (
    item.code === 'RESOURCE_PACK_UPGRADE_RESOURCE_MISSING'
    && item.resourceId === character.id
  )));
  await assert.rejects(
    () => service.createPackCompatibilityUpgrade(legacy.id, {}),
    (error) => error.code === 'RESOURCE_PACK_UPGRADE_NOT_REBUILDABLE'
  );
});

test('pack compatibility overview separates audited, upgradeable, script-review and blocked packs', async () => {
  const service = await createService();
  const audited = await service.createPack({
    title: '已审核卷',
    customBaseline: { worldName: '已审核卷', premise: '当前契约素材包。' }
  });
  const upgradeable = await service.createPack({
    title: '历史卷',
    customBaseline: { worldName: '历史卷', premise: '可以无损复审。' }
  });
  const legacyUpgradeable = await service.getPack(upgradeable.id);
  delete legacyUpgradeable.resourceManifest.composition.compatibilityReview;
  await service.repository.writePack(legacyUpgradeable.id, legacyUpgradeable);

  const scriptImport = await service.savePreview(previewImportPayload({
    fileName: 'overview-script.json',
    mimeType: 'application/json',
    data: JSON.stringify({
      name: '审核脚本预设',
      prompts: [{ id: 'main', name: '主提示', enabled: true, role: 'system', content: '保持设定。' }],
      extensions: {
        regex_scripts: [{
          scriptName: '状态脚本',
          findRegex: '/<state>[\\s\\S]*?<\\/state>/g',
          replaceString: '<script>state.value = 1</script>',
          placement: [2]
        }]
      }
    })
  }), { site: 'local-file', fileName: 'overview-script.json' });
  const prompt = scriptImport.resources[0];
  const scriptInput = {
    title: '脚本历史卷',
    promptResourceIds: [prompt.id],
    customBaseline: { worldName: '脚本历史卷', premise: '必须逐项复审脚本。' }
  };
  const scriptInspection = await service.inspectPackComposition(scriptInput);
  const scripted = await service.createPack({
    ...scriptInput,
    compatibilityReview: {
      fingerprint: scriptInspection.compatibilityReview.fingerprint,
      approvedScriptHashes: scriptInspection.compatibilityReview.rules.map((rule) => rule.contentHash),
      acknowledgeCompatibility: scriptInspection.compatibilityReview.requiresCompatibilityAcknowledgement
    }
  });
  const legacyScripted = await service.getPack(scripted.id);
  delete legacyScripted.resourceManifest.composition.compatibilityReview;
  await service.repository.writePack(legacyScripted.id, legacyScripted);

  const missingImport = await service.savePreview(createCharacterPreview(), {
    site: 'local-file',
    fileName: 'overview-missing.json'
  });
  const character = missingImport.resources.find((item) => item.kind === 'character');
  const missing = await service.createPack({
    title: '素材缺失卷',
    characterResourceId: character.id,
    customBaseline: { worldName: '素材缺失卷', premise: '素材删除后阻断。' }
  });
  const legacyMissing = await service.getPack(missing.id);
  delete legacyMissing.resourceManifest.composition.compatibilityReview;
  await service.repository.writePack(legacyMissing.id, legacyMissing);
  await service.removeResource(character.id);

  const overview = await service.listPackCompatibilityOverview();
  const byId = new Map(overview.packs.map((item) => [item.packId, item]));

  assert.equal(overview.spec, 'lra.pack-compatibility-overview/v1');
  assert.equal(byId.get(audited.id).status, 'audited');
  assert.equal(byId.get(audited.id).canStartNewStory, true);
  assert.equal(byId.get(upgradeable.id).status, 'upgrade-available');
  assert.equal(byId.get(upgradeable.id).action, 'upgrade');
  assert.equal(byId.get(scripted.id).status, 'script-review-required');
  assert.equal(byId.get(scripted.id).scriptCount, 1);
  assert.equal(byId.get(missing.id).status, 'blocked');
  assert.match(byId.get(missing.id).reason, /已不在本地素材库/);
  assert.deepEqual(overview.summary, {
    total: 4,
    audited: 1,
    safeDerivative: 0,
    upgradeAvailable: 1,
    scriptReviewRequired: 1,
    blocked: 1,
    attention: 3
  });
});

test('stored packs can update bookshelf metadata and be removed without deleting source resources', async () => {
  const service = await createService();
  const saved = await service.savePreview(createCharacterPreview(), { site: '类脑社区' });
  const character = saved.resources.find((item) => item.kind === 'character');
  const pack = await service.createPack({
    title: '旧剧本名',
    characterResourceId: character.id,
    customBaseline: { worldName: '听雨江湖', genre: '武侠' }
  });

  const updated = await service.updatePackMetadata(pack.id, {
    title: '听雨江湖 · 新卷',
    description: '只修改书架元数据。',
    sessionTitle: '听雨江湖'
  });
  const removed = await service.removePack(pack.id);

  assert.equal(updated.title, '听雨江湖 · 新卷');
  assert.equal(updated.manifest.title, '听雨江湖 · 新卷');
  assert.equal(updated.characterCard.name, pack.characterCard.name);
  assert.equal(removed, true);
  assert.equal(await service.getPack(pack.id), null);
  assert.ok(await service.getResource(character.id));
});

test('independent copy freezes selected resource provenance without inheriting a base pack', async () => {
  const service = await createService();
  const saved = await service.savePreview(createCharacterPreview(), {
    adapterId: 'liunao-community-generic',
    site: '类脑社区',
    url: 'https://example.test/cards/shen',
    author: '原作者',
    license: '未声明',
    version: '1.75',
    fileName: '武侠-Ver1.75.png',
    originalHash: 'sha256-example'
  });
  const character = saved.resources.find((item) => item.kind === 'character');
  const worldBook = saved.resources.find((item) => item.kind === 'worldbook');

  const pack = await service.createPack({
    title: '听雨独立卷',
    creationMode: 'independent-copy',
    includeBaseContent: false,
    characterResourceId: character.id,
    worldBookResourceIds: [worldBook.id],
    customBaseline: {
      worldName: '听雨江湖',
      genre: '武侠',
      premise: '只采用本次导入设定。'
    }
  });

  assert.equal(pack.resourceManifest.creationMode, 'independent-copy');
  assert.equal(pack.resourceManifest.basePackId, '');
  assert.equal(pack.resourceManifest.includeBaseContent, false);
  assert.equal(pack.resourceManifest.sourceResources.length, 2);
  assert.deepEqual(
    pack.resourceManifest.sourceResources.map((item) => item.id).sort(),
    [character.id, worldBook.id].sort()
  );
  assert.equal(pack.resourceManifest.sourceResources[0].source.site, '类脑社区');
  assert.equal(pack.resourceManifest.sourceResources[0].source.author, '原作者');
  assert.equal(pack.resourceManifest.sourceResources[0].source.fileName, '武侠-Ver1.75.png');
});

test('resource library updates collection metadata without mutating imported payloads', async () => {
  const service = await createService();
  const saved = await service.savePreview(createCharacterPreview(), { site: '类脑社区' });
  const character = saved.resources.find((item) => item.kind === 'character');
  const originalPayload = structuredClone((await service.getResource(character.id)).payload);

  const updated = await service.updateResourceMetadata(character.id, {
    title: '听雨刀客',
    summary: '旧案主线的核心人物。',
    tags: ['武侠', '旧案', '武侠'],
    collections: ['英雄群像', '待开局'],
    favorite: true
  });
  const queryResult = await service.listResources({ query: '英雄群像' });

  assert.equal(updated.title, '听雨刀客');
  assert.equal(updated.favorite, true);
  assert.deepEqual(updated.tags, ['武侠', '旧案']);
  assert.deepEqual(updated.collections, ['英雄群像', '待开局']);
  assert.deepEqual(updated.payload, originalPayload);
  assert.equal(queryResult[0].id, character.id);
  assert.equal(await service.updateResourceMetadata('missing-resource', { favorite: true }), null);
});

test('resource library updates world book entries and prompt modules as managed asset content', async () => {
  const service = await createService();
  const saved = await service.savePreview(createCharacterPreview(), { site: 'local-file' });
  const character = saved.resources.find((item) => item.kind === 'character');
  const worldBook = saved.resources.find((item) => item.kind === 'worldbook');
  const updatedWorldBook = await service.updateResourcePayload(worldBook.id, {
    payload: {
      entries: [{
        id: 'lore-rain',
        title: '雨夜规矩',
        keywords: ['雨夜'],
        content: '雨夜不得直呼死者姓名。',
        enabled: true,
        depth: 6
      }]
    }
  });
  const promptSaved = await service.savePromptResource({
    title: '克制叙事',
    content: '保持克制的第三人称叙事。',
    enabled: true,
    source: { site: 'local-file' }
  });
  const prompt = promptSaved.resources[0];
  const updatedPrompt = await service.updateResourcePayload(prompt.id, {
    title: '克制叙事 · 修订',
    payload: {
      ...prompt.payload,
      role: 'system',
      position: 'in_chat',
      depth: 3,
      content: '保持克制的第三人称叙事，并避免替用户决定行动。',
      enabled: true
    }
  });

  assert.equal(updatedWorldBook.payload.entries.length, 1);
  assert.equal(updatedWorldBook.payload.entries[0].title, '雨夜规矩');
  assert.equal(updatedWorldBook.payload.entries[0].depth, 6);
  assert.equal(updatedWorldBook.revision.number, 2);
  assert.equal(updatedWorldBook.revision.changeType, 'local-edit');
  assert.ok(updatedWorldBook.diagnostics.score > 0);
  assert.equal(updatedPrompt.title, '克制叙事 · 修订');
  assert.equal(updatedPrompt.payload.role, 'system');
  assert.equal(updatedPrompt.payload.position, 'in_chat');
  assert.equal(updatedPrompt.payload.content.includes('避免替用户决定行动'), true);
  assert.equal(updatedPrompt.revision.number, 2);
  await assert.rejects(
    () => service.updateResourcePayload(character.id, { payload: character.payload }),
    /RESOURCE_CONTENT_KIND_UNSUPPORTED/
  );
  assert.equal(await service.updateResourcePayload('missing-resource', { payload: {} }), null);
});

test('resource library batch organization merges labels and exports portable asset bundles', async () => {
  const service = await createService();
  const saved = await service.savePreview(createCharacterPreview(), { site: '类脑社区', author: '社区作者' });
  const character = saved.resources.find((item) => item.kind === 'character');
  const worldBook = saved.resources.find((item) => item.kind === 'worldbook');
  await service.updateResourceMetadata(character.id, { tags: ['武侠'], collections: ['待整理'] });

  const organized = await service.updateResourcesMetadata([character.id, worldBook.id, 'missing-resource'], {
    tags: ['主线'],
    collections: ['英雄群像'],
    mode: 'merge'
  });
  const updatedCharacter = await service.getResource(character.id);
  const bundle = await service.exportResourceBundle([character.id, worldBook.id, 'missing-resource']);

  assert.equal(organized.updated.length, 2);
  assert.deepEqual(organized.missing, ['missing-resource']);
  assert.deepEqual(updatedCharacter.tags, ['武侠', '主线']);
  assert.deepEqual(updatedCharacter.collections, ['待整理', '英雄群像']);
  assert.equal(bundle.schema, 'local-roleplay-agent.asset-bundle/v1');
  assert.equal(bundle.resources.length, 2);
  assert.equal(bundle.resources[0].source.author, '社区作者');
  assert.equal(bundle.resources[0].payload.name, '沈观澜');
  assert.deepEqual(bundle.missing, ['missing-resource']);

  const removed = await service.removeResources([character.id, 'missing-resource']);
  assert.deepEqual(removed.removed, [character.id]);
  assert.deepEqual(removed.missing, ['missing-resource']);
});

async function createService() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'resource-library-'));
  return new ResourceLibraryService(new JsonStore(rootDir), {
    now: () => new Date('2026-07-14T08:00:00.000Z')
  });
}

async function createPackWithPreflightApproval(service, input, options = {}) {
  const composition = await service.inspectPackComposition(input, options);
  const review = composition.compatibilityReview;
  return service.createPack({
    ...input,
    compatibilityReview: {
      fingerprint: review.fingerprint,
      approvedScriptHashes: review.rules.map((rule) => rule.contentHash),
      acknowledgeCompatibility: review.requiresCompatibilityAcknowledgement
    }
  }, options);
}

function createCharacterPreview(overrides = {}, worldBook = null) {
  return {
    kind: 'character-card',
    importData: {
      characterCard: {
        name: '沈观澜',
        description: '背负旧案的年轻刀客。',
        personality: '克制，重诺。',
        scenario: '雨夜进入听雨楼。',
        firstMessage: '檐下的雨，像一场没有写完的供词。',
        exampleDialog: ['用户：你来找谁？', '沈观澜：找一个不该死的人。'],
        systemPrompt: '保持武侠叙事边界。',
        tags: ['武侠', '悬案'],
        sourceSpec: 'chara_card_v2',
        ...overrides
      },
      worldBook: Array.isArray(worldBook) ? worldBook : [{
        id: 'lore-tingyu',
        title: '听雨楼',
        keywords: ['听雨楼'],
        content: '听雨楼以消息定价，不问来路。',
        enabled: true
      }]
    }
  };
}
