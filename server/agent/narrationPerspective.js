// Extract only explicitly named, enabled perspective modules. Conflicting or
// unlabelled prose stays with the original sources instead of a guessed policy.
export function resolveNarrationPerspective(modules = []) {
  const matches = modules.filter(m => m.enabled !== false && String(m.content || '').trim()).flatMap(m => {
    const title = String(m.title || m.name || '');
    const choices = [['first', /第一人称|first.person/i], ['second', /第二人称|second.person/i], ['third', /第三人称|third.person/i]].filter(([, pattern]) => pattern.test(title));
    return choices.map(([perspective]) => ({ perspective, sourceId: m.id || '', title }));
  });
  const values = [...new Set(matches.map(m => m.perspective))];
  return { perspective: values.length === 1 ? values[0] : null, status: values.length > 1 ? 'conflict' : values.length ? 'explicit' : 'unspecified', sources: matches };
}
export function renderNarrationPerspective(result, playerName = '') {
  const candidate = String(playerName || '').trim();
  const name = !candidate || ['用户', '玩家', 'user', 'User'].includes(candidate) ? '主角原名' : candidate;
  return ({ first: '正文旁白采用第一人称，以“我”指代主角；其他角色的对白保持各自说话者的人称。',
    second: '正文旁白采用第二人称，以“你”指代主角；其他角色的对白保持各自说话者的人称。',
    third: `正文旁白采用第三人称，以“${name}”或“他/她”指代主角，不以“你”称呼主角；人物对白可以使用我、你。` })[result.perspective] || '';
}

export function inspectNarrationDrift(perspective, messages = []) {
  if (perspective?.perspective !== 'third') return { status: 'not-assessed' };
  const history = messages.filter(m => m.role === 'assistant');
  const matched = history.filter(message => {
    const prose = String(message.content || '')
      .replace(/```[\s\S]*?(?:```|$)/g, '')
      .replace(/<(thinking|analysis)>[\s\S]*?(?:<\/\1>|$)/gi, '')
      .replace(/“[^”]*(?:”|$)|「[^」]*(?:」|$)|『[^』]*(?:』|$)|"[^"\n]*(?:"|$)/g, '');
    return /你/.test(prose);
  });
  return matched.length >= 2 ? {
    status: 'possible-conflict', matchedMessages: matched.length, inspectedMessages: history.length,
    message: `当前预设指定第三人称，但最近 ${matched.length} 条历史回复疑似用第二人称旁白。模型可能继续模仿历史；请检查旧回复与预设是否一致。此提示不自动改写存档。`
  } : { status: 'no-signal', inspectedMessages: history.length };
}
