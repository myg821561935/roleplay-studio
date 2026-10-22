import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandMacros } from '../server/agent/macroEngine.js';

test('expandMacros replaces {{user}} and {{char}}', () => {
  const result = expandMacros('{{user}} 向 {{char}} 拔剑', {
    user: '林青阳',
    characterCard: { name: '沈观澜' }
  });
  assert.equal(result, '林青阳 向 沈观澜 拔剑');
});

test('expandMacros expands persona fields', () => {
  const result = expandMacros('我是 {{persona_name}}，来自 {{persona_background}}', {
    persona: { name: '林青阳', background: '江南' }
  });
  assert.equal(result, '我是 林青阳，来自 江南');
});

test('expandMacros expands char_* fields', () => {
  const result = expandMacros('{{char_name}} 是 {{char_role}}', {
    characterCard: { name: '沈观澜', role: '剑客' }
  });
  assert.equal(result, '沈观澜 是 剑客');
});

test('expandMacros resolves SillyTavern charIfNotGroup without leaking the marker', () => {
  assert.equal(expandMacros('{{charIfNotGroup}}', {
    characterCard: { name: '九渊' },
    groupMembers: []
  }), '九渊');
  assert.equal(expandMacros('{{charIfNotGroup}}', {
    characterCard: { name: '九渊' },
    groupMembers: [{ name: '同伴', enabled: true }]
  }), '');
});

// ---- SillyTavern prompt manager 占位符映射 ----

const PLACEHOLDER_CONTEXT = {
  user: '林青阳',
  characterCard: {
    name: '沈观澜',
    description: '玄水阁阁主，佩剑听雨。',
    personality: '外冷内热，谋定后动。',
    exampleDialog: ['{{user}}：阁下深夜到访，所为何事？', '沈观澜：*指尖敲了敲案几* 三件事。']
  },
  persona: { name: '林青阳', description: '江南剑客，游历四方。', enabled: true },
  worldBook: [
    { title: '玄水阁', content: '临水而建的剑阁。', position: 'before_character' },
    { title: '落雁夜市', content: '城南入夜后的集市。', position: '' }
  ]
};

test('prompt manager placeholders map to character card fields in both naming styles', () => {
  assert.equal(expandMacros('{{charDefinition}}', PLACEHOLDER_CONTEXT), '玄水阁阁主，佩剑听雨。');
  assert.equal(expandMacros('{{charDescription}}', PLACEHOLDER_CONTEXT), '玄水阁阁主，佩剑听雨。');
  assert.equal(expandMacros('{{char_description}}', PLACEHOLDER_CONTEXT), '玄水阁阁主，佩剑听雨。');
  assert.equal(expandMacros('{{charPersonality}}', PLACEHOLDER_CONTEXT), '外冷内热，谋定后动。');
  assert.equal(expandMacros('{{char_personality}}', PLACEHOLDER_CONTEXT), '外冷内热，谋定后动。');
});

test('persona description placeholder respects disabled personas', () => {
  assert.equal(expandMacros('{{personaDescription}}', PLACEHOLDER_CONTEXT), '江南剑客，游历四方。');
  assert.equal(expandMacros('{{persona_description}}', PLACEHOLDER_CONTEXT), '江南剑客，游历四方。');
  assert.equal(expandMacros('{{personaDescription}}', {
    ...PLACEHOLDER_CONTEXT,
    persona: { ...PLACEHOLDER_CONTEXT.persona, enabled: false }
  }), '');
});

test('dialogue examples placeholder joins example dialog entries', () => {
  const result = expandMacros('{{dialogueExamples}}', PLACEHOLDER_CONTEXT);
  assert.equal(result, '林青阳：阁下深夜到访，所为何事？\n沈观澜：*指尖敲了敲案几* 三件事。');
  assert.equal(expandMacros('{{dialogue_examples}}', PLACEHOLDER_CONTEXT), result);
});

test('dialogue examples placeholder falls back to raw mes_example strings', () => {
  const result = expandMacros('{{dialogueExamples}}', {
    characterCard: { name: '沈观澜', mes_example: '{{user}}：可否借一步说话。' }
  });
  assert.equal(result, '用户：可否借一步说话。');
});

test('world info placeholders split entries by position around the character card', () => {
  assert.equal(expandMacros('{{worldInfoBefore}}', PLACEHOLDER_CONTEXT), '## 玄水阁\n临水而建的剑阁。');
  assert.equal(expandMacros('{{world_info_before}}', PLACEHOLDER_CONTEXT), '## 玄水阁\n临水而建的剑阁。');
  assert.equal(expandMacros('{{worldInfoAfter}}', PLACEHOLDER_CONTEXT), '## 落雁夜市\n城南入夜后的集市。');
  assert.equal(expandMacros('{{world_info_after}}', PLACEHOLDER_CONTEXT), '## 落雁夜市\n城南入夜后的集市。');
});

test('numeric SillyTavern positions keep Author Note Bottom out of depth and extension slots', () => {
  const context = {
    worldBook: [
      { title: '作者注释底部', content: '应在角色之后。', position: 3 },
      { title: '历史深度', content: '不应作为 after。', position: 4 },
      { title: '扩展前', content: '不应作为 after。', position: 5 },
      { title: '扩展后', content: '不应作为 after。', position: 6 }
    ]
  };

  assert.equal(expandMacros('{{worldInfoAfter}}', context), '## 作者注释底部\n应在角色之后。');
});

test('world info placeholders render empty when no entries match', () => {
  assert.equal(expandMacros('{{worldInfoBefore}}', { worldBook: [{ title: '落雁夜市', content: '集市。' }] }), '');
  assert.equal(expandMacros('{{worldInfoAfter}}', { characterCard: {} }), '');
});

test('placeholders expand inside preset module content alongside other macros', () => {
  const result = expandMacros(
    '角色设定：{{charDefinition}}\n性格：{{charPersonality}}\n人设：{{personaDescription}}',
    PLACEHOLDER_CONTEXT
  );
  assert.equal(result, '角色设定：玄水阁阁主，佩剑听雨。\n性格：外冷内热，谋定后动。\n人设：江南剑客，游历四方。');
});

test('expandMacros random picks from comma list', () => {
  const results = new Set();
  for (let i = 0; i < 50; i++) {
    const r = expandMacros('{{random:甲,乙,丙}}', {});
    results.add(r);
  }
  assert.ok(results.size >= 2);
  assert.ok(['甲', '乙', '丙'].every((x) => results.has(x)));
});

test('expandMacros random numeric range returns number in range', () => {
  for (let i = 0; i < 30; i++) {
    const r = Number(expandMacros('{{random:1-6}}', {}));
    assert.ok(r >= 1 && r <= 6);
  }
});

test('expandMacros roll d6 returns 1-6', () => {
  for (let i = 0; i < 30; i++) {
    const r = Number(expandMacros('{{roll:d6}}', {}));
    assert.ok(r >= 1 && r <= 6);
  }
});

test('expandMacros roll 3d6+5 has correct format', () => {
  const result = expandMacros('{{roll:3d6+5}}', {});
  assert.match(result, /^\d+ \(\d+\+\d+\+\d+ \+ 5\)$/);
});

test('expandMacros time macros return non-empty', () => {
  assert.ok(expandMacros('{{time}}', {}).length > 0);
  assert.ok(expandMacros('{{date}}', {}).length > 0);
  assert.ok(expandMacros('{{datetime}}', {}).length > 0);
  assert.ok(Number(expandMacros('{{timestamp}}', {})) > 0);
});

test('expandMacros message_count counts non-excluded messages', () => {
  const result = expandMacros('已对话 {{message_count}} 轮', {
    messages: [
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好啊' },
      { role: 'user', content: '再见', excluded: true }
    ]
  });
  assert.equal(result, '已对话 2 轮');
});

test('expandMacros last_user_message returns last user content', () => {
  const result = expandMacros('上句: {{last_user_message}}', {
    messages: [
      { role: 'user', content: '第一句' },
      { role: 'assistant', content: '回应' },
      { role: 'user', content: '第二句' }
    ]
  });
  assert.equal(result, '上句: 第二句');
});

test('expandMacros supports SillyTavern lastUserMessage alias', () => {
  assert.equal(expandMacros('{{lastUserMessage}}', {
    messages: [{ role: 'user', content: '上一轮输入' }]
  }), '上一轮输入');
});

test('expandMacros get_worldbook returns card content by title', () => {
  const result = expandMacros('夜市信息：{{get_worldbook:title:落雁夜市}}', {
    worldBook: [
      { title: '落雁夜市', content: '子时后开张' },
      { title: '墨香书坊', content: '卖书' }
    ]
  });
  assert.equal(result, '夜市信息：子时后开张');
});

test('expandMacros renders safe EJS and read-only community variables', () => {
  const context = {
    characterCard: { name: '沈观澜' },
    lightFrontendState: { values: { favor: 21, flags: { met: true } }, revision: 2 }
  };
  const result = expandMacros(
    '<% if (mvu.flags.met) { %>{{char}}信任度 <%= getvar("favor") %> / {{getvar::favor}}<% } %>',
    context
  );

  assert.equal(result, '沈观澜信任度 21 / 21');
  assert.equal(context.lightFrontendState.values.favor, 21);
});

test('expandMacros strips unsupported EJS code without executing it', () => {
  globalThis.__lightFrontendProbe = 0;
  const result = expandMacros('<% globalThis.__lightFrontendProbe = 1 %>正文', {});

  assert.equal(result, '正文');
  assert.equal(globalThis.__lightFrontendProbe, 0);
  delete globalThis.__lightFrontendProbe;
});

test('expandMacros pick selects from custom array', () => {
  const results = new Set();
  for (let i = 0; i < 30; i++) {
    const r = expandMacros('{{pick:names}}', {
      customArrays: { names: ['甲', '乙', '丙'] }
    });
    results.add(r);
  }
  assert.ok(results.size >= 2);
});

test('expandMacros template recursively expands nested macros', () => {
  const result = expandMacros('{{template:greeting}}', {
    user: '林青阳',
    templates: [
      { name: 'greeting', content: '你好 {{user}}，今天是 {{random:晴天,雨天}}' }
    ]
  });
  assert.match(result, /^你好 林青阳，今天是 (晴天|雨天)$/);
});

test('expandMacros leaves unknown macros unchanged', () => {
  const result = expandMacros('未知宏 {{unknown_macro}} 不变', {});
  assert.equal(result, '未知宏 {{unknown_macro}} 不变');
});

test('expandMacros safely degrades Dreamer helper macros without executing helper scripts', () => {
  assert.equal(expandMacros('前{{trim}}后', {}), '前后');
  assert.equal(expandMacros('A{{压缩相邻消息::lora_constant}}B', {}), 'AB');
  assert.equal(expandMacros('{{压缩相邻消息::lora_key}}', {
    lightFrontendState: { values: { lora_key: '声明式片段' } }
  }), '声明式片段');
});

test('expandMacros applies prompt-only variable declarations in an ephemeral scope', () => {
  const context = {
    allowVariableWrites: true,
    promptVariables: {},
    promptVariableAudit: []
  };

  assert.equal(expandMacros('{{setvar::mode::director}}', context), '');
  assert.equal(expandMacros('模式={{getvar::mode}}', context), '模式=director');
  assert.equal(expandMacros('{{setvar::turn::2}}{{addvar::turn::3}}{{incvar::turn}}回合={{getvar::turn}}', context), '回合=6');
  assert.deepEqual(context.promptVariableAudit.map((item) => item.operation), ['setvar', 'setvar', 'addvar', 'incvar']);
});

test('expandMacros never persists prompt declarations or writes unsafe paths', () => {
  const context = {
    allowVariableWrites: true,
    lightFrontendState: { values: { favor: 10 } },
    promptVariables: {}
  };

  assert.equal(expandMacros('{{setvar::__proto__.polluted::true}}{{setvar::favor::99}}当前={{getvar::favor}}', context), '当前=99');
  assert.equal(context.lightFrontendState.values.favor, 10);
  assert.equal({}.polluted, undefined);
});

test('expandMacros handles empty/invalid input safely', () => {
  assert.equal(expandMacros('', {}), '');
  assert.equal(expandMacros(null, {}), null);
  assert.equal(expandMacros(undefined, {}), undefined);
  assert.equal(expandMacros('无宏文本', {}), '无宏文本');
});

test('expandMacros does not crash on invalid roll syntax', () => {
  assert.equal(expandMacros('{{roll:xyz}}', {}), '{{roll:xyz}}');
  assert.equal(expandMacros('{{roll:}}', {}), '{{roll:}}');
});
