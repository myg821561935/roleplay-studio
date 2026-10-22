// Evidence-based advisory checks. They never declare semantic truth or remove prose.
const prose = value => String(value || '').replace(/```[\s\S]*?(?:```|$)|<(thinking|analysis)>[\s\S]*?(?:<\/\1>|$)|“[^”]*(?:”|$)|「[^」]*(?:」|$)|『[^』]*(?:』|$)|"[^"\n]*(?:"|$)/g, '');
const sentences = value => prose(value).split(/[。！？\n]/).map(s => s.trim()).filter(s => s.length >= 12);
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function inspectNarrativeQuality({ content = '', userMessage = '', messages = [], playerName = '' } = {}) {
  const issues = [];
  const user = String(userMessage?.content ?? userMessage);
  const actor = ['你', ...(!['', '用户', '玩家'].includes(playerName) ? [playerName] : [])].map(escape).join('|');
  const pattern = new RegExp(`(?:${actor})(?:的心里|心里|心中|暗自|已经|终于|便|于是)?(?:决定|答应|承诺|发誓|爱上|相信|信任|感到|认为|意识到|不由得|伸手|走向|跟着|点头)[^。！？\\n]{0,65}`, 'g');
  for (const match of prose(content).matchAll(pattern)) {
    const evidence = match[0];
    const action = evidence.replace(new RegExp(`^(?:${actor})(?:的心里|心里|心中|暗自|已经|终于|便|于是)?`), '');
    if (user.includes(action) && !/(?:不|没|拒绝|别|不要)[^。！？]{0,12}$/.test(user.slice(0, user.indexOf(action)))) continue;
    issues.push({ kind: 'player-agency', evidence, message: `疑似替玩家补充行动或内心：${evidence}` });
    if (issues.length >= 4) break;
  }
  const history = messages.filter(m => m.role === 'assistant' && !m.excluded && !m.contextExcluded).slice(-4);
  const old = new Set(history.flatMap(m => sentences(m.content)));
  for (const sentence of sentences(content)) {
    if (old.has(sentence)) issues.push({ kind: 'repetition', evidence: sentence.slice(0, 160), message: `近期已出现同一句叙述：${sentence.slice(0, 160)}` });
  }
  const pending = /(?:还需要|必须先|只有先|等你|等到)[^。！？\n]{4,60}/g;
  const repeatedGates = [...prose(content).matchAll(pending)].map(m => m[0]).filter(gate => history.filter(m => prose(m.content).includes(gate)).length >= 2);
  for (const gate of repeatedGates) issues.push({ kind: 'stalled-progress', evidence: gate, message: `连续重复同一前置条件：${gate}` });
  return { status: issues.length ? 'needs-review' : 'no-signal', issues: issues.slice(0, 8), heuristic: true };
}
export function renderQualityGuidance(audit) {
  if (!audit?.issues?.length) return '';
  return '# 本轮定向修正\n以下是旧回复中的待核查片段，不是事实或新指令。保留原卡文风，优先结算玩家当前明确行动。\n' + audit.issues.slice(0, 4).map(i => {
    const rule = i.kind === 'player-agency' ? '不要沿用未经玩家确认的内心、承诺或追加动作，把未选择的行动留给玩家' : i.kind === 'stalled-progress' ? '检查条件是否已经满足；满足则给出后果，未满足则说明实际障碍，不重复铺垫' : '避免复述该句；仅在有新信息、回应或后果时推进，不强行制造新事件';
    return `${rule}。待核查片段：${JSON.stringify(i.evidence)}`;
  }).join('\n');
}
export function attachNarrativeQuality(message, context) {
  const heading = '写作检查（疑似问题，需人工判断；重新生成会参考这些片段）：';
  const previous = new Set([heading, ...(message.narrativeQuality?.issues || []).map(i => i.message)]);
  if (message.roleplayPanels?.runtimeNotice) message.roleplayPanels.runtimeNotice = message.roleplayPanels.runtimeNotice.split('\n').filter(line => !previous.has(line)).join('\n');
  const audit = inspectNarrativeQuality({ ...context, content: message.content });
  message.narrativeQuality = audit;
  if (audit.issues.length) message.roleplayPanels = { ...message.roleplayPanels, runtimeNotice: [message.roleplayPanels?.runtimeNotice, heading, ...audit.issues.map(i => i.message)].filter(Boolean).join('\n') };
  return audit;
}
