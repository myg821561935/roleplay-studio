import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateCommunityCompatibility,
  scanCommunityDependencies
} from '../server/resources/communityDependencyScanner.js';

test('standard character cards are reported as native compatible', () => {
  const report = scanCommunityDependencies({
    name: '沈观澜',
    description: '背负旧案的刀客。',
    systemPrompt: '保持角色身份和世界边界。'
  }, { kind: 'character' });

  assert.equal(report.level, 'native');
  assert.equal(report.label, '可直接游玩');
  assert.equal(report.counts.supported, 1);
  assert.equal(report.counts.degraded, 0);
  assert.equal(report.counts.review, 0);
  assert.equal(report.counts.missing, 0);
  assert.equal(report.executesThirdPartyCode, false);
  assert.equal(report.safeToStore, true);
  assert.equal(report.readyToPlay, true);
  assert.equal(report.fullyCompatible, true);
});

test('detects Tavern Helper, Xiaobai X and executable runtime dependencies', () => {
  const report = scanCommunityDependencies({
    creatorNotes: '本卡需要酒馆助手与小白 X 配合使用。',
    extensions: {
      tavern_helper: { hooks: { onMessage: 'updateState()' } },
      xiaobai_x: { panel: 'status' },
      script: '<script>window.cardState = true</script>'
    }
  }, { kind: 'character' });

  assert.equal(report.level, 'external-runtime');
  assert.equal(report.safeToStore, true);
  assert.equal(report.readyToPlay, false);
  assert.equal(report.requiresReview, true);
  assert.ok(report.counts.missing >= 3);
  assert.ok(report.requirements.some((item) => item.id === 'tavern-helper' && item.status === 'missing'));
  assert.ok(report.requirements.some((item) => item.id === 'xiaobai-x' && item.status === 'missing'));
  assert.ok(report.requirements.some((item) => item.id === 'executable-extension' && item.status === 'missing'));
});

test('reports safe Quick Reply and regex scripts as supported while preset ordering remains degraded', () => {
  const report = scanCommunityDependencies({
    extensions: {
      quick_replies: [{ label: '继续', command: '/send 继续' }],
      regex_scripts: [{ findRegex: '/<status>.*<\\/status>/' }],
      prompt_order: ['world_info_before', 'char_description']
    }
  }, { kind: 'character' });

  assert.equal(report.level, 'degraded');
  assert.equal(report.counts.missing, 0);
  assert.ok(report.requirements.some((item) => item.id === 'quick-replies' && item.status === 'supported'));
  assert.ok(report.requirements.some((item) => item.id === 'regex-scripts' && item.status === 'supported'));
  assert.ok(report.requirements.some((item) => item.id === 'prompt-preset-order'));
});

test('reports sandbox-capable regex JavaScript as local-observe capable instead of a missing host runtime', () => {
  const report = scanCommunityDependencies({
    extensions: {
      regex_scripts: [{
        scriptName: '状态栏',
        findRegex: '/<status>[\\s\\S]*?<\\/status>/g',
        replaceString: '<script type="module">renderStatus()</script>',
        disabled: false
      }]
    }
  }, { kind: 'character' });

  assert.equal(report.level, 'review-required');
  assert.equal(report.readyToPlay, true);
  assert.equal(report.acceptance.outcome, 'review-required');
  assert.equal(report.acceptance.canRun, true);
  assert.ok(report.counts.review >= 1);
  assert.ok(report.requirements.some((item) => item.id === 'executable-extension' && item.status === 'review'));
  assert.ok(report.requirements.some((item) => item.id === 'regex-scripts' && item.status === 'review'));
  assert.match(report.summary, /默认在本地观察运行/);
});

test('reports MVU JSON state as supported without claiming script compatibility', () => {
  const report = scanCommunityDependencies({
    extensions: { mvu: { values: { favor: 12, met: true } } }
  }, { kind: 'character' });

  assert.ok(report.requirements.some((item) => item.id === 'mvu-state' && item.status === 'supported'));
  assert.equal(report.executesThirdPartyCode, false);
});

test('separates native macros from unsupported Tavern macros', () => {
  const report = scanCommunityDependencies({
    systemPrompt: '由 {{char_name}} 回应 {{user}}，好感 {{getvar::favor}}，情绪读取 {{mood}}。'
  }, { kind: 'character' });

  assert.equal(report.level, 'degraded');
  assert.ok(report.requirements.some((item) => item.id === 'native-macros'));
  const unknown = report.requirements.find((item) => item.id === 'unknown-macros');
  assert.deepEqual(unknown.evidence, ['{{mood}}']);
});

test('aggregates compatibility with the most restrictive status per capability', () => {
  const native = scanCommunityDependencies({ content: '普通文本' }, { kind: 'prompt' });
  const external = scanCommunityDependencies({
    extensions: { quick_replies: [], tavern_helper: true }
  }, { kind: 'character' });
  const report = aggregateCommunityCompatibility([native, external]);

  assert.equal(report.level, 'external-runtime');
  assert.ok(report.counts.supported >= 2);
  assert.ok(report.counts.missing >= 1);
  assert.ok(report.requirements.some((item) => item.id === 'tavern-helper'));
});

test('degrades community helper runtimes when declarative fields can be mapped', () => {
  const report = scanCommunityDependencies({
    extensions: {
      tavern_helper: {
        variables: { clues: 2 },
        quick_replies: [{ label: '查验', message: '/send 查验现场' }],
        panels: [{ title: '线索面板', fields: [{ label: '数量', path: 'clues' }] }]
      },
      xiaobai_x: {
        regex_scripts: [{ pattern: '<status>[\\s\\S]*?</status>', replacement: '' }]
      }
    }
  }, { kind: 'character' });

  assert.ok(report.requirements.some((item) => item.id === 'tavern-helper' && item.status === 'degraded'));
  assert.ok(report.requirements.some((item) => item.id === 'xiaobai-x' && item.status === 'degraded'));
  assert.ok(report.requirements.some((item) => item.id === 'sidebar-panels' && item.status === 'supported'));
  assert.equal(report.executesThirdPartyCode, false);
});

test('reports safe and unsupported EJS template tags separately', () => {
  const report = scanCommunityDependencies({
    systemPrompt: '<% if (mvu.clues >= 2) { %><%= char %>发现线索<% } %><% for (const item of clues) { %>'
  }, { kind: 'character' });
  const ejs = report.requirements.find((item) => item.id === 'safe-ejs-template');

  assert.equal(ejs.status, 'degraded');
  assert.match(ejs.impact, /保持禁用/);
});

test('reports unresolved SillyTavern Character Filter tag IDs before assembly', () => {
  const tagId = '31f7b74e-9828-4cd2-b7ac-3d93840d471c';
  const report = scanCommunityDependencies({
    entries: [{
      uid: 7,
      comment: '仅限武侠角色',
      content: '门派只接待武林中人。',
      character_filter: { tags: [tagId], isExclude: false }
    }]
  }, { kind: 'worldbook' });

  const requirement = report.requirements.find((item) => item.id === 'worldbook-character-filter-tag-registry');
  assert.equal(report.level, 'degraded');
  assert.equal(requirement.status, 'degraded');
  assert.deepEqual(requirement.evidence, [`仅限武侠角色：${tagId}`]);
  assert.match(requirement.impact, /包含过滤条目会保持不激活/);
  assert.equal(report.acceptance.differences[0].id, 'worldbook-character-filter-tag-registry');
});

test('maps SillyTavern Character Filter tag IDs when a registry is present', () => {
  const tagId = '31f7b74e-9828-4cd2-b7ac-3d93840d471c';
  const report = scanCommunityDependencies({
    tags: [{ id: tagId, name: '武侠' }],
    entries: [{
      uid: 8,
      content: '门派只接待武林中人。',
      character_filter: { tags: [tagId], isExclude: false }
    }]
  }, { kind: 'worldbook' });

  const requirement = report.requirements.find((item) => item.id === 'worldbook-character-filter-tag-registry');
  assert.equal(report.level, 'native');
  assert.equal(requirement.status, 'supported');
  assert.deepEqual(requirement.evidence, [`${tagId} → 武侠`]);
});
