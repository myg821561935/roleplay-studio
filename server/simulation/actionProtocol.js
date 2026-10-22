import { renderGroundedLedger } from './groundedLedger.js';
import crypto from 'node:crypto';

export const ACTION_PROTOCOL_SPEC = 'lra.action/v1';
export const MAX_ACTIONS_PER_ENVELOPE = 20;

const ACTION_TYPES = new Set([
  'commitment.update',
  'item.register',
  'item.move',
  'item.transfer',
  'state.set',
  'state.increment',
  'state.append',
  'state.remove',
  'actor.move',
  'actor.status',
  'actor.knowledge.add',
  'actor.relationship.adjust',
  'quest.update',
  'clock.advance'
]);
const VISIBILITIES = new Set(['public', 'private', 'director']);
const CONDITION_OPERATORS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'includes', 'exists']);
const BLOCK_PATTERNS = [
  /```lra-actions\s*([\s\S]*?)```/gi,
  /<lra-actions>\s*([\s\S]*?)<\/lra-actions>/gi
];

export class ActionProtocolError extends Error {
  constructor(code, detail = '') {
    super(code);
    this.name = 'ActionProtocolError';
    this.code = code;
    this.detail = detail;
  }
}

export function normalizeActionEnvelope(input, { maxActions = MAX_ACTIONS_PER_ENVELOPE, rejectedActions = null } = {}) {
  const source = Array.isArray(input) ? { actions: input } : input;
  if (!isPlainObject(source)) throw new ActionProtocolError('ACTION_ENVELOPE_INVALID');

  const spec = String(source.spec || source.schema || ACTION_PROTOCOL_SPEC).trim();
  if (spec !== ACTION_PROTOCOL_SPEC) {
    throw new ActionProtocolError('ACTION_SPEC_UNSUPPORTED', spec);
  }

  const sourceActions = Array.isArray(source.actions) ? source.actions : [];
  if (!sourceActions.length) throw new ActionProtocolError('ACTION_LIST_EMPTY');
  if (sourceActions.length > maxActions) {
    throw new ActionProtocolError('ACTION_LIST_TOO_LARGE', String(sourceActions.length));
  }

  const baseRevision = source.baseRevision === undefined || source.baseRevision === null
    ? null
    : normalizeNonNegativeInteger(source.baseRevision, 'ACTION_BASE_REVISION_INVALID');

  return {
    spec: ACTION_PROTOCOL_SPEC,
    id: normalizeId(source.id, 'envelope'),
    actorId: normalizeOptionalId(source.actorId || source.actor || 'narrator') || 'narrator',
    summary: normalizeText(source.summary || source.intent, 240),
    baseRevision,
    actions: sourceActions.flatMap((action, index) => {
      try { return [normalizeAction(action, index)]; }
      catch (error) {
        if (!Array.isArray(rejectedActions)) throw error;
        rejectedActions.push({ index, code: error.code || 'ACTION_INVALID', detail: error.detail || '' });
        return [];
      }
    })
  };
}

export function extractActionEnvelope(text) {
  const source = String(text || '');
  let rawPayload = '';
  let matchedBlock = '';

  for (const pattern of BLOCK_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(source);
    if (match) {
      matchedBlock = match[0];
      rawPayload = match[1];
      break;
    }
  }

  if (!matchedBlock) {
    return { content: source, envelope: null, error: null, rawPayload: '' };
  }

  const content = stripActionBlocks(source).trimEnd();
  try {
    const parsed = JSON.parse(String(rawPayload || '').trim());
    const rejectedActions = [];
    const envelope = normalizeActionEnvelope(parsed, { rejectedActions });
    return {
      content,
      envelope: envelope.actions.length ? envelope : null,
      error: rejectedActions.length
        ? new ActionProtocolError('ACTION_ITEMS_INVALID', JSON.stringify(rejectedActions))
        : null,
      rawPayload: String(rawPayload || '').trim()
    };
  } catch (error) {
    const protocolError = error instanceof ActionProtocolError
      ? error
      : new ActionProtocolError('ACTION_JSON_INVALID', error.message);
    return { content, envelope: null, error: protocolError, rawPayload: String(rawPayload || '').trim() };
  }
}

export function stripActionBlocks(text) {
  let result = String(text || '');
  for (const pattern of BLOCK_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, '');
  }
  return result;
}

export function buildActionProtocolPrompt({ memory, targetSpeaker } = {}) {
  const revision = Number(memory?.simulation?.revision || 0);
  const speaker = String(targetSpeaker || '').trim();
  return [
    '# 世界动作协议',
    `当前状态修订号：${revision}。`,
    '叙事正文之后，如本回合确实造成可持续的世界变化，必须追加一个且仅一个 ```lra-actions JSON 块；没有稳定变化时不要输出该块。',
    '动作只是提议，最终由本地裁定器执行。不要在正文中解释协议，也不要把协议块当作对白。',
    '允许类型：state.set、state.increment、state.append、state.remove、actor.move、actor.status、actor.knowledge.add、actor.relationship.adjust、quest.update、clock.advance、commitment.update、item.register、item.move、item.transfer。',
    '每个动作应给出 reason；不确定的事实不要写入。私密情报使用 visibility=private，只有导演视图可见。',
    '字段约束：state.set/append/remove 使用 path 和 value；state.increment 使用 path 和数值 delta。path 的每一段只能由英文字母、数字、下划线构成，不能用中文键。flags 是对象，例如 state.set 写 flags.deposit_pending，不可直接 append flags。中文事实写在 value 内。',
    'actor.move 使用 actorId、location；actor.status 使用 actorId、status；actor.knowledge.add 使用 actorId、fact；actor.relationship.adjust 使用 actorId、targetId、数值 delta（-100 到 100），不得用文字关系替代 delta。',
    'quest.update 使用 questId、status、progress；clock.advance 使用正整数 minutes。当前时钟已结算常规耗时，不要重复推进，更不能把约定日期、对白或回忆推进为当前时间。',
    '承诺使用 commitment.update：commitmentId、status（proposed待协商/committed已承诺/executed已执行/rejected已拒绝）、title（原文中可引用的简短事项名）、terms（原文条件）、counterparty（NPC名称或ID）、evidence:{source:"user"或"assistant",quote:"本轮逐字原文"}。先记录 proposed；只有玩家本轮明确同意该事项才可 committed，完成履行后才可 executed。不能同时把新提议写成已承诺，不能修改旧提议条款；改价另建提议。NPC对白不能证明玩家承诺。',
    '已有物品使用下方清单中的 itemId。移动使用 item.move：itemId、quantity、actor（实际行动者）、holder（新持有人名称，放在桌面等无持有人时为空字符串）、location（原文中确切位置，随身用“随身”）、evidence。container可注明物品仍在其中的容器，整匣移到桌面不等于丹药已经出匣。该动作只改变持有人和位置，数量自动拆分，总量及所有者不变；归还/取回沿用原itemId，不得register重复物品。',
    '只有明确赠送才使用 item.transfer，字段同move并增加owner（新所有者）；寄存、借用、代管一律不能改变owner。新增物品使用item.register：itemId、name、quantity、unit、evidence，须有玩家本轮明确携带/获得原文，不能凭模型臆造。',
    '证据必须逐字引用本轮玩家输入或正文，包含物品全名、数量与明确动作；对白中的计划/假设/转述不是实际移动。不要在正文代替玩家移动物品或接受条件。持有记录启用后禁止state.*覆盖protagonist.inventory，禁止绕过协议写itemLedger/commitments；这些记录与背包、资源账自动同步。对已纳入账本的物品不要再写自由格式resources/flags副本。',
    renderGroundedLedger(memory),
    `可用角色 ID：${JSON.stringify((memory?.simulation?.actors || []).map(actor => ({ id: actor.id, name: actor.name })))}。只能引用已有 ID。`,
    speaker ? `当前指定发言角色：${speaker}。该角色只能依据其已知信息行动。` : '',
    '格式示例：',
    '```lra-actions',
    JSON.stringify({
      spec: ACTION_PROTOCOL_SPEC,
      baseRevision: revision,
      actorId: speaker || 'narrator',
      summary: '本回合稳定变化',
      actions: [
        { type: 'item.register', itemId: 'old-key', name: '旧铜钥匙', quantity: 1, evidence: { source: 'user', quote: '我拾起旧铜钥匙' }, reason: '玩家明确拾取' }
      ]
    }),
    '```'
  ].filter(Boolean).join('\n');
}

function normalizeAction(input, index) {
  if (!isPlainObject(input)) throw new ActionProtocolError('ACTION_INVALID', String(index));
  const type = String(input.type || '').trim();
  if (!ACTION_TYPES.has(type)) throw new ActionProtocolError('ACTION_TYPE_UNSUPPORTED', type || String(index));

  const base = {
    id: normalizeId(input.id, `action-${index + 1}`),
    type,
    visibility: normalizeVisibility(input.visibility),
    reason: normalizeText(input.reason, 300),
    conditions: normalizeConditions(input.conditions)
  };

  if (type === 'commitment.update' || type.startsWith('item.')) {
    const evidence = input.evidence || {};
    if (!['user', 'assistant'].includes(evidence.source)) throw new ActionProtocolError('LEDGER_EVIDENCE_SOURCE_INVALID');
    const grounded = { ...base, evidence: { source: evidence.source, quote: requiredText(evidence.quote, 'LEDGER_EVIDENCE_REQUIRED', 1000) } };
    if (type === 'commitment.update') {
      if (!['proposed', 'committed', 'executed', 'rejected'].includes(input.status)) throw new ActionProtocolError('LEDGER_STATUS_INVALID');
      return { ...grounded, commitmentId: requiredId(input.commitmentId), status: input.status,
        title: normalizeText(input.title, 80), terms: normalizeText(input.terms, 600), counterparty: normalizeOptionalId(input.counterparty) };
    }
    const quantity = Number(input.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000000) throw new ActionProtocolError('LEDGER_QUANTITY_INVALID');
    return { ...grounded, itemId: requiredId(input.itemId), quantity,
      name: normalizeText(input.name, 80), unit: normalizeText(input.unit, 8), actor: normalizeOptionalId(input.actor),
      owner: normalizeOptionalId(input.owner), holder: normalizeOptionalId(input.holder), location: normalizeText(input.location, 160), container: normalizeText(input.container, 40) };
  }

  if (type.startsWith('state.')) {
    base.path = normalizePath(input.path);
    if (type === 'state.increment') {
      const delta = Number(input.delta ?? input.value);
      if (!Number.isFinite(delta) || Math.abs(delta) > 1_000_000) {
        throw new ActionProtocolError('ACTION_DELTA_INVALID', base.path);
      }
      base.delta = delta;
    } else {
      base.value = cloneSerializable(input.value);
    }
    return base;
  }

  if (type === 'actor.move') {
    return { ...base, actorId: requiredId(input.actorId || input.actor), location: requiredText(input.location, 'ACTION_LOCATION_REQUIRED', 160) };
  }
  if (type === 'actor.status') {
    return { ...base, actorId: requiredId(input.actorId || input.actor), status: requiredText(input.status, 'ACTION_STATUS_REQUIRED', 240) };
  }
  if (type === 'actor.knowledge.add') {
    return { ...base, actorId: requiredId(input.actorId || input.actor), fact: requiredText(input.fact || input.value, 'ACTION_FACT_REQUIRED', 500) };
  }
  if (type === 'actor.relationship.adjust') {
    const delta = Number(input.delta);
    if (!Number.isFinite(delta) || delta < -100 || delta > 100) {
      throw new ActionProtocolError('ACTION_RELATIONSHIP_DELTA_INVALID');
    }
    return {
      ...base,
      actorId: requiredId(input.actorId || input.actor),
      targetId: requiredId(input.targetId || input.target),
      delta
    };
  }
  if (type === 'quest.update') {
    const progress = input.progress === undefined ? null : Number(input.progress);
    if (progress !== null && (!Number.isFinite(progress) || progress < 0 || progress > 100)) {
      throw new ActionProtocolError('ACTION_QUEST_PROGRESS_INVALID');
    }
    return {
      ...base,
      questId: requiredId(input.questId || input.quest),
      title: normalizeText(input.title, 160),
      status: normalizeQuestStatus(input.status),
      progress,
      note: normalizeText(input.note, 500)
    };
  }

  const minutes = Number(input.minutes ?? input.value);
  if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 10080) {
    throw new ActionProtocolError('ACTION_CLOCK_MINUTES_INVALID');
  }
  return { ...base, minutes };
}

function normalizeConditions(input) {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input) || input.length > 5) throw new ActionProtocolError('ACTION_CONDITIONS_INVALID');
  return input.map((condition) => {
    if (!isPlainObject(condition)) throw new ActionProtocolError('ACTION_CONDITION_INVALID');
    const operator = String(condition.operator || condition.op || 'eq').trim().toLowerCase();
    if (!CONDITION_OPERATORS.has(operator)) throw new ActionProtocolError('ACTION_CONDITION_OPERATOR_INVALID', operator);
    return {
      path: normalizePath(condition.path),
      operator,
      value: operator === 'exists' ? Boolean(condition.value ?? true) : cloneSerializable(condition.value)
    };
  });
}

function normalizePath(value) {
  const path = String(value || '').trim();
  const segments = path.split('.').filter(Boolean);
  if (!segments.length || segments.length > 8) throw new ActionProtocolError('ACTION_PATH_INVALID', path);
  if (segments.some((segment) => !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(segment) || ['__proto__', 'prototype', 'constructor'].includes(segment))) {
    throw new ActionProtocolError('ACTION_PATH_INVALID', path);
  }
  return segments.join('.');
}

function normalizeQuestStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (!status) return '';
  if (!['inactive', 'active', 'blocked', 'completed', 'failed'].includes(status)) {
    throw new ActionProtocolError('ACTION_QUEST_STATUS_INVALID', status);
  }
  return status;
}

function normalizeVisibility(value) {
  const visibility = String(value || 'public').trim().toLowerCase();
  return VISIBILITIES.has(visibility) ? visibility : 'public';
}

function normalizeId(value, prefix) {
  const normalized = normalizeOptionalId(value);
  return normalized || `${prefix}-${crypto.randomUUID()}`;
}

function requiredId(value) {
  const id = normalizeOptionalId(value);
  if (!id) throw new ActionProtocolError('ACTION_ACTOR_ID_REQUIRED');
  return id;
}

function normalizeOptionalId(value) {
  const id = String(value || '').trim();
  if (!id) return '';
  if (!/^[A-Za-z0-9_.:\-\u4e00-\u9fff]{1,100}$/.test(id)) throw new ActionProtocolError('ACTION_ID_INVALID', id);
  return id;
}

function requiredText(value, code, limit) {
  const text = normalizeText(value, limit);
  if (!text) throw new ActionProtocolError(code);
  return text;
}

function normalizeText(value, limit) {
  return String(value || '').trim().slice(0, limit);
}

function normalizeNonNegativeInteger(value, code) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new ActionProtocolError(code);
  return number;
}

function cloneSerializable(value) {
  if (value === undefined) return null;
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new ActionProtocolError('ACTION_VALUE_NOT_SERIALIZABLE');
  }
  if (serialized === undefined || serialized.length > 16000) {
    throw new ActionProtocolError('ACTION_VALUE_INVALID');
  }
  return JSON.parse(serialized);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
