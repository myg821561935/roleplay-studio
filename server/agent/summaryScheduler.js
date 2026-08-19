import { buildNarrativeMaintenanceAnchor } from './narrativeControl.js';
import { sanitizeMemoryText } from '../memory/memoryContract.js';

export function shouldSummarize({ unsummarizedTurnCount, promptTokenEstimate, maxPromptTokens }) {
  const turns = Number(unsummarizedTurnCount || 0);
  if (turns >= 4) return true;
  if (turns >= 3 && Number(promptTokenEstimate) > Number(maxPromptTokens || 8000) * 0.9) return true;
  return false;
}

export function buildSummaryPrompt({ rollingSummary, messages, narrativeContext, canonicalContext = '' }) {
  const transcript = messages.map((message) => `${message.role}: ${message.content}`).join('\n');
  const narrativeAnchor = buildNarrativeMaintenanceAnchor(narrativeContext);
  return [
    {
      role: 'system',
      content: [
        '你是长篇角色扮演的记忆整理器。请用中文更新滚动摘要，并单独提炼本批新增对话形成的场景摘要。保留事实、关系、目标、承诺和未完成线索，不要添加原文没有确认的事实。',
        '事实优先级固定为：角色卡与已启用世界书 > 用户明确确认的事实与行动 > 不冲突的既有会话事实 > 旧摘要和模型生成的候选状态。冲突时只保留高优先级版本，并明确低优先级版本已废弃；不得把两套互斥的人物、时间、地点或事件版本都写进稳定事实。',
        '隐藏身份、秘密、幕后动机和未公开物品不得写成主角已知事实，除非新增对话中已经发生可观察的揭露。',
        narrativeAnchor ? `\n【不可丢失的叙事锚点】\n${narrativeAnchor}` : '',
        '输出依次保留：题材锚点、当前主线、稳定事实、关系与承诺、从属支线、未完成线索。',
        '从属支线只记录其对主线、题材支柱、资源、关系或证据的回流，不得在摘要中擅自升级为新主线。',
        '只输出一个 JSON 对象，不要输出 Markdown、分析过程或思维链。格式：{"rollingSummary":"整合旧摘要后的全局滚动摘要","sceneTitle":"本批新增对话的简短场景名","sceneSummary":"只概括本批新增对话，不重复整段旧摘要"}'
      ].filter(Boolean).join('\n')
    },
    { role: 'user', content: `${canonicalContext ? `角色卡与世界书事实源：\n${canonicalContext}\n\n` : ''}旧摘要：\n${rollingSummary || '无'}\n\n新增对话：\n${transcript}\n\n请以事实源为准输出新的滚动摘要与独立场景摘要。` }
  ];
}

export function parseSummaryResult(content) {
  const raw = String(content || '').trim();
  const payload = parseJsonObject(raw);
  if (!payload) {
    const fallback = sanitizeMemoryText(raw, 8000);
    return {
      rollingSummary: fallback,
      sceneTitle: '',
      sceneSummary: '',
      structured: false
    };
  }
  const scenePayload = payload.sceneSummary ?? payload.scene_summary ?? payload.scene;
  const sceneSummary = typeof scenePayload === 'object' && scenePayload
    ? scenePayload.summary ?? scenePayload.content
    : scenePayload;
  const sceneTitle = typeof scenePayload === 'object' && scenePayload
    ? scenePayload.title ?? payload.sceneTitle ?? payload.scene_title
    : payload.sceneTitle ?? payload.scene_title;
  const rollingSummary = sanitizeMemoryText(
    payload.rollingSummary ?? payload.rolling_summary ?? payload.summary ?? sceneSummary,
    8000
  );
  return {
    rollingSummary,
    sceneTitle: sanitizeMemoryText(sceneTitle, 160),
    sceneSummary: sanitizeMemoryText(sceneSummary, 1200),
    structured: true
  };
}

function parseJsonObject(raw) {
  const unfenced = String(raw || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const candidates = [unfenced];
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(unfenced.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      // Plain text remains compatible with older summary providers.
    }
  }
  return null;
}
