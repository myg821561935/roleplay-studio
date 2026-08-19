import {
  applyMvuPatch,
  normalizeLightFrontendRuntime
} from './lightFrontendRuntime.js';

export const MVU_PATCH_SPEC = 'lra.mvu-patch/v1';

const MAX_MVU_OPERATIONS = 64;
const MAX_MVU_PAYLOAD_BYTES = 16_000;
const BLOCK_PATTERNS = [
  /```lra-mvu-patch\s*([\s\S]*?)```/gi,
  /<lra-mvu-patch>\s*([\s\S]*?)<\/lra-mvu-patch>/gi,
  /<mvu_patch>\s*([\s\S]*?)<\/mvu_patch>/gi
];

export class MvuProtocolError extends Error {
  constructor(code, detail = '') {
    super(code);
    this.name = 'MvuProtocolError';
    this.code = code;
    this.detail = detail;
  }
}

export function normalizeMvuPatchEnvelope(input) {
  const source = Array.isArray(input) ? { operations: input } : input;
  if (!isPlainObject(source)) throw new MvuProtocolError('MVU_ENVELOPE_INVALID');

  const spec = String(source.spec || source.schema || MVU_PATCH_SPEC).trim();
  if (spec !== MVU_PATCH_SPEC) throw new MvuProtocolError('MVU_SPEC_UNSUPPORTED', spec);

  const operations = Array.isArray(source.operations)
    ? source.operations
    : Array.isArray(source.patch)
      ? source.patch
      : [];
  if (!operations.length) throw new MvuProtocolError('MVU_PATCH_EMPTY');
  if (operations.length > MAX_MVU_OPERATIONS) {
    throw new MvuProtocolError('MVU_PATCH_TOO_LARGE', String(operations.length));
  }

  const expectedRevisionValue = source.expectedRevision ?? source.baseRevision;
  const expectedRevision = expectedRevisionValue === undefined || expectedRevisionValue === null
    ? null
    : normalizeRevision(expectedRevisionValue);
  const normalized = {
    spec: MVU_PATCH_SPEC,
    expectedRevision,
    summary: String(source.summary || source.reason || '').trim().slice(0, 240),
    operations: cloneSerializable(operations)
  };
  if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > MAX_MVU_PAYLOAD_BYTES) {
    throw new MvuProtocolError('MVU_PATCH_PAYLOAD_TOO_LARGE');
  }
  return normalized;
}

export function extractMvuPatchEnvelope(text) {
  const source = String(text || '');
  let rawPayload = '';
  let matchedBlock = '';
  let matchedIndex = Number.POSITIVE_INFINITY;

  for (const pattern of BLOCK_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(source);
    if (match && Number(match.index) < matchedIndex) {
      matchedBlock = match[0];
      rawPayload = match[1];
      matchedIndex = Number(match.index);
    }
  }

  if (!matchedBlock) {
    return { content: source, envelope: null, error: null, rawPayload: '' };
  }

  const content = stripMvuPatchBlocks(source).trimEnd();
  try {
    const parsed = JSON.parse(String(rawPayload || '').trim());
    return {
      content,
      envelope: normalizeMvuPatchEnvelope(parsed),
      error: null,
      rawPayload: String(rawPayload || '').trim()
    };
  } catch (error) {
    const protocolError = error instanceof MvuProtocolError
      ? error
      : new MvuProtocolError('MVU_JSON_INVALID', error.message);
    return { content, envelope: null, error: protocolError, rawPayload: String(rawPayload || '').trim() };
  }
}

export function stripMvuPatchBlocks(text) {
  let result = String(text || '');
  for (const pattern of BLOCK_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, '');
  }
  return result;
}

export function applyMvuPatchEnvelope(current, envelope, { recoverRevisionConflict = false } = {}) {
  const normalized = normalizeMvuPatchEnvelope(envelope);
  try {
    const state = applyMvuPatch(current, normalized.operations, {
      ...(normalized.expectedRevision === null ? {} : { expectedRevision: normalized.expectedRevision })
    });
    return { state, envelope: normalized };
  } catch (error) {
    // 乐观锁冲突恢复：模型输出补丁时读到的是旧基线，但补丁内容（本轮实际发生的变化）仍然有效。
    // 以当前最新状态为基线重放一次，并把信封修订号对齐到当前状态，保证补丁不因基线过期而丢失。
    const protocolError = toMvuProtocolError(error);
    const isConflict = protocolError?.code === 'MVU_REVISION_CONFLICT';
    if (!recoverRevisionConflict || !isConflict) throw protocolError;
    const recovered = applyMvuPatch(current, normalized.operations, {});
    return {
      state: recovered,
      envelope: { ...normalized, expectedRevision: recovered.revision - 1, revisionRecovered: true }
    };
  }
}

export function buildMvuPatchPrompt({ memory } = {}) {
  const state = normalizeMvuSnapshot(memory?.lightFrontendState);
  if (!state.enabled) return '';
  const values = projectStateForPrompt(state.values);
  return [
    '# 轻前端 MVU 状态协议',
    `当前 MVU 修订号：${state.revision}。`,
    '仅当本回合已经造成会影响轻前端面板的稳定变量变化时，在全部正文与世界动作协议之后追加一个且仅一个 ```lra-mvu-patch JSON 块；没有变化时不要输出。',
    '允许操作只有 set、increment、delete。路径使用点号，例如 relationships.shen.trust。不要输出 JavaScript、EJS、斜杠命令、HTML 或网络请求。',
    '变量作用域：默认写入会话级（chat）变量。跨会话持久的全局变量必须加 global. 前缀，例如 global.reputation。chat. 前缀可省略。',
    '补丁是隐藏控制数据，不得在正文、对白或状态说明中解释。只记录已经发生的变化，不预测结果，不重复写入未变化的值。',
    `当前可见状态：\n${JSON.stringify(values, null, 2)}`,
    '格式示例：',
    '```lra-mvu-patch',
    JSON.stringify({
      spec: MVU_PATCH_SPEC,
      expectedRevision: state.revision,
      summary: '本回合轻前端变量变化',
      operations: [
        { op: 'increment', path: 'relationships.shen.trust', value: 1 },
        { op: 'set', path: 'global.reputation', value: '名动江南' }
      ]
    }),
    '```'
  ].join('\n');
}

export function replayMvuHistory({ memory, messages } = {}) {
  const previous = memory && typeof memory === 'object' ? memory : {};
  const safeMessages = Array.isArray(messages) ? messages.filter((message) => !message?.excluded) : [];
  const patches = safeMessages.flatMap((message) => {
    if (message?.role !== 'assistant') return [];
    return normalizeMessagePatches(message?.mvuPatches);
  });
  const hasState = isPlainObject(previous.lightFrontendState);
  const hasBaseline = isPlainObject(previous.lightFrontendBaseline);
  if (!hasState && !hasBaseline && !patches.length) return null;

  const baseline = normalizeMvuSnapshot(
    hasBaseline ? previous.lightFrontendBaseline : previous.lightFrontendState
  );
  let state = structuredClone(baseline);
  const errors = [];
  for (const patch of patches) {
    try {
      state = applyMvuPatchEnvelope(state, patch).state;
    } catch (error) {
      errors.push({
        code: String(error.code || error.message || 'MVU_REPLAY_FAILED'),
        detail: String(error.detail || error.message || '')
      });
    }
  }
  return { baseline, state, errors };
}

export function normalizeMvuSnapshot(value) {
  return normalizeLightFrontendRuntime({ mvu: value || {} }).mvu;
}

function normalizeMessagePatches(value) {
  if (!Array.isArray(value)) return [];
  const patches = [];
  for (const item of value.slice(0, 64)) {
    try {
      patches.push(normalizeMvuPatchEnvelope(item));
    } catch {
      // Legacy or malformed metadata remains ignored during branch replay.
    }
  }
  return patches;
}

function projectStateForPrompt(values) {
  const source = isPlainObject(values) ? values : {};
  const projected = {};
  for (const [key, value] of Object.entries(source)) {
    const candidate = { ...projected, [key]: value };
    if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') > 6_000) break;
    projected[key] = value;
  }
  return projected;
}

function normalizeRevision(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new MvuProtocolError('MVU_REVISION_INVALID', String(value));
  }
  return number;
}

function cloneSerializable(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    throw new MvuProtocolError('MVU_PATCH_NOT_SERIALIZABLE', error.message);
  }
}

function toMvuProtocolError(error) {
  if (error instanceof MvuProtocolError) return error;
  return new MvuProtocolError(
    String(error?.code || error?.message || 'MVU_PATCH_INVALID'),
    String(error?.message || '')
  );
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
