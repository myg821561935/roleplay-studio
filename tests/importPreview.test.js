import test from 'node:test';
import assert from 'node:assert/strict';
import { importWorldBookFromPayload } from '../server/character/worldBookImport.js';
import { previewImportPayload } from '../server/character/importPreview.js';

test('previews Character Card V2 with embedded character book', () => {
  const preview = previewImportPayload({
    fileName: 'shen.json',
    mimeType: 'application/json',
    data: JSON.stringify(createV2CardPayload())
  });

  assert.equal(preview.kind, 'character-card');
  assert.equal(preview.summary.characterName, '沈观澜');
  assert.equal(preview.summary.firstMessage, '夜雨打在刀鞘上。');
  assert.deepEqual(preview.summary.tags, ['武侠']);
  assert.equal(preview.summary.worldBookCount, 1);
  assert.deepEqual(preview.summary.keywordSamples, ['镇武司']);
  assert.deepEqual(preview.summary.declaredContentPacks, ['yingxiongzhi']);
  assert.equal(preview.summary.declaredGenre, '武侠群像 · 武侠');
  assert.equal(preview.summary.selfContained, true);
  assert.equal(preview.importData.characterCard.name, '沈观澜');
  assert.equal(preview.importData.worldBook[0].title, '镇武司暗线');
});

test('previews Character Card V3 with assets-only signal and spec summary', () => {
  // 只有 spec 与 assets、没有常规文本字段的最小 V3 卡：hasCharacterCardSignal 应识别为角色卡
  const preview = previewImportPayload({
    fileName: 'v3-min.json',
    mimeType: 'application/json',
    data: JSON.stringify({
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data: {
        name: '最小V3卡',
        assets: [
          { type: 'image', name: '立绘', ext: 'png', uri: 'https://example.com/p.png' }
        ]
      }
    })
  });

  assert.equal(preview.kind, 'character-card');
  assert.equal(preview.summary.spec, 'chara_card_v3');
  assert.equal(preview.summary.assetCount, 1);
  assert.equal(preview.summary.characterName, '最小V3卡');
  assert.equal(preview.importData.characterCard.assets.length, 1);
});

test('imports SillyTavern world book JSON object entries', () => {
  const entries = importWorldBookFromPayload({
    fileName: 'world.json',
    mimeType: 'application/json',
    data: JSON.stringify({
      entries: {
        '1': {
          comment: '听雨楼',
          key: ['听雨楼'],
          keysecondary: ['秘密'],
          content: '听雨楼贩卖秘密。',
          enabled: true,
          depth: 5,
          order: 20,
          selective: true,
          selectiveLogic: 0,
          constant: false,
          caseSensitive: false,
          position: 0
        }
      }
    })
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, '听雨楼');
  assert.deepEqual(entries[0].keywords, ['听雨楼']);
  assert.deepEqual(entries[0].secondaryKeywords, ['秘密']);
  assert.equal(entries[0].content, '听雨楼贩卖秘密。');
  assert.equal(entries[0].depth, 5);
  assert.equal(entries[0].insertionOrder, 20);
  assert.equal(entries[0].logic, 'and_any');
  assert.equal(entries[0].source, 'sillytavern-worldbook');
});

test('imports all four SillyTavern selectiveLogic values without semantic drift', () => {
  const entries = importWorldBookFromPayload({
    fileName: 'selective-world.json',
    mimeType: 'application/json',
    data: JSON.stringify({
      entries: [0, 1, 2, 3].map((selectiveLogic) => ({
        comment: `逻辑 ${selectiveLogic}`,
        key: ['主词'],
        keysecondary: ['甲', '乙'],
        content: `逻辑 ${selectiveLogic} 内容`,
        enabled: true,
        selective: true,
        selectiveLogic
      }))
    })
  });

  assert.deepEqual(entries.map((entry) => entry.matchMode), [
    'selective', 'selective', 'selective', 'selective'
  ]);
  assert.deepEqual(entries.map((entry) => entry.logic), [
    'and_any', 'not_all', 'not_any', 'and_all'
  ]);
});

test('imports SillyTavern character filters, generation triggers, and additional matching sources', () => {
  const [entry] = importWorldBookFromPayload({
    fileName: 'filtered-world.json',
    mimeType: 'application/json',
    data: JSON.stringify({
      entries: [{
        uid: 7,
        comment: '角色专属续写线索',
        keys: ['冷月印'],
        content: '继续追踪冷月印。',
        enabled: true,
        character_filter: {
          names: ['沈观澜'],
          tags: ['武侠'],
          isExclude: false
        },
        extensions: {
          triggers: ['continue', 'regenerate'],
          match_persona_description: true,
          match_character_description: true,
          match_character_personality: true,
          match_character_depth_prompt: true,
          match_scenario: true,
          match_creator_notes: true
        }
      }]
    })
  });

  assert.deepEqual(entry.characterFilter, {
    isExclude: false,
    names: ['沈观澜'],
    tags: ['武侠'],
    tagNames: ['武侠'],
    unresolvedTagIds: []
  });
  assert.deepEqual(entry.triggers, ['continue', 'regenerate']);
  assert.equal(entry.extensions.character_filter.names[0], '沈观澜');
  assert.equal(entry.extensions.match_persona_description, true);
  assert.equal(entry.extensions.match_character_description, true);
  assert.equal(entry.extensions.match_character_personality, true);
  assert.equal(entry.extensions.match_character_depth_prompt, true);
  assert.equal(entry.extensions.match_scenario, true);
  assert.equal(entry.extensions.match_creator_notes, true);
});

test('previews standalone world book imports', () => {
  const preview = previewImportPayload({
    fileName: 'world.json',
    mimeType: 'application/json',
    data: JSON.stringify({
      entries: [
        { name: '黑虎帮', keys: ['黑虎帮'], content: '黑虎帮盘踞巷陌。', enabled: true },
        { name: '空条目', keys: ['空'], content: '', enabled: true }
      ]
    })
  });

  assert.equal(preview.kind, 'world-book');
  assert.equal(preview.summary.worldBookCount, 1);
  assert.deepEqual(preview.summary.titles, ['黑虎帮']);
  assert.deepEqual(preview.summary.keywordSamples, ['黑虎帮']);
  assert.equal(preview.importData.worldBook[0].title, '黑虎帮');
});

test('recognizes named object-entry world books before character-card fallback', () => {
  const preview = previewImportPayload({
    fileName: '百鬼录.json',
    mimeType: 'application/json',
    data: JSON.stringify({
      name: '百鬼录',
      entries: {
        1: {
          comment: '纸人借命',
          key: ['纸人', '借命'],
          content: '纸人不可点睛，借命须偿。',
          enabled: true
        }
      }
    })
  });

  assert.equal(preview.kind, 'world-book');
  assert.equal(preview.summary.worldBookCount, 1);
  assert.deepEqual(preview.summary.keywordSamples, ['纸人', '借命']);
  assert.equal(preview.importData.worldBook[0].title, '纸人借命');
});

test('imports tutorial style text world book entries', () => {
  const entries = importWorldBookFromPayload({
    fileName: 'worldbook.txt',
    mimeType: 'text/plain',
    data: `条目名：星斗大森林
触发词：星斗大森林, 星斗森林, 大森林
内容：
名称: "星斗大森林"
简介: "大陆最大最危险的魂兽栖息地。"
特殊规则: "外围百年至千年级魂兽；核心区域极少有人类能活着进出。"`
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, '星斗大森林');
  assert.deepEqual(entries[0].keywords, ['星斗大森林', '星斗森林', '大森林']);
  assert.match(entries[0].content, /核心区域/);
  assert.equal(entries[0].source, 'text-worldbook');
});

test('imports YAML-like world document id blocks as world book entries', () => {
  const entries = importWorldBookFromPayload({
    fileName: 'douluo.yaml',
    mimeType: 'text/yaml',
    data: `主要地点:
- id: "loc_star_dou_forest"
名称: "星斗大森林"
简介: "大陆最大最危险的魂兽栖息地。"
信息层级: "公开"
- id: "loc_sunset_forest"
名称: "落日森林"
简介: "大陆知名魂兽栖息地。"
信息层级: "公开"`
  });

  assert.equal(entries.length, 2);
  assert.equal(entries[0].title, '星斗大森林');
  assert.deepEqual(entries[0].keywords, ['星斗大森林', 'loc_star_dou_forest']);
  assert.match(entries[1].content, /落日森林/);
  assert.equal(entries[0].source, 'yaml-worldbook');
});

test('previews YAML-like character card imports', () => {
  const preview = previewImportPayload({
    fileName: 'xiaowu.yaml',
    mimeType: 'text/yaml',
    data: `character:
name: "小舞"
first_message: "夕阳把索托城的石板街染成橘红色。"
identity:
impression: "扎着黑色蝎子辫、蹦蹦跳跳永远静不下来的灵动少女"
psychology:
values:
ranking: "唐三的安全 > 同伴的生命 > 自身生存 > 身份隐匿"
behavior:
rules:
- trigger: "唐三面临致命威胁"
action: "解除所有限制，保护唐三"
anti_ooc:
never:
- "绝不主动向外人暴露魂兽身份"`
  });

  assert.equal(preview.kind, 'character-card');
  assert.equal(preview.summary.characterName, '小舞');
  assert.match(preview.summary.firstMessage, /索托城/);
  assert.equal(preview.importData.characterCard.sourceSpec, 'yaml-character-card');
  assert.match(preview.importData.characterCard.description, /蝎子辫/);
  assert.match(preview.importData.characterCard.personality, /唐三的安全/);
  assert.match(preview.importData.characterCard.systemPrompt, /绝不主动/);
});

test('previews lra content pack and declarative plugin manifests before generic card parsing', () => {
  const contentPack = previewImportPayload({
    mimeType: 'application/json',
    data: JSON.stringify({
      spec: 'lra.content-pack/v1',
      manifest: { spec: 'lra.content-pack/v1', id: 'rain-night', version: '1.0.0', title: '听雨夜', engine: '>=0.2.2' },
      content: { characterCard: { name: '沈观澜' }, worldBook: [], promptModules: [], memory: {}, ruleSystem: {} }
    })
  });
  const plugin = previewImportPayload({
    mimeType: 'application/json',
    data: JSON.stringify({
      spec: 'lra.plugin/v1',
      id: 'community.rain-night',
      version: '1.0.0',
      name: '雨夜适配',
      adapters: [{ id: 'rain-night-lore', kinds: ['worldbook'], formats: ['json'] }]
    })
  });

  assert.equal(contentPack.kind, 'content-pack');
  assert.equal(contentPack.summary.characterName, '沈观澜');
  assert.equal(plugin.kind, 'plugin-manifest');
  assert.equal(plugin.summary.adapterCount, 1);
});

test('previews Tavern Helper normalized prompt presets without executing extensions', () => {
  const preview = previewImportPayload({
    fileName: 'story-preset.json',
    mimeType: 'application/json',
    data: JSON.stringify({
      name: '长篇叙事预设',
      settings: {
        max_context: 32000,
        max_completion_tokens: 4096,
        should_stream: true,
        temperature: 0.8
      },
      prompts: [
        {
          id: 'main',
          name: '主提示',
          enabled: true,
          role: 'system',
          content: '保持角色身份与世界边界。',
          position: { type: 'relative' }
        },
        {
          id: 'worldInfoBefore',
          name: '世界书前置锚点',
          enabled: true,
          role: 'system',
          content: '',
          position: { type: 'relative' }
        },
        {
          id: 'after-history',
          name: '历史后约束',
          enabled: true,
          role: 'user',
          content: '延续当前场景，不跳出角色。',
          position: { type: 'in_chat', depth: 2, order: 7 }
        }
      ],
      extensions: {
        regex_scripts: [{
          scriptName: '隐藏状态标签',
          findRegex: '/<state>[\\s\\S]*?<\\/state>/g',
          replaceString: '',
          placement: [2],
          markdownOnly: true
        }],
        tavern_helper: {
          scripts: [{ id: 'unsafe-runtime-hook' }],
          variables: { affection: 0 }
        }
      }
    })
  });

  assert.equal(preview.kind, 'prompt-preset');
  assert.equal(preview.title, '长篇叙事预设');
  assert.equal(preview.summary.sourceFormat, 'tavern-helper-preset');
  assert.equal(preview.summary.promptModuleCount, 2);
  assert.equal(preview.summary.placeholderCount, 1);
  assert.equal(preview.summary.regexScriptCount, 1);
  assert.equal(preview.summary.runtimeCompanionCount, 1);
  assert.equal(preview.summary.tavernHelperScriptCount, 1);
  assert.equal(preview.summary.generationSettings.maxContext, 32000);
  assert.equal(preview.summary.generationSettings.stream, true);
  assert.equal(preview.importData.promptModules[1].position, 'in_chat');
  assert.equal(preview.importData.promptModules[1].depth, 2);
  assert.equal(preview.importData.promptModules[1].role, 'user');
  assert.equal(preview.importData.promptModules[2].enabled, false);
  assert.equal(
    preview.importData.promptModules[2].extensions.sillyTavernRuntimeCompanion.kind,
    'regex'
  );
  assert.equal(
    preview.importData.promptPreset.dependencySignals.tavern_helper.execution,
    'disabled'
  );
  assert.equal(preview.importData.promptModules[0].extensions.sillyTavernPreset.promptLayout, undefined);
  assert.equal(preview.importData.promptModules[0].extensions.sillyTavernPreset.generationSettings, undefined);
});

test('previews native SillyTavern presets using prompt_order as the canonical order', () => {
  const preview = previewImportPayload({
    fileName: 'native-st.json',
    mimeType: 'application/json',
    data: JSON.stringify({
      openai_max_context: 65536,
      openai_max_tokens: 3000,
      stream_openai: false,
      temperature: 0.72,
      prompts: [
        { identifier: 'main', name: '主提示', role: 'system', content: '主提示内容' },
        { identifier: 'nsfw', name: '题材约束', role: 'system', content: '题材约束内容' },
        { identifier: 'chatHistory', name: '聊天历史', role: 'system', content: '' }
      ],
      prompt_order: [{
        character_id: 100001,
        order: [
          { identifier: 'nsfw', enabled: true },
          { identifier: 'main', enabled: true },
          { identifier: 'chatHistory', enabled: true }
        ]
      }]
    })
  });

  assert.equal(preview.kind, 'prompt-preset');
  assert.equal(preview.summary.sourceFormat, 'sillytavern-preset');
  assert.deepEqual(preview.importData.promptModules.map((item) => item.title), ['题材约束', '主提示']);
  assert.equal(preview.summary.generationSettings.maxContext, 65536);
  assert.equal(preview.summary.generationSettings.maxCompletionTokens, 3000);
  assert.equal(preview.summary.generationSettings.stream, false);
  assert.equal(preview.importData.promptPreset.promptLayout.at(-1).id, 'chatHistory');
});

test('previews staged JSON uploads across binary and parsed payload representations', () => {
  const presetDocument = {
    openai_max_context: 200000,
    openai_max_tokens: 32000,
    prompts: [
      { identifier: 'main', name: '主提示', role: 'system', content: '保持角色身份。' }
    ],
    prompt_order: [{
      character_id: 100001,
      order: [{ identifier: 'main', enabled: true }]
    }]
  };
  const presetBytes = Buffer.from(JSON.stringify(presetDocument), 'utf8');
  const presetRepresentations = [
    presetBytes,
    new Uint8Array(presetBytes),
    presetBytes.buffer.slice(presetBytes.byteOffset, presetBytes.byteOffset + presetBytes.byteLength),
    presetBytes.toJSON(),
    presetDocument
  ];

  for (const data of presetRepresentations) {
    const preview = previewImportPayload({
      fileName: 'binary-preset.json',
      mimeType: 'application/json',
      data
    });
    assert.equal(preview.kind, 'prompt-preset');
    assert.equal(preview.summary.promptModuleCount, 1);
    assert.equal(preview.summary.generationSettings.maxCompletionTokens, 32000);
  }

  const worldBookPreview = previewImportPayload({
    fileName: 'binary-world.json',
    mimeType: 'application/json',
    data: new Uint8Array(Buffer.from(JSON.stringify({
      entries: [{ name: '天琴座', keys: ['天琴座'], content: '故事发生地。', enabled: true }]
    }), 'utf8'))
  });
  assert.equal(worldBookPreview.kind, 'world-book');
  assert.equal(worldBookPreview.summary.worldBookCount, 1);

  const characterBytes = Buffer.from(JSON.stringify(createV2CardPayload()), 'utf8');
  const characterPreview = previewImportPayload({
    fileName: 'binary-character.json',
    mimeType: 'application/json',
    data: characterBytes.buffer.slice(
      characterBytes.byteOffset,
      characterBytes.byteOffset + characterBytes.byteLength
    )
  });
  assert.equal(characterPreview.kind, 'character-card');
  assert.equal(characterPreview.summary.characterName, '沈观澜');
});

test('previews standalone SillyTavern regex presets as safe runtime companions', () => {
  const preview = previewImportPayload({
    fileName: 'tg-regex.json',
    mimeType: 'application/json',
    data: JSON.stringify([
      {
        id: 'prompt-user',
        scriptName: '用户输入清理',
        findRegex: '/秘密/g',
        replaceString: '{{user}}的隐情',
        placement: [1],
        promptOnly: true
      },
      {
        id: 'display-panel',
        scriptName: '静态状态框',
        findRegex: '/<status\\/>/g',
        replaceString: '<div><strong>状态</strong></div>',
        placement: [2],
        markdownOnly: true
      },
      {
        id: 'blocked-script',
        scriptName: '动态脚本',
        findRegex: '/<widget\\/>/g',
        replaceString: '<script>window.run()</script>',
        placement: [2],
        markdownOnly: true
      }
    ])
  });

  assert.equal(preview.kind, 'regex-preset');
  assert.equal(preview.summary.regexScriptCount, 3);
  assert.equal(preview.summary.safeRegexScriptCount, 2);
  assert.equal(preview.summary.degradedRegexScriptCount, 1);
  assert.equal(preview.summary.sandboxedRegexScriptCount, 1);
  assert.equal(preview.summary.blockedRegexScriptCount, 0);
  assert.equal(preview.summary.truncatedRegexScriptCount, 0);
  assert.equal(preview.importData.promptModules.length, 1);
  assert.equal(preview.importData.promptModules[0].enabled, false);
  assert.equal(
    preview.importData.promptModules[0].extensions.sillyTavernRuntimeCompanion.ruleCount,
    3
  );
});

test('previews a single exported SillyTavern regex rule as a one-rule preset', () => {
  const preview = previewImportPayload({
    fileName: 'REGEX_JX16_HIDE_PRIVATE_CALIBRATION.json',
    mimeType: 'application/json',
    data: JSON.stringify({
      id: 'single-rule',
      scriptName: 'JX16｜隐藏泄漏的后台校准',
      findRegex: '/【后台校准】[\\s\\S]*?【后台校准结束】/g',
      replaceString: '',
      placement: [2],
      markdownOnly: true,
      promptOnly: true,
      disabled: false
    })
  });

  assert.equal(preview.kind, 'regex-preset');
  assert.equal(preview.title, 'JX16｜隐藏泄漏的后台校准');
  assert.equal(preview.summary.regexScriptCount, 1);
  assert.equal(preview.importData.promptModules[0].extensions.sillyTavernRuntimeCompanion.ruleCount, 1);
});

test('reports truncated regex rules when count exceeds runtime limit (32)', () => {
  const rules = [];
  for (let index = 0; index < 40; index += 1) {
    rules.push({
      id: `rule-${index}`,
      scriptName: `规则 ${index}`,
      findRegex: `/pattern${index}/g`,
      replaceString: `替换${index}`
    });
  }
  const preview = previewImportPayload({
    fileName: 'many-rules.json',
    mimeType: 'application/json',
    data: JSON.stringify(rules)
  });
  assert.equal(preview.kind, 'regex-preset');
  assert.equal(preview.summary.regexScriptCount, 40);
  assert.equal(preview.summary.truncatedRegexScriptCount, 8);
  const classified = preview.summary.safeRegexScriptCount
    + preview.summary.degradedRegexScriptCount
    + preview.summary.sandboxedRegexScriptCount
    + preview.summary.blockedRegexScriptCount
    + preview.summary.truncatedRegexScriptCount;
  assert.equal(classified, 40);
});

test('world book import preserves activation fields separately from insertion depth', () => {
  const [entry] = importWorldBookFromPayload({
    data: JSON.stringify({
      scan_depth: 6,
      entries: [{
        uid: 7,
        key: ['镇武司'],
        comment: '镇武司暗线',
        content: '镇武司旧案背后另有朝堂暗线。',
        enabled: true,
        probability: 35,
        useProbability: true,
        group: '暗线事件',
        group_override: true,
        group_weight: 80,
        sticky: 3,
        cooldown: 2,
        delay: 1,
        delay_until_recursion: 2,
        case_sensitive: false,
        match_whole_words: true
      }]
    })
  });

  assert.equal(entry.depth, 4);
  assert.equal(entry.extensions.scan_depth, 6);
  assert.equal(entry.extensions.probability, 35);
  assert.equal(entry.extensions.useProbability, true);
  assert.equal(entry.extensions.group, '暗线事件');
  assert.equal(entry.extensions.group_override, true);
  assert.equal(entry.extensions.group_weight, 80);
  assert.equal(entry.extensions.sticky, 3);
  assert.equal(entry.extensions.cooldown, 2);
  assert.equal(entry.extensions.delay, 1);
  assert.equal(entry.extensions.delay_until_recursion, 2);
  assert.equal(entry.extensions.case_sensitive, false);
  assert.equal(entry.extensions.match_whole_words, true);
  assert.equal(entry.extensions.scan_depth_inherited, true);
  assert.equal(entry.caseSensitive, false);
  assert.equal(entry.matchWholeWords, true);
});

function createV2CardPayload() {
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: '沈观澜',
      description: '初入江湖的刀客。',
      personality: '沉稳，重诺。',
      scenario: '正在调查镇武司旧案。',
      first_mes: '夜雨打在刀鞘上。',
      alternate_greetings: ['雨还没停。'],
      tags: ['武侠'],
      system_prompt: '保持武侠叙事。',
      extensions: {
        contentPack: 'yingxiongzhi',
        genre: '武侠群像'
      },
      character_book: {
        scan_depth: 6,
        entries: [{
          id: 7,
          name: '镇武司暗线',
          keys: ['镇武司'],
          secondary_keys: ['暗线'],
          selective: true,
          content: '镇武司旧案背后另有朝堂暗线。',
          enabled: true,
          insertion_order: 10
        }]
      }
    }
  };
}
