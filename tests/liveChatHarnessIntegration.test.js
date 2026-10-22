import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentService } from '../server/services/agentService.js';

test('end-to-end chat pipeline drives world clock, offscreen simulation, foreshadowing, and storyGraph', async () => {
  const fakeSession = {
    id: 'test-session',
    settings: {
      providerId: 'test-provider',
      groupMembers: [
        { name: '西门吹雪', location: '万梅山庄', directives: ['闭关静修剑道'] }
      ]
    },
    config: {
      characterCard: {
        name: '陆小凤',
        description: '四条眉毛的传奇浪子',
        personality: '机智诙谐，好管闲事'
      },
      worldBook: []
    },
    memory: {
      coreMemory: {
        personaView: '视玩家为知己',
        activeCommitments: ['一同查明金鹏王朝之谜'],
        coreDirectives: ['解开天下奇案']
      },
      worldState: {
        location: '百花楼',
        clock: { day: 1, timeOfDay: '清晨', turnCount: 0 },
        storyGraph: {
          currentChapter: '第一幕：金鹏迷局',
          nodes: [
            {
              id: 'node-1',
              title: '百花楼会面',
              chapter: '第一幕：金鹏迷局',
              status: 'active',
              conditions: { requiredLocation: '百花楼' },
              outcomes: { unlockedNodes: ['node-2'] }
            },
            {
              id: 'node-2',
              title: '万梅山庄求剑',
              chapter: '第二幕：剑神之约',
              status: 'locked',
              conditions: { requiredLocation: '万梅山庄' },
              outcomes: { unlockedNodes: [] }
            }
          ]
        }
      },
      messages: []
    },
    messages: []
  };

  const fakeSessionService = {
    getSession: async () => fakeSession,
    saveSession: async (s) => { Object.assign(fakeSession, s); return fakeSession; }
  };

  const fakeConfigService = {
    getAll: async () => ({
      providers: {
        providers: [{ id: 'test-provider', name: 'Test Provider', baseUrl: 'http://test', apiKey: 'sk-test' }],
        activeProviderId: 'test-provider'
      }
    })
  };

  const fakeProviderClient = {
    complete: async () => ({
      content: `夜幕降临，陆小凤微微一笑，倒了一杯酒：“这桩案子，可比想象中更棘手。”\n<turn_frame>{"scene":{"summary":"在百花楼与玩家商议案情"},"decision":{"kind":"open-state","focus":"商议下一步线索"},"stateDelta":{"foreshadowing":[{"id":"hook-gold","content":"青衣楼的暗杀令","status":"open"}]}}</turn_frame>`,
      usage: { total_tokens: 120 }
    })
  };

  const agentService = new AgentService({
    configService: fakeConfigService,
    sessionService: fakeSessionService,
    providerClient: fakeProviderClient
  });

  const response = await agentService.sendMessage({
    sessionId: 'test-session',
    content: '陆兄，近来江湖上可有风吹草动？'
  });

  assert.ok(response.reply, 'Must return assistant message');

  // 1. 验证世界时钟推进
  const worldState = fakeSession.memory.worldState;
  assert.ok(worldState.clock, 'Clock must exist');
  assert.equal(worldState.clock.turnCount, 1, 'Turn count must advance to 1');

  // 2. 验证离场 NPC（西门吹雪）产生后台自主推演
  assert.ok(Array.isArray(worldState.offscreenEvents), 'Offscreen events must exist');
  const ximenEvent = worldState.offscreenEvents.find((e) => e.actor === '西门吹雪');
  assert.ok(ximenEvent, 'Must record offscreen simulation for 西门吹雪');
  assert.equal(ximenEvent.location, '万梅山庄');

  // 3. 验证伏笔正确沉淀入世界状态
  assert.ok(Array.isArray(worldState.foreshadowing), 'Foreshadowing must exist');
  const goldHook = worldState.foreshadowing.find((h) => h.id === 'hook-gold');
  assert.ok(goldHook, 'Must record foreshadowing 青衣楼的暗杀令');
  assert.equal(goldHook.status, 'open');

  // 4. 验证剧情拓扑状态机自动流转
  assert.ok(worldState.storyGraph, 'Story graph must exist');
  const node1 = worldState.storyGraph.nodes.find((n) => n.id === 'node-1');
  const node2 = worldState.storyGraph.nodes.find((n) => n.id === 'node-2');
  assert.equal(node1.status, 'completed', 'Node 1 must be completed as location matched 百花楼');
  assert.equal(node2.status, 'active', 'Node 2 must be unlocked and active');
  assert.equal(worldState.storyGraph.currentChapter, '第二幕：剑神之约');
});

test('continueMessage keeps the prior assistant turn once and sends an explicit continuation instruction', async () => {
  const previous = '黑匣子浮在石沿旁，白小纯没有伸手。';
  const fakeSession = {
    id: 'continue-session',
    settings: { providerId: 'test-provider' },
    config: { characterCard: { name: '白小纯', enabled: true }, worldBook: [] },
    memory: { worldState: {}, memoryCards: [] },
    messages: [{ id: 'assistant-1', role: 'assistant', content: previous }]
  };
  const captured = [];
  const agentService = new AgentService({
    configService: {
      getAll: async () => ({
        providers: {
          providers: [{ id: 'test-provider', name: 'Test Provider', baseUrl: 'http://test', apiKey: 'sk-test' }],
          activeProviderId: 'test-provider'
        }
      })
    },
    sessionService: {
      getSession: async () => fakeSession,
      saveSession: async (session) => Object.assign(fakeSession, session)
    },
    providerClient: {
      complete: async ({ messages }) => {
        captured.push(messages);
        return {
          content: `泉面泛起新的涟漪，黑匣子的匣盖轻轻震了一下。

> [天机选项：匣盖异动，石沿旁仍无人靠近。]
- 先观察黑匣子封蜡是否松动
- 收回手，隔着石沿等待新的变化
- 暂不触碰，绕到侧面确认泉水流向`
        };
      }
    }
  });

  await agentService.continueMessage({ sessionId: 'continue-session' });

  const prompt = captured[0];
  assert.equal(prompt.filter((message) => message.role === 'assistant' && message.content === previous).length, 1);
  assert.equal(prompt.at(-1).role, 'user');
  assert.match(prompt.at(-1).content, /玩家请求继续推进/);
  assert.match(fakeSession.messages[0].content, /泉面泛起新的涟漪/);
  assert.equal(fakeSession.messages[0].recommendedActionPresentation?.title, '天机选项');
  assert.equal(fakeSession.messages[0].recommendedActions?.length, 3);
});
