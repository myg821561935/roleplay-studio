export function getImmersiveRuntimeFeedback(memory = {}) {
  const runtime = memory.cardRuntime && typeof memory.cardRuntime === 'object' ? memory.cardRuntime : null;
  const feedback = Array.isArray(runtime?.feedback) ? runtime.feedback.at(-1) : null;
  const interaction = runtime?.interaction && typeof runtime.interaction === 'object'
    ? runtime.interaction
    : null;
  const interactionRecords = interaction?.latestIntent
    ? [{
        title: interaction.latestIntent.label || '本轮互动意图',
        detail: [
          interaction.latestIntent.text ? `玩家意图：${interaction.latestIntent.text}` : '',
          interaction.latestOutcome?.summary ? `结果：${interaction.latestOutcome.summary}` : '',
          Array.isArray(interaction.options) && interaction.options.length
            ? `可回应方向：${interaction.options.join('；')}`
            : ''
        ].filter(Boolean).join('\n')
      }]
    : [];
  const records = feedback
    ? [{
        title: formatRuntimeFeedbackTitle(feedback.status),
        detail: [
          feedback.intent ? `行动：${feedback.intent}` : '',
          feedback.summary,
          ...(Array.isArray(feedback.effects) ? feedback.effects.map((effect) => effect.summary).filter(Boolean) : [])
        ].filter(Boolean).join('\n')
      }]
    : [];
  return { runtime, records, interactionRecords };
}

function formatRuntimeFeedbackTitle(status) {
  const labels = {
    committed: '已写入公开世界状态',
    private: '存在仅导演可见的裁定',
    unresolved: '未形成可确认裁定',
    observed: '世界状态保持不变'
  };
  return labels[status] || '本轮世界反馈';
}
