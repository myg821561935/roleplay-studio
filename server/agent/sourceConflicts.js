import { inspectNarrationDrift, resolveNarrationPerspective } from './narrationPerspective.js';
export function inspectSourceConflicts({ modules = [], characterCard = {}, messages = [] } = {}) {
  const sources = modules.filter(m => m.enabled !== false).map(m => ({ id: m.id, title: m.title || m.name || m.id, content: m.content, kind: 'preset' }));
  for (const field of ['systemPrompt', 'postHistoryInstructions', 'description']) if (characterCard[field]) sources.push({ id: `card:${field}`, title: `原卡 ${field}`, content: characterCard[field], kind: 'card' });
  const rules = [
    ['perspective', [['first', /(?:采用|使用|必须|保持|以)[^。\n]{0,8}第一人称|^第一人称/m], ['second', /(?:采用|使用|必须|保持|以)[^。\n]{0,8}第二人称|^第二人称/m], ['third', /(?:采用|使用|必须|保持|以)[^。\n]{0,8}第三人称|^第三人称/m]]],
    ['format', [['json', /(?:只|仅)(?:能)?输出\s*JSON/i], ['prose', /(?:只|仅)(?:能)?输出(?:正文|纯文本)|禁止(?:使用|输出)\s*JSON/i]]]
  ];
  const conflicts = [];
  for (const [dimension, choices] of rules) {
    const matched = sources.flatMap(s => choices.filter(([, re]) => re.test(`${s.title}\n${s.content || ''}`)).map(([value]) => ({ ...s, content: undefined, value })));
    if (new Set(matched.map(s => s.value)).size > 1) conflicts.push({ dimension, sources: matched, message: `${dimension === 'perspective' ? '叙述人称' : '输出格式'}指令冲突：${matched.map(s => `${s.title}（${s.value}）`).join('、')}。请关闭冲突预设，或局部覆盖为原卡要求的格式。` });
  }
  const perspective = resolveNarrationPerspective(modules);
  if (perspective.status === 'conflict' && !conflicts.some(c => c.dimension === 'perspective')) conflicts.push({ dimension: 'perspective', sources: perspective.sources, message: `多个预设同时指定不同人称：${perspective.sources.map(s => s.title).join('、')}。请仅启用一个人称来源。` });
  const drift = inspectNarrationDrift(perspective, messages);
  if (drift.status === 'possible-conflict') conflicts.push({ dimension: 'history', sources: [], message: drift.message });
  return { status: conflicts.length ? 'conflict' : 'no-signal', conflicts };
}
