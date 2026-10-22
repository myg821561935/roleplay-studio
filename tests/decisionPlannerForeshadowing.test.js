import test from 'node:test';
import assert from 'node:assert/strict';
import { planRecommendedActions } from '../server/agent/decisionPlanner.js';

test('decisionPlanner generates investigation actions that hook unresolved foreshadowing', () => {
  const memory = {
    worldState: {
      location: '古井旁',
      foreshadowing: [
        { id: 'hook-1', content: '井底暗红封泥下的青铜残片', status: 'open' }
      ]
    }
  };

  const plan = planRecommendedActions({
    assistantContent: '雨势渐大，四周一片死寂。井口处隐约有一缕异样气息，似乎有什么东西刚被挪动过。',
    memory,
    userMessage: '我四下打量。'
  });

  const actions = Array.isArray(plan?.actions) ? plan.actions : [];
  assert.ok(actions.length > 0, 'Must generate recommended actions');
  const foreshadowingAction = actions.find((a) => a.includes('井底暗红封泥下的青铜残片'));
  assert.ok(foreshadowingAction, 'Must include foreshadowing hook action in investigation recommendations');
});

test('a newly surfaced box is a grounded discovery node rather than an empty descriptive beat', () => {
  const plan = planRecommendedActions({
    assistantContent: '泉水忽然翻涌，沉在井底的黑匣子被水泡托着浮起，匣盖上的封蜡尚未完全脱落。它静静停在石沿旁，像在等人伸手。',
    memory: { worldState: { location: '废井旁' } },
    userMessage: '我停在原地。'
  });

  assert.equal(plan.decision.kind, 'investigation');
  assert.equal(plan.actions.length, 3);
  assert.ok(plan.actions.some((action) => /黑匣子|匣子/u.test(action)), 'Actions must target the newly surfaced object');
  assert.ok(plan.actionOptions.every((option) => option.target.includes('黑匣子') || option.target.includes('匣子')));
});
