import { createHash } from 'node:crypto';
export function buildPromptComparison({ session, providers = {}, generationType, content, assemble }) {
  const provider = (providers.providers || []).find(p => p.id === (session.settings?.providerId || providers.activeProviderId)) || {};
  const variants = ['faithful', 'enhanced'].map(mode => {
    try {
      const result = assemble({ promptExecutionMode: mode, agentEnhancements: {}, inspectPromptChanges: false });
      return { mode, status: 'ready', messages: result.messages, tokenEstimate: result.tokenEstimate };
    } catch (error) { return { mode, status: 'blocked', error: error.code || error.message, requiredTokens: error.requiredTokens }; }
  });
  return { version: 1, scope: 'local-assembly-preview', limitations: ['不包含实际模型输出或外部记忆检索。', '模型信息为当前配置；实际运行前需核对预设参数覆盖与供应商序列化。'], createdAt: new Date().toISOString(), sessionRevision: session.storageRevision || '',
    conditions: { generationType, content, settings: session.settings, historyHash: createHash('sha256').update(JSON.stringify(session.messages)).digest('hex'),
      provider: Object.fromEntries(['id', 'kind', 'model', 'temperature', 'topP', 'maxTokens', 'frequencyPenalty', 'presencePenalty', 'seed', 'reasoningMode'].filter(k => provider[k] !== undefined).map(k => [k, provider[k]])) },
    variants, reference: { source: 'SillyTavern', messages: null, note: '从酒馆导出同卡、同预设、同历史的实际请求后填写；不能以本项目请求冒充酒馆基线。' },
    evaluation: { status: 'not-run', axes: ['人物还原', '文风自然', '行动有后果', '重复铺垫', '玩家控制权'],
      instructions: '使用同一模型及采样参数分别生成，保存原始输出，打乱标签后按各项 1–5 分评分。重复铺垫项越少分越高。单轮固定历史评估与多轮分支评估分开记录。', scores: [] } };
}
