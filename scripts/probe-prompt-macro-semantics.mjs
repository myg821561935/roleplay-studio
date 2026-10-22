import { expandMacros } from '../server/agent/macroEngine.js';

// Independent behavioral expectations; no private cards are embedded in this probe.
export function probePromptMacroSemantics() {
  const cases = [
    { id:'nested-setvar', input:'{{setvar::voice::向{{user}}问好}}{{getvar::voice}}', initial:{}, expected:'向测试玩家问好', expectedVariables:{voice:'向测试玩家问好'} },
    { id:'comment-side-effect', input:'{{// 注释中的示例 {{setvar::voice::错误语气}} }}正文', initial:{voice:'原语气'}, expected:'正文', expectedVariables:{voice:'原语气'} },
    { id:'variable-template', input:'{{getvar::voice}}', initial:{voice:'向{{user}}问好'}, expected:'向测试玩家问好', expectedVariables:{voice:'向{{user}}问好'} }
  ];
  return cases.map(item => {
    const context = { user:'测试玩家', allowVariableWrites:true, promptVariables:structuredClone(item.initial) };
    const actual = expandMacros(item.input, context);
    return { ...item, actual, actualVariables:context.promptVariables,
      status:actual === item.expected && JSON.stringify(context.promptVariables) === JSON.stringify(item.expectedVariables) ? 'passed' : 'failed' };
  });
}
