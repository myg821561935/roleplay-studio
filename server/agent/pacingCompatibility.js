// A narrow, auditable adaptation of incompatible mandatory pacing rules.
// Imported resources remain untouched; only the rendered prompt is adjusted.
export function adaptPacingToCard(content, card = {}) {
  const style = [card.systemPrompt, card.description, card.postHistoryInstructions].filter(Boolean).join('\n');
  if (!/节奏缓慢|不急于推进剧情/.test(style)) return content;
  return String(content).replace(
    '在回复的结尾处，呈现一个未完成的动作、一个突发的状况或一个需要玩家做出反应的紧迫抉择，以此保持故事的张力。',
    '遵循原卡的慢节奏与留白：当前互动获得回应后可以自然收束；只有已有事件确实形成未决节点时才保留悬念，不强制在每轮结尾制造突发事件或紧迫抉择。'
  ).replace(
    '每一次互动都必须附加至少一句改变局势或提供新变量的「推进叙述」。',
    '当前行动得到具体反馈、问题得到回答，也属于有效推进；无需为满足每轮指标额外引入新变量。'
  );
}
