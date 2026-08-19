import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptNarrativeTurnFrame,
  buildTurnFrameStateEnvelope,
  deriveConservativeNarrativeTurnFrame,
  extractNarrativeTurnFrame,
  materializeTurnFramePanels,
  resolveNarrativeTurnFrame
} from '../server/agent/turnFrame.js';
import { parseRoleplayResponse } from '../server/agent/roleplayResponse.js';

const FRAME = {
  spec: 'lra.narrative-turn-frame/v1',
  scene: { location: '青铜门后石室', time: '子时', summary: '地伶隔门等待回应', presentActors: ['地伶'] },
  decision: { kind: 'direct-response', focus: '谁在门后？', actor: '地伶', requiresPlayerResponse: true, urgency: 'high' },
  evidence: [{ text: '地伶尚未进入石室', status: 'confirmed', source: '正文' }],
  affordances: { routes: [], interactables: ['青铜门'], threats: [], constraints: ['不能替玩家回答'] },
  stateDelta: { summary: '', facts: [], timeAdvanceMinutes: 0 },
  panels: {}
};

test('turn frame is parsed and removed from visible prose', () => {
  const raw = `她隔门问：“谁在那里？”\n<turn_frame>${JSON.stringify(FRAME)}</turn_frame>`;
  const parsed = extractNarrativeTurnFrame(raw);
  assert.equal(parsed.content, '她隔门问：“谁在那里？”');
  assert.equal(parsed.frame.decision.actor, '地伶');
  assert.equal(parseRoleplayResponse(raw).content, '她隔门问：“谁在那里？”');
});

test('camel-case turn frame aliases stay hidden and remain machine-readable', () => {
  const raw = `夜风掠过灵田。\n<TurnFrame>${JSON.stringify(FRAME)}</TurnFrame>`;
  const parsed = extractNarrativeTurnFrame(raw);
  assert.equal(parsed.content, '夜风掠过灵田。');
  assert.equal(parsed.frame.scene.location, '青铜门后石室');
  assert.equal(parseRoleplayResponse(raw).content, '夜风掠过灵田。');
});

test('accepted turn frame materializes same-turn interaction panels', () => {
  const accepted = acceptNarrativeTurnFrame(extractNarrativeTurnFrame(`<turn_frame>${JSON.stringify(FRAME)}</turn_frame>`).frame);
  const panels = materializeTurnFramePanels(accepted);
  assert.match(panels.sceneStatus, /青铜门后石室/);
  assert.match(panels.nextCharacter, /地伶|谁在门后/);
  assert.equal(accepted.validation.status, 'accepted');
  assert.equal(accepted.validation.factAdmission, 'candidate-only');
});

test('turn frame only admits canonical facts with a trusted provenance', () => {
  const grounded = acceptNarrativeTurnFrame(extractNarrativeTurnFrame(`<turn_frame>${JSON.stringify({
    ...FRAME,
    evidence: [{ text: '地伶是绝世仙宗真传弟子', status: 'confirmed', source: '世界书' }],
    stateDelta: {
      summary: '玩家已经回答地伶',
      facts: [{ text: '刘一回答了地伶的问题', status: 'confirmed', source: '用户行动' }],
      timeAdvanceMinutes: 1
    }
  })}</turn_frame>`).frame);

  assert.equal(grounded.validation.factAdmission, 'grounded');
  assert.equal(grounded.validation.groundedFactCount, 2);
  assert.equal(grounded.validation.candidateFactCount, 0);
});

test('plain string evidence is a model hypothesis rather than a confirmed fact', () => {
  const parsed = extractNarrativeTurnFrame(`<turn_frame>${JSON.stringify({
    ...FRAME,
    evidence: ['墨色竖影可能在地下穿行']
  })}</turn_frame>`).frame;
  const accepted = acceptNarrativeTurnFrame(parsed);

  assert.deepEqual(parsed.evidence, [{
    text: '墨色竖影可能在地下穿行',
    status: 'hypothesis',
    source: 'model-current-turn'
  }]);
  assert.equal(accepted.validation.factAdmission, 'candidate-only');
});

test('missing turn frame derives a conservative same-turn scene and latest interaction', () => {
  const content = [
    '刘一跟着柴翁走到井台边，柴翁把木桶慢慢提了上来。',
    '柴翁盯着水面说：“这井每年淘，沉不下去活物。能有蛛丝，要么是从外头带进去的，要么……”',
    '他把桶沿推到刘一面前：“这桶水，你看看再定。”'
  ].join('\n');
  const memory = {
    worldState: {
      protagonist: { name: '刘一' },
      location: { current: '杂役院排房外老槐树下', knownPlaces: [] },
      characters: [{ name: '柴翁', encountered: true }],
      quests: [{
        id: 'well-rope',
        title: '帮柴翁压井轱辘',
        objective: '井绳崩断、水桶吊在半腰，刘一已应下帮忙压井轱辘',
        status: 'active'
      }]
    },
    simulation: { calendar: { label: '第1日 10:05 · 周一 · 上午' }, actors: [] },
    characterRegistry: { records: [{ name: '刘一' }, { name: '柴翁' }], currentAct: { members: [] } }
  };

  const derived = deriveConservativeNarrativeTurnFrame({ content, memory });
  const accepted = resolveNarrativeTurnFrame(null, { content, memory });
  const envelope = buildTurnFrameStateEnvelope(accepted, memory, null, {
    content: `${content}\n绞到最后一圈时，水桶的铁梁磕在井口石沿上。柴翁伸出一只手稳住桶身，把它轻轻搁在井台上。`
  });

  assert.equal(derived.scene.location, '井台');
  assert.equal(accepted.validation.source, 'conservative-prose-fallback');
  assert.deepEqual(accepted.scene.presentActors, ['刘一', '柴翁']);
  assert.equal(accepted.scene.time, '第1日 10:05 · 周一 · 上午');
  assert.equal(accepted.decision.kind, 'pending-interaction');
  assert.equal(accepted.decision.actor, '柴翁');
  assert.match(accepted.decision.focus, /这桶水.*看看再定/);
  assert.equal(accepted.decision.focus.includes('要么'), false);
  assert.equal(accepted.validation.factAdmission, 'candidate-only');
  assert.deepEqual(envelope.actions, [
    {
      type: 'state.set',
      path: 'location.current',
      value: '井台',
      visibility: 'public',
      reason: '正文明确移动后的保守场景同步'
    },
    {
      type: 'quest.update',
      questId: 'well-rope',
      status: 'completed',
      progress: 100,
      note: '本轮正文已明确完成该现场事务',
      visibility: 'public',
      reason: '正文结果已落地，避免已完成任务继续占用当前决策'
    }
  ]);
});

test('turn-frame location sync does not duplicate an existing location action', () => {
  const accepted = acceptNarrativeTurnFrame({
    ...FRAME,
    validation: { status: 'schema-valid', source: 'model-turn-frame' }
  });
  const envelope = buildTurnFrameStateEnvelope(accepted, {
    worldState: { location: { current: '杂役院' } }
  }, {
    actions: [{ type: 'state.set', path: 'location.current', value: '青铜门后石室' }]
  });
  assert.equal(envelope, null);
});

test('latest concrete request replaces an incomplete model choice without discarding the model frame', () => {
  const content = [
    '柴翁把桶沿推到刘一面前。',
    '他先前说过：“要么留在这里，要么……”',
    '随后又指着水面道：“这桶水，你看看再定。”'
  ].join('\n');
  const resolved = resolveNarrativeTurnFrame({
    ...FRAME,
    scene: { ...FRAME.scene, location: '老槐树下', presentActors: ['刘一'] },
    decision: {
      kind: 'explicit-choice',
      focus: '要么留在这里，要么……',
      actor: '柴翁',
      requiresPlayerResponse: true,
      urgency: 'critical'
    },
    validation: { status: 'schema-valid', source: 'model-turn-frame' }
  }, {
    content,
    memory: {
      worldState: {
        protagonist: { name: '刘一' },
        location: { current: '老槐树下' },
        characters: [{ name: '柴翁' }]
      },
      simulation: { calendar: { label: '第1日 10:05 · 周一 · 上午' } }
    }
  });

  assert.equal(resolved.validation.source, 'model-turn-frame-reconciled');
  assert.equal(resolved.decision.kind, 'pending-interaction');
  assert.match(resolved.decision.focus, /这桶水.*看看再定/);
  assert.deepEqual(resolved.scene.presentActors, ['刘一', '柴翁']);
  assert.equal(resolved.scene.time, '第1日 10:05 · 周一 · 上午');
});
