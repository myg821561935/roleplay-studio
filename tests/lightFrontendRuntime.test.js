import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyDisplayTransforms,
  applyPromptTransforms,
  applyMvuPatch,
  expandQuickReply,
  extractLightFrontendRuntime,
  inspectSafeTemplate,
  mergeLightFrontendRuntimes,
  normalizeLightFrontendRuntime,
  renderSafeTemplate
} from '../server/compat/lightFrontendRuntime.js';
import {
  applyLightFrontendDisplayTransforms,
  expandLightFrontendQuickReply,
  getLightFrontendPanels,
  getLightFrontendQuickReplies,
  resolveLightFrontendPanel,
  renderSafeLightFrontendTemplate
} from '../public/modules/lightFrontend.js';

test('extracts safe regex, text quick replies and MVU seed from community extensions', () => {
  const runtime = extractLightFrontendRuntime({
    data: {
      extensions: {
        regex_scripts: [{ scriptName: '隐藏状态', findRegex: '/<state>[\\s\\S]*?<\\/state>/g', replaceString: '' }],
        quick_replies: [
          { label: '继续', command: '/send {{char}}继续观察' },
          { label: '危险命令', command: '/setvar mood angry' }
        ],
        mvu: { values: { favor: 10, flags: { met: true } } }
      }
    }
  });

  assert.equal(runtime.executesThirdPartyCode, false);
  assert.equal(runtime.regexTransforms.length, 1);
  assert.equal(runtime.quickReplies.length, 2);
  assert.equal(runtime.quickReplies[0].template, '{{char}}继续观察');
  assert.equal(runtime.quickReplies[1].actionType, 'mvu-patch');
  assert.deepEqual(runtime.quickReplies[1].patch.operations, [
    { op: 'set', path: 'variables.mood', value: 'angry' }
  ]);
  assert.deepEqual(runtime.mvu.values, { chat: { favor: 10, flags: { met: true } }, global: {} });
  assert.equal(runtime.diagnostics.some((item) => item.code === 'command-quick-reply-disabled'), false);
});

test('display transforms affect presentation without mutating the raw message', () => {
  const raw = '正文<state>{"favor":10}</state>';
  const runtime = normalizeLightFrontendRuntime({
    regexTransforms: [{ pattern: '<state>[\\s\\S]*?</state>', replacement: '', flags: 'g' }]
  });

  assert.equal(applyDisplayTransforms(raw, runtime.regexTransforms), '正文');
  assert.equal(applyLightFrontendDisplayTransforms(raw, runtime), '正文');
  assert.equal(raw, '正文<state>{"favor":10}</state>');
});

test('SillyTavern regex placement and prompt/display modes retain their original boundaries', () => {
  const runtime = normalizeLightFrontendRuntime({
    regexTransforms: [
      {
        id: 'user-prompt',
        pattern: '秘密',
        replacement: '{{user}}的隐情',
        placement: 1,
        promptOnly: true
      },
      {
        id: 'assistant-prompt',
        pattern: '线索',
        replacement: '{{char}}掌握的线索',
        placement: 2,
        promptOnly: true
      },
      {
        id: 'assistant-display',
        pattern: '<status/>',
        replacement: '<div><strong>境界</strong>：筑基</div>',
        placement: 2,
        markdownOnly: true
      }
    ]
  });
  const context = { user: '旅人', char: '闻雪照' };

  assert.equal(
    applyPromptTransforms('秘密与线索', runtime.regexTransforms, { role: 'user', context }),
    '旅人的隐情与线索'
  );
  assert.equal(
    applyPromptTransforms('秘密与线索', runtime.regexTransforms, { role: 'assistant', context }),
    '秘密与闻雪照掌握的线索'
  );
  assert.equal(
    applyDisplayTransforms('秘密与线索', runtime.regexTransforms, { role: 'assistant', context }),
    '秘密与线索'
  );
  const display = applyDisplayTransforms('<status/>', runtime.regexTransforms, {
    role: 'assistant',
    context
  });
  assert.match(display, /境界/);
  assert.match(display, /筑基/);
  assert.doesNotMatch(display, /<div>|<strong>/);
});

test('static HTML display replacements never expose embedded stylesheet source as prose', () => {
  const runtime = normalizeLightFrontendRuntime({
    regexTransforms: [{
      pattern: '<state/>',
      replacement: '<details><summary>状态完成</summary><div>已更新</div></details><style>.neko-complete{display:none}@keyframes neko-happy{to{opacity:1}}</style>',
      placement: 2,
      markdownOnly: true
    }]
  });

  const display = applyLightFrontendDisplayTransforms('<state/>', runtime);
  assert.match(display, /状态完成/);
  assert.match(display, /已更新/);
  assert.doesNotMatch(display, /neko-complete|@keyframes|display\s*:/i);
});

test('executable regex replacements are flagged for sandboxed rendering instead of being dropped', () => {
  const runtime = normalizeLightFrontendRuntime({
    regexTransforms: [{
      id: 'unsafe-widget',
      pattern: '<widget/>',
      replacement: '<script>window.run()</script>',
      placement: 2,
      markdownOnly: true
    }]
  });

  assert.equal(runtime.regexTransforms.length, 1);
  assert.equal(runtime.regexTransforms[0].requiresSandbox, true);
  assert.equal(runtime.regexTransforms[0].markdownOnly, true);
  assert.ok(runtime.diagnostics.some((item) => item.code === 'executable-regex-replacement-sandboxed'));
  assert.equal(runtime.executesThirdPartyCode, false);
});

test('display transform replacements can read MVU state without executing code', () => {
  const runtime = normalizeLightFrontendRuntime({
    regexTransforms: [{ pattern: '<favor/>', replacement: '好感 <%= mvu.favor %>', flags: 'g' }]
  });
  const context = { mvu: { values: { favor: 18 } } };

  assert.equal(applyDisplayTransforms('状态：<favor/>', runtime.regexTransforms, { context }), '状态：好感 18');
  assert.equal(applyLightFrontendDisplayTransforms('状态：<favor/>', runtime, { context }), '状态：好感 18');
});

test('display transform replacements expand user and character-name macros on server and browser', () => {
  const runtime = normalizeLightFrontendRuntime({
    regexTransforms: [{ pattern: '<speaker/>', replacement: '{{character name}}回应{{user}}', flags: 'g' }]
  });
  const context = { char: '闻雪照', user: '旅人' };

  assert.equal(applyDisplayTransforms('<speaker/>', runtime.regexTransforms, { context }), '闻雪照回应旅人');
  assert.equal(applyLightFrontendDisplayTransforms('<speaker/>', runtime, { context }), '闻雪照回应旅人');
});

test('unsafe regex patterns and executable quick replies remain disabled', () => {
  const runtime = normalizeLightFrontendRuntime({
    regexTransforms: [{ name: 'nested', pattern: '(a+)+$', replacement: '' }],
    quickReplies: [{ label: 'script', content: '<script>alert(1)</script>' }]
  });

  assert.equal(runtime.regexTransforms.length, 0);
  assert.equal(runtime.quickReplies.length, 0);
  assert.ok(runtime.diagnostics.some((item) => item.code === 'unsafe-regex-disabled'));
  assert.ok(runtime.diagnostics.some((item) => item.code === 'command-quick-reply-disabled'));
});

test('MVU patches are versioned and support only declarative operations', () => {
  const first = applyMvuPatch({ enabled: true, values: { favor: 2 }, revision: 0 }, {
    operations: [
      { op: 'increment', path: 'favor', value: 3 },
      { op: 'set', path: 'flags.met', value: true }
    ]
  }, { expectedRevision: 0 });

  assert.deepEqual(first, {
    enabled: true,
    values: { chat: { favor: 5, flags: { met: true } }, global: {} },
    revision: 1
  });
  assert.throws(
    () => applyMvuPatch(first, [{ op: 'set', path: 'favor', value: 9 }], { expectedRevision: 0 }),
    /MVU_REVISION_CONFLICT/
  );
  assert.throws(
    () => applyMvuPatch(first, [{ op: 'set', path: '__proto__.polluted', value: true }]),
    /INVALID_MVU_PATH/
  );
});

test('merged runtimes deduplicate controls and browser expansion uses a small macro set', () => {
  const runtime = mergeLightFrontendRuntimes([
    { quickReplies: [{ id: 'continue', label: '继续', content: '{{char}}继续' }], mvu: { values: { favor: 1 } } },
    { quickReplies: [{ id: 'continue', label: '重复', content: '重复' }], mvu: { values: { scene: '客栈' } } }
  ]);
  const replies = getLightFrontendQuickReplies(runtime);

  assert.equal(replies.length, 1);
  assert.deepEqual(runtime.mvu.values, { chat: { favor: 1, scene: '客栈' }, global: {} });
  assert.equal(expandQuickReply(runtime.quickReplies[0], { char: '沈观澜' }), '沈观澜继续');
  assert.equal(expandLightFrontendQuickReply(replies[0], { char: '沈观澜' }), '沈观澜继续');
});

test('Chinese quick reply labels retain distinct stable ids when runtimes merge', () => {
  const runtime = mergeLightFrontendRuntimes([
    extractLightFrontendRuntime({ quick_replies: [{ label: '问旧案', command: '/send 追问旧案' }] }),
    extractLightFrontendRuntime({ quick_replies: [{ label: '查看线索', command: '/send 查看线索' }] })
  ]);

  assert.deepEqual(runtime.quickReplies.map((item) => item.id), ['问旧案', '查看线索']);
  assert.equal(runtime.quickReplies.length, 2);
});

test('safe EJS subset renders read-only state and strips executable tags', () => {
  const template = '<% if (mvu.favor >= 20) { %>愿意同行：<%= getvar("favor") %><% } else { %>仍需观察<% } %>';
  const context = { mvu: { values: { favor: 24 } } };

  assert.equal(inspectSafeTemplate(template).supported, true);
  assert.equal(renderSafeTemplate(template, context, { unsupported: 'strip' }), '愿意同行：24');
  assert.equal(renderSafeLightFrontendTemplate(template, context), '愿意同行：24');
  assert.equal(expandQuickReply({ content: '当前好感 {{getvar::favor}}' }, context), '当前好感 24');
  assert.equal(expandLightFrontendQuickReply({ template: '当前好感 {{getvar::favor}}' }, context), '当前好感 24');
  assert.equal(
    renderSafeTemplate('<% state.favor = 999 %>正文', context, { unsupported: 'strip' }),
    '正文'
  );
  assert.equal(context.mvu.values.favor, 24);
});

test('community adapter namespaces map declarative data but keep executable markers disabled', () => {
  const runtime = extractLightFrontendRuntime({
    extensions: {
      tavern_helper: {
        variables: { favor: 8 },
        buttons: [{ label: '询问旧案', text: '/send 询问旧案' }],
        panels: [{
          title: '关系档案',
          kind: 'stats',
          summary: '<% if (mvu.favor >= 5) { %>已建立初步信任<% } else { %>仍在观望<% } %>',
          fields: [{ label: '好感', path: 'favor' }],
          items: [{ title: '本幕关系', detail: '当前值 <%= getvar("favor") %>' }]
        }],
        hooks: { onMessage: 'setState()' }
      },
      xiaobai_x: {
        regex_scripts: [{ name: '隐藏变量', pattern: '<vars>[\\s\\S]*?</vars>', replacement: '' }]
      }
    }
  });

  assert.equal(runtime.mvu.values.chat.favor, 8);
  assert.equal(runtime.quickReplies[0].template, '询问旧案');
  assert.equal(runtime.regexTransforms.length, 1);
  assert.equal(runtime.panels[0].fields[0].template, '<%= mvu.favor %>');
  assert.equal(runtime.panels[0].onClick, undefined);
  assert.ok(runtime.adapters.find((item) => item.id === 'tavern-helper' && item.mode === 'declarative-partial'));
  assert.ok(runtime.adapters.find((item) => item.id === 'xiaobai-x' && item.mode === 'declarative-partial'));
  assert.ok(runtime.adapters.find((item) => item.id === 'tavern-helper').unsupportedCapabilities.includes('hooks'));
  assert.ok(runtime.adapters.find((item) => item.id === 'tavern-helper').mappedCapabilities.includes('sidebar-panels'));
  assert.equal(runtime.executesThirdPartyCode, false);

  const panels = getLightFrontendPanels(runtime);
  const resolved = resolveLightFrontendPanel(panels[0], { mvu: { values: { favor: 8 } } });
  assert.equal(resolved.summary, '已建立初步信任');
  assert.deepEqual(resolved.fields.map((field) => [field.label, field.value]), [['好感', '8']]);
  assert.equal(resolved.items[0].detail, '当前值 8');
});

test('common heavy frontend status markup becomes native sidebar panels without executing scripts', () => {
  const runtime = extractLightFrontendRuntime({
    extensions: {
      regex_scripts: [{
        name: '角色状态面板',
        pattern: '<status/>',
        replacement: `
          <section class="status-panel" onclick="steal()">
            <script>globalThis.pwned = true</script>
            <style>.hidden { display:none }</style>
            <h2>主角信息</h2>
            <table>
              <tr><th>境界</th><td>筑基初期</td></tr>
              <tr><th>灵石</th><td>18</td></tr>
            </table>
          </section>
          <details>
            <summary>互动角色</summary>
            <ul>
              <li>苏月白：信任 12</li>
              <li>霍银铃：仍在观察</li>
            </ul>
          </details>
        `
      }]
    }
  });

  assert.equal(runtime.executesThirdPartyCode, false);
  assert.deepEqual(runtime.panels.map((item) => item.title), ['主角信息', '互动角色']);
  assert.deepEqual(runtime.panels[0].fields.map((item) => item.label), ['境界', '灵石']);
  assert.equal(runtime.panels[1].items[0].title, '苏月白');
  assert.equal(JSON.stringify(runtime.panels).includes('globalThis.pwned'), false);
  assert.equal(JSON.stringify(runtime.panels).includes('onclick'), false);
  assert.ok(runtime.adapters.find((item) => item.id === 'static-status-panel'));
  assert.ok(runtime.diagnostics.some((item) => item.code === 'third-party-executable-disabled'));
});

test('generation-time status templates are deferred instead of exposed as live sidebar state', () => {
  const runtime = extractLightFrontendRuntime({
    worldBook: [{
      title: '状态栏',
      content: `<StatusBlock><CharacterStatus><details>
        <summary>---{{character name}}状态栏---</summary>
        角色：{{character name}}<br>
        人物特质：{{用4到6个词组标签突出角色特色}}<br>
        催眠等级：{{严格按照催眠等级体系词条执行}}<br>
        当前目标：{{结合剧情填写当前目标}}
      </details></CharacterStatus></StatusBlock>`
    }]
  });

  assert.deepEqual(runtime.panels, []);
  assert.ok(runtime.diagnostics.some((item) => item.code === 'static-status-template-deferred'));

  const stalePanel = resolveLightFrontendPanel({
    title: '---{{character name}}状态栏---',
    kind: 'stats',
    fields: [
      { label: '角色', value: '{{character name}}' },
      { label: '人物特质', value: '{{用4到6个词组标签突出角色特色}}' },
      { label: '催眠等级', value: '{{严格按照催眠等级体系词条执行}}' }
    ]
  }, { char: '林夏' });
  assert.equal(stalePanel, null);
});

test('character name compatibility alias resolves in concrete declarative panels', () => {
  const panel = resolveLightFrontendPanel({
    title: '{{character name}}状态',
    kind: 'stats',
    fields: [{ label: '地点', value: '旧城区' }]
  }, { char: '林夏' });

  assert.equal(panel.title, '林夏状态');
  assert.deepEqual(panel.fields, [{ id: '', label: '地点', value: '旧城区', tone: 'default', wide: false }]);
});

test('unknown community adapter namespaces are not promoted into executable runtimes', () => {
  const runtime = extractLightFrontendRuntime({
    extensions: {
      unknown_magic_adapter: {
        panels: [{ title: '未知面板', content: '不应通过命名空间白名单。' }],
        script: 'runUnknownCode()'
      }
    }
  });

  assert.equal(runtime.adapters.some((item) => item.id === 'unknown_magic_adapter'), false);
  assert.equal(runtime.executesThirdPartyCode, false);
});
