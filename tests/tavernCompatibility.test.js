import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { retrieveCards } from '../server/agent/memoryRetriever.js';
import { activateWorldBookEntries } from '../server/agent/worldBookActivator.js';
import { importWorldBookFromPayload } from '../server/character/worldBookImport.js';
import { applyWorldBookTagRegistry } from '../server/character/worldBookTagRegistry.js';
import { scanCommunityDependencies } from '../server/resources/communityDependencyScanner.js';
import { extractLightFrontendRuntime } from '../server/compat/lightFrontendRuntime.js';
import { executeDeclarativeLifecycle } from '../server/compat/declarativeLifecycle.js';
import { TAVERN_COMPATIBILITY_CONTRACT_VERSION } from '../server/compat/compatibilityPolicy.js';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'compatibility');
const goldenMatrix = JSON.parse(await readFile(join(fixtureDir, 'golden-matrix-v2.json'), 'utf8'));

const benchmarkCases = [
  ['plain-text-card.json', {
    outcome: 'full-mapping', counts: { supported: 1, degraded: 0, review: 0, missing: 0 }, differences: [], blockers: []
  }],
  ['regex-card.json', {
    outcome: 'full-mapping', counts: { supported: 3, degraded: 0, review: 0, missing: 0 }, differences: [], blockers: []
  }],
  ['quick-reply-card.json', {
    outcome: 'safe-degradation', counts: { supported: 2, degraded: 1, review: 0, missing: 0 }, differences: ['stscript'], blockers: []
  }],
  ['mvu-card.json', {
    outcome: 'full-mapping', counts: { supported: 3, degraded: 0, review: 0, missing: 0 }, differences: [], blockers: []
  }],
  ['static-heavy-frontend-card.json', {
    outcome: 'full-mapping', counts: { supported: 2, degraded: 0, review: 0, missing: 0 }, differences: [], blockers: []
  }],
  ['blocked-dynamic-card.json', {
    outcome: 'blocked', counts: { supported: 1, degraded: 0, review: 0, missing: 2 }, differences: [], blockers: ['executable-extension', 'custom-html-ui']
  }]
];

for (const [fileName, expected] of benchmarkCases) {
  test(`compatibility benchmark: ${fileName} => ${expected.outcome}`, async () => {
    const payload = JSON.parse(await readFile(join(fixtureDir, fileName), 'utf8'));
    const report = scanCommunityDependencies(payload, { kind: 'character' });
    const snapshot = {
      outcome: report.acceptance.outcome,
      counts: report.counts,
      differences: report.acceptance.differences.map((item) => item.id),
      blockers: report.acceptance.blockers.map((item) => item.id)
    };

    assert.deepEqual(snapshot, expected);
    assert.equal(report.acceptance.canStore, true);
    assert.equal(report.acceptance.executesThirdPartyCode, false);
    assert.equal(report.acceptance.canRun, expected.outcome !== 'blocked');
  });
}

test('v2 golden matrix covers every resource, rating and interaction combination exactly once', () => {
  assert.equal(goldenMatrix.schema, 'lra.tavern-golden-matrix/v2');
  assert.equal(goldenMatrix.contractVersion, TAVERN_COMPATIBILITY_CONTRACT_VERSION);

  const expectedKeys = new Set();
  for (const resourceKind of goldenMatrix.dimensions.resourceKinds) {
    for (const contentRating of goldenMatrix.dimensions.contentRatings) {
      for (const interactionLevel of goldenMatrix.dimensions.interactionLevels) {
        expectedKeys.add(`${resourceKind}:${contentRating}:${interactionLevel}`);
      }
    }
  }
  const actualKeys = goldenMatrix.cases.map((item) => (
    `${item.resourceKind}:${item.contentRating}:${item.interactionLevel}`
  ));

  assert.equal(goldenMatrix.cases.length, 18);
  assert.equal(new Set(actualKeys).size, actualKeys.length);
  assert.deepEqual(new Set(actualKeys), expectedKeys);
});

test('standalone world book import preserves SillyTavern extension and at-depth positions', () => {
  const imported = importWorldBookFromPayload({
    fileName: 'positions.json',
    mimeType: 'application/json',
    data: JSON.stringify({
      entries: [
        { uid: 1, content: '深度插入', position: 4 },
        { uid: 2, content: '扩展前', position: 5 },
        { uid: 3, content: '扩展后', position: 6 }
      ]
    })
  });

  assert.deepEqual(imported.map((entry) => entry.position), ['at_depth', 'before_eff', 'after_eff']);
});

for (const matrixCase of goldenMatrix.cases) {
  test(`v2 golden resource: ${matrixCase.id}`, () => {
    const profile = goldenMatrix.profiles[matrixCase.profile];
    assert.ok(profile, `missing profile ${matrixCase.profile}`);
    const payload = structuredClone(profile.payload);
    payload.metadata = {
      ...(payload.metadata || {}),
      contentRating: matrixCase.contentRating,
      syntheticFixture: true
    };

    const report = scanCommunityDependencies(payload, { kind: matrixCase.resourceKind });
    const runtime = extractLightFrontendRuntime(payload);
    const capabilityIds = new Set(report.requirements.map((item) => item.id));

    assert.equal(report.acceptance.contractVersion, TAVERN_COMPATIBILITY_CONTRACT_VERSION);
    assert.equal(report.acceptance.outcome, profile.expected.outcome);
    assert.equal(report.acceptance.canStore, true);
    assert.equal(report.acceptance.executesThirdPartyCode, false);
    for (const capability of profile.expected.requiredCapabilities) {
      assert.ok(capabilityIds.has(capability), `${matrixCase.id} missing ${capability}`);
    }

    const blockers = new Set(report.acceptance.blockers.map((item) => item.id));
    for (const blocker of profile.expected.blockers || []) {
      assert.ok(blockers.has(blocker), `${matrixCase.id} missing blocker ${blocker}`);
    }

    if (matrixCase.interactionLevel === 'text') {
      assert.equal(profile.expected.lane, 'native-roleplay');
      assert.equal(report.acceptance.canRun, true);
    } else if (matrixCase.interactionLevel === 'light-frontend') {
      assert.equal(profile.expected.lane, 'declarative-light-frontend');
      assert.equal(report.acceptance.canRun, true);
      assert.equal(
        runtime.quickReplies.length + runtime.regexTransforms.length + runtime.panels.length + Number(runtime.mvu.enabled) > 0,
        true
      );
    } else {
      assert.equal(profile.expected.lane, 'heavy-frontend-pack');
      assert.equal(report.acceptance.canRun, false);
      assert.equal(runtime.executesThirdPartyCode, false);
    }
  });
}

test('selectiveLogic applies all four SillyTavern secondary-key filters', () => {
  const base = {
    title: '选择逻辑',
    keywords: ['主词'],
    secondaryKeywords: ['甲', '乙'],
    matchMode: 'selective',
    content: '命中',
    enabled: true
  };
  const hit = (logic, query) => retrieveCards({
    query,
    worldBook: [{ ...base, logic }],
    maxCards: 2,
    maxRecursionDepth: 0
  }).length === 1;

  assert.equal(hit('and_any', '主词 甲'), true);
  assert.equal(hit('and_any', '主词'), false);
  assert.equal(hit('and_all', '主词 甲 乙'), true);
  assert.equal(hit('and_all', '主词 甲'), false);
  assert.equal(hit('not_any', '主词'), true);
  assert.equal(hit('not_any', '主词 甲'), false);
  assert.equal(hit('not_all', '主词 甲'), true);
  assert.equal(hit('not_all', '主词 甲 乙'), false);
});

test('world book recursion flags preserve direct matches without recursive over-activation', () => {
  const source = {
    id: 'source',
    title: '直接条目',
    keywords: ['客栈'],
    content: '虞清寒正在楼上。',
    enabled: true,
    extensions: { prevent_recursion: true }
  };
  const target = {
    id: 'target',
    title: '虞清寒',
    keywords: ['虞清寒'],
    content: '人物设定。',
    enabled: true,
    extensions: { exclude_recursion: true }
  };

  assert.deepEqual(
    retrieveCards({ query: '进入客栈', worldBook: [source, target], maxRecursionDepth: 1 }).map((entry) => entry.id),
    ['source']
  );
  assert.deepEqual(
    retrieveCards({ query: '寻找虞清寒', worldBook: [source, target], maxRecursionDepth: 1 }).map((entry) => entry.id),
    ['target']
  );
});

test('world book compatibility preserves character filters, generation triggers, and additional scan sources', () => {
  const worldBook = importWorldBookFromPayload({
    fileName: 'golden-filtered-world.json',
    data: JSON.stringify({
      entries: [{
        uid: 1,
        comment: '续写线索',
        keys: ['冷月印'],
        content: '续写时追踪冷月印。',
        enabled: true,
        character_filter: { names: ['shen'], tags: ['武侠'], isExclude: false },
        extensions: {
          triggers: ['continue'],
          match_character_description: true
        }
      }]
    })
  });
  const result = activateWorldBookEntries({
    worldBook,
    userMessage: '继续。',
    generationType: 'continue',
    characterCard: {
      name: '沈观澜',
      description: '左腕留有冷月印。',
      tags: ['武侠'],
      extensions: { local_roleplay_agent: { sourceFileName: 'shen.png' } }
    }
  });

  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].content, '续写时追踪冷月印。');
  assert.equal(result.snapshot.context.generationType, 'continue');
  assert.deepEqual(result.snapshot.context.additionalSourceKinds, ['characterDescription']);
});

test('world book import maps a SillyTavern tag registry without mutating the private ID', () => {
  const tagId = '31f7b74e-9828-4cd2-b7ac-3d93840d471c';
  const worldBook = importWorldBookFromPayload({
    fileName: 'tag-filtered-world.json',
    data: JSON.stringify({
      tags: [{ id: tagId, name: '武侠' }],
      entries: [{
        uid: 2,
        comment: '武林规矩',
        keys: ['门派'],
        content: '江湖规矩对武林角色生效。',
        enabled: true,
        character_filter: { tags: [tagId], isExclude: false }
      }]
    })
  });

  assert.deepEqual(worldBook[0].characterFilter.tags, [tagId]);
  assert.deepEqual(worldBook[0].characterFilter.tagNames, ['武侠']);
  assert.deepEqual(worldBook[0].characterFilter.unresolvedTagIds, []);
  assert.deepEqual(worldBook[0].extensions.character_filter_tag_registry, [{ id: tagId, name: '武侠' }]);

  const result = activateWorldBookEntries({
    worldBook,
    userMessage: '进入门派。',
    characterCard: { name: '沈观澜', tags: ['武侠'] }
  });
  assert.deepEqual(result.entries.map((entry) => entry.id), [worldBook[0].id]);
});

test('world book import marks only opaque tag IDs as unresolved', () => {
  const tagId = '31f7b74e-9828-4cd2-b7ac-3d93840d471c';
  const worldBook = importWorldBookFromPayload({
    fileName: 'unresolved-tag-filter.json',
    data: JSON.stringify({
      entries: [{
        uid: 3,
        comment: '双标签过滤',
        content: '测试过滤。',
        enabled: true,
        character_filter: { tags: [tagId, '武侠'], isExclude: false }
      }]
    })
  });

  assert.deepEqual(worldBook[0].characterFilter.tagNames, ['武侠']);
  assert.deepEqual(worldBook[0].characterFilter.unresolvedTagIds, [tagId]);
});

test('a settings sidecar resolves an imported opaque tag id without replacing that id', () => {
  const tagId = '31f7b74e-9828-4cd2-b7ac-3d93840d471c';
  const original = importWorldBookFromPayload({
    fileName: 'private-tag-filter.json',
    data: JSON.stringify({
      entries: [{
        uid: 7,
        comment: '仅限武侠角色',
        keys: ['门派'],
        content: '门派只接待武林中人。',
        character_filter: { tags: [tagId], isExclude: false }
      }]
    })
  });
  const applied = applyWorldBookTagRegistry({ entries: original }, {
    registryDocument: {
      settings: { tags: [{ id: tagId, name: '武侠' }] }
    }
  });

  assert.deepEqual(applied.payload.entries[0].characterFilter.tags, [tagId]);
  assert.deepEqual(applied.payload.entries[0].characterFilter.tagNames, ['武侠']);
  assert.deepEqual(applied.payload.entries[0].characterFilter.unresolvedTagIds, []);
  assert.deepEqual(applied.report.appliedMappings, [{ id: tagId, name: '武侠' }]);
  assert.equal(applied.report.changedEntryCount, 1);
  assert.deepEqual(applied.report.unresolvedAfter, []);
});

test('bounded lifecycle applies allowlisted patches and rolls back the whole event on failure', () => {
  const runtime = extractLightFrontendRuntime({
    extensions: {
      mvu: { values: { relationships: { guide: { trust: 1 } } } },
      lifecycle: {
        onUser: [
          { op: 'increment', path: 'relationships.guide.trust', amount: 2 }
        ]
      }
    }
  });
  const applied = executeDeclarativeLifecycle({
    runtime,
    event: 'onUser',
    currentState: runtime.mvu
  });
  assert.equal(applied.report.status, 'applied');
  assert.equal(applied.state.values.chat.relationships.guide.trust, 3);

  const blockedRuntime = {
    lifecycle: {
      events: {
        onUser: [
          { op: 'set', path: 'relationships.guide.trust', value: 9 },
          { op: 'set', path: 'system.secrets', value: true }
        ]
      }
    }
  };
  const rolledBack = executeDeclarativeLifecycle({
    runtime: blockedRuntime,
    event: 'onUser',
    currentState: runtime.mvu
  });
  assert.equal(rolledBack.report.status, 'rolled-back');
  assert.deepEqual(rolledBack.state, runtime.mvu);
});

test('lifecycle budgets reject excessive event executions without mutating state', () => {
  const runtime = {
    lifecycle: {
      events: {
        onAssistant: [{ op: 'increment', path: 'variables.turns', amount: 1 }]
      }
    }
  };
  const state = { enabled: true, values: { chat: { variables: { turns: 0 } }, global: {} }, revision: 0 };

  assert.throws(() => executeDeclarativeLifecycle({
    runtime,
    event: 'onAssistant',
    currentState: state,
    executions: 9
  }), /LIFECYCLE_EXECUTION_BUDGET_EXCEEDED/);
  assert.equal(state.values.chat.variables.turns, 0);
});

test('lifecycle recursion and change budgets fail closed instead of silently truncating', () => {
  const state = { enabled: true, values: { chat: { variables: { turns: 0 } }, global: {} }, revision: 0 };
  const tooDeep = {
    lifecycle: {
      events: {
        onUser: {
          steps: [{ steps: [{ steps: [{ steps: [{ steps: [{ steps: [
            { op: 'increment', path: 'variables.turns', amount: 1 }
          ] }] }] }] }] }]
        }
      }
    }
  };
  const tooMany = {
    lifecycle: {
      events: {
        onAssistant: Array.from({ length: 33 }, () => ({
          op: 'increment',
          path: 'variables.turns',
          amount: 1
        }))
      }
    }
  };

  const depthResult = executeDeclarativeLifecycle({
    runtime: tooDeep,
    event: 'onUser',
    currentState: state
  });
  const countResult = executeDeclarativeLifecycle({
    runtime: tooMany,
    event: 'onAssistant',
    currentState: state
  });

  assert.equal(depthResult.report.status, 'rolled-back');
  assert.equal(depthResult.report.error.code, 'lifecycle-recursion-blocked');
  assert.deepEqual(depthResult.state, state);
  assert.equal(countResult.report.status, 'rolled-back');
  assert.equal(countResult.report.error.code, 'lifecycle-change-budget-truncated');
  assert.deepEqual(countResult.state, state);
});
