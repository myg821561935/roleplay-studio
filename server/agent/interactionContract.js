import { normalizeRoleplayMode } from './roleplayMode.js';

export const INTERACTION_CONTRACT_SPEC = 'lra.interaction-control-contract/v1';

const ROLEPLAY_MODE_LABELS = Object.freeze({
  dialogue: '对白流',
  dm: '标准 DM 叙事流',
  protagonist: '叙事子流派',
  director: '导演 / 共创流',
  commentary: '旁白解说流'
});

const CONTINUATION_SIGNAL_PATTERN = /^(?:[（(]?\s*)?(?:请)?(?:继续(?:推进剧情|推进|生成|续写)?|续写|往下写)(?:\s*[）)]?[。.!！]?)$/u;
const PLAYER_WRITING_LABEL_PATTERN = /(?:代写主角|代写玩家|代写用户|自动主角|auto[-_ ]?player)/iu;
const TALK_OVER_LABEL_PATTERN = /抢话/iu;
const TALK_OVER_NEGATION_PATTERN = /(?:别|不|不要|禁止|避免)\s*抢话/iu;
const PLAYER_WRITING_CONTENT_PATTERNS = [
  /(?:替|代替|代表)(?:用户|玩家|<user>|主角).{0,16}(?:写|补写|决定|行动|说话|台词|对白)/iu,
  /(?:描写|生成|补全)(?:用户|玩家|<user>|主角).{0,12}(?:动作|行为|台词|对白|心理|内心)/iu,
  /(?:无需|不必)(?:等待|询问)(?:用户|玩家).{0,16}(?:行动|决定|回复)/iu
];
const PLAYER_AGENCY_LABEL_PATTERN = /(?:别抢话|不抢话|用户主导|玩家主导|控制权|player[-_ ]?agency)/iu;
const PLAYER_AGENCY_CONTENT_PATTERNS = [
  /(?:不得|禁止|不要|不可).{0,10}(?:替|代替|代表)(?:用户|玩家|<user>|主角).{0,16}(?:行动|决定|说话|台词|对白|内心)/iu,
  /(?:用户|玩家|<user>).{0,10}(?:控制|保留).{0,12}(?:行动|决定|台词|控制权)/iu
];
const DIALOGUE_DENSITY_PATTERN = /(?:对话增多|增加对白|增加对话|更多对白|多写对白|对白比例|dialogue[-_ ]?(?:dense|more|increase))/iu;
const WORLD_BOOK_CHARACTER_TITLE_PATTERN = /^(.{1,50}?)[_·\s-]+(?:基础信息|二次解释|性格调色盘|人物档案|角色档案|人物设定|角色设定)(?:[_·\s-]|$)/u;

export function isContinuationSignal(value) {
  const text = String(value || '').trim();
  return Boolean(text && CONTINUATION_SIGNAL_PATTERN.test(text));
}

export function isMeaningfulUserMessage(message = {}) {
  if (String(message?.role || '').toLowerCase() !== 'user') return false;
  if (message?.excluded === true || message?.hiddenFromChat === true) return false;
  const content = String(message?.content || '').trim();
  return Boolean(content && !isContinuationSignal(content));
}

export function findLatestMeaningfulUserMessage(messages = []) {
  const source = Array.isArray(messages) ? messages : [];
  for (let index = source.length - 1; index >= 0; index -= 1) {
    if (isMeaningfulUserMessage(source[index])) return source[index];
  }
  return null;
}

export function analyzePromptInteractionSemantics(promptModules = []) {
  const sources = {
    playerWriting: [],
    playerAgency: [],
    dialogueDensity: []
  };
  for (const module of Array.isArray(promptModules) ? promptModules : []) {
    if (!module || module.enabled === false) continue;
    const label = `${module.id || ''} ${module.title || ''}`;
    const content = String(module.content || '');
    const source = {
      id: String(module.id || ''),
      title: String(module.title || module.id || '未命名互动模块')
    };
    const requestsTalkOver = TALK_OVER_LABEL_PATTERN.test(label)
      && !TALK_OVER_NEGATION_PATTERN.test(label);
    const requestsPlayerWritingInContent = hasPositivePlayerWritingContent(content);
    if (PLAYER_WRITING_LABEL_PATTERN.test(label)
      || requestsTalkOver
      || requestsPlayerWritingInContent) {
      sources.playerWriting.push(source);
    }
    if (PLAYER_AGENCY_LABEL_PATTERN.test(label)
      || PLAYER_AGENCY_CONTENT_PATTERNS.some((pattern) => pattern.test(content))) {
      sources.playerAgency.push(source);
    }
    if (DIALOGUE_DENSITY_PATTERN.test(`${label}\n${content}`)) {
      sources.dialogueDensity.push(source);
    }
  }

  Object.values(sources).forEach(dedupeSources);
  return {
    spec: INTERACTION_CONTRACT_SPEC,
    requestsPlayerWriting: sources.playerWriting.length > 0,
    protectsPlayerAgency: sources.playerAgency.length > 0,
    requestsMoreDialogue: sources.dialogueDensity.length > 0,
    hasInternalControlConflict: sources.playerWriting.length > 0 && sources.playerAgency.length > 0,
    sources
  };
}

export function buildInteractionConflictReport({ roleplayMode = 'dm', promptModules = [] } = {}) {
  const mode = normalizeRoleplayMode(roleplayMode);
  const semantics = analyzePromptInteractionSemantics(promptModules);
  const conflicts = [];
  if (semantics.requestsPlayerWriting && mode !== 'director') {
    conflicts.push({
      type: 'preset-player-writing-conflict',
      severity: 'warning',
      message: `预设要求代写玩家动作或对白，但当前${ROLEPLAY_MODE_LABELS[mode]}保留玩家控制权；运行时会忽略抢话条款。`,
      moduleIds: semantics.sources.playerWriting.map((item) => item.id).filter(Boolean),
      titles: semantics.sources.playerWriting.map((item) => item.title)
    });
  }
  if (semantics.protectsPlayerAgency && mode === 'director') {
    conflicts.push({
      type: 'preset-coauthoring-restriction',
      severity: 'notice',
      message: '预设要求“别抢话”，会收窄导演 / 共创流的代写权限；运行时以更严格的玩家控制权为准。',
      moduleIds: semantics.sources.playerAgency.map((item) => item.id).filter(Boolean),
      titles: semantics.sources.playerAgency.map((item) => item.title)
    });
  }
  if (semantics.hasInternalControlConflict) {
    conflicts.push({
      type: 'preset-internal-control-conflict',
      severity: 'warning',
      message: '所选预设同时包含“抢话”和“别抢话”语义；运行时会按当前模式统一裁决，不让两套控制权规则同时生效。',
      moduleIds: [
        ...semantics.sources.playerWriting,
        ...semantics.sources.playerAgency
      ].map((item) => item.id).filter(Boolean),
      titles: [
        ...semantics.sources.playerWriting,
        ...semantics.sources.playerAgency
      ].map((item) => item.title)
    });
  }
  return {
    spec: INTERACTION_CONTRACT_SPEC,
    roleplayMode: mode,
    roleplayModeLabel: ROLEPLAY_MODE_LABELS[mode],
    semantics,
    conflicts,
    hasConflict: conflicts.some((item) => item.severity === 'warning')
  };
}

export function buildInteractionControlPrompt({
  roleplayMode = 'dm',
  generationType = 'normal',
  promptModules = [],
  messages = []
} = {}) {
  const report = buildInteractionConflictReport({ roleplayMode, promptModules });
  const continuation = generationType === 'continue';
  const latestUser = continuation ? findLatestMeaningfulUserMessage(messages) : null;
  const lines = [
    `# 互动节奏与控制权契约 v1（${report.roleplayModeLabel}）`,
    '本契约是本轮控制权的最终裁决层。预设只可调整文风、对白密度与节奏，不能越权改写玩家控制权。'
  ];

  if (report.roleplayMode === 'director') {
    lines.push('共创权限：可以补写与玩家既有意图一致、可立即撤回的低风险动作和短对白；承诺、亲密边界、阵营、资源重押及不可逆后果必须交还玩家决定。');
  } else {
    lines.push('玩家控制权：不得替玩家新增动作、对白、内心、立场或决定；只能结算玩家已经明确表达的行动。');
  }

  if (continuation) {
    lines.push('当前“继续推进 / 继续生成”只是界面续推信号，不是新的玩家发言，不得覆盖或稀释最近一条真实玩家输入。');
    if (latestUser) {
      lines.push(`最近真实玩家输入：${compactText(latestUser.content, 360)}`);
    } else {
      lines.push('没有可用的真实玩家输入时，只能延续已发生的客观反馈，不得替玩家制造新意图。');
    }
    if (report.roleplayMode === 'dm') {
      lines.push('本轮只推进一个世界反馈节拍：结算最近已明确行动，展示一次直接可观察的环境 / NPC / 事件反馈，然后停止。不得再切场、快进或替玩家开启第二个行动。');
      lines.push('“继续”不授权主角移动、进入新路线、触碰物件、开门、攻击、回答、作出内心决定或接受 NPC 提议；这些行为只有最近真实玩家输入已经明确表达时才能结算。世界可以变化，NPC 可以行动，但主角必须停在原有控制边界内。');
      lines.push('结尾必须在沉浸式正文中留下明确可回应点，例如 NPC 的问题、等待中的动作或尚未决定的局面，把话语权交还玩家；不要输出“轮到你”等元提示。');
    }
  }

  if (report.semantics.requestsPlayerWriting) {
    lines.push(`预设语义已保留：检测到“抢话 / 代写玩家”要求${report.roleplayMode === 'director' ? '，仅在上述低风险共创边界内生效' : '，因当前模式冲突而不执行代写部分'}。`);
  }
  if (report.semantics.protectsPlayerAgency) {
    lines.push('预设语义已保留：检测到“别抢话 / 玩家主导”要求，采用更严格的玩家控制权边界。');
  }
  if (report.semantics.requestsMoreDialogue) {
    lines.push('预设语义已保留：在不夺取玩家控制权的前提下，提高 NPC 有效对白和来回互动的占比；对白增多不等于替玩家说话。');
  }
  return { prompt: lines.join('\n'), report };
}

export function buildCompactCastIndex({
  characterCard,
  protagonist,
  groupMembers = [],
  worldBook = [],
  contentMode = { kind: 'character' },
  maxCharacters = 16
} = {}) {
  const entries = [];
  appendCastEntry(entries, protagonist?.name, protagonist?.role || '当前主角', 'world-state');
  if (contentMode?.kind !== 'scenario-container' && characterCard?.enabled !== false) {
    appendCastEntry(entries, characterCard?.name, characterCard?.role || '主角色卡', 'character-card');
  }
  for (const member of Array.isArray(groupMembers) ? groupMembers : []) {
    if (!member || member.enabled === false) continue;
    appendCastEntry(entries, member.name, member.role || '群聊角色', 'group-member');
  }
  for (const entry of Array.isArray(worldBook) ? worldBook : []) {
    if (!entry || entry.enabled === false) continue;
    const title = String(entry.title || entry.name || '').trim();
    const name = String(title.match(WORLD_BOOK_CHARACTER_TITLE_PATTERN)?.[1] || '').trim();
    if (!name) continue;
    appendCastEntry(entries, name, extractIdentity(entry.content) || '世界书人物', 'worldbook');
  }

  const limit = Math.max(2, Math.min(32, Math.floor(Number(maxCharacters) || 16)));
  if (entries.length < 2 && contentMode?.kind !== 'scenario-container') {
    return { prompt: '', entries, omittedCount: 0 };
  }
  const selected = entries.slice(0, limit);
  const omittedCount = Math.max(0, entries.length - selected.length);
  const lines = [
    '# 多角色压缩索引',
    ...selected.map((entry) => `- ${entry.name}：${entry.identity}`),
    omittedCount ? `- 另有 ${omittedCount} 名人物未列出，需按世界书触发。` : '',
    '此处只声明人物存在与最小身份，不等于人物已经登场或玩家已经认识。详细外貌、性格、关系、秘密和语言风格仍必须按姓名、别名、关系或场景关键词触发对应世界书条目；未触发时不得补造。'
  ].filter(Boolean);
  return { prompt: lines.join('\n'), entries: selected, omittedCount };
}

function dedupeSources(items) {
  const seen = new Set();
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const key = `${items[index].id}\u0000${items[index].title}`;
    if (seen.has(key)) items.splice(index, 1);
    else seen.add(key);
  }
}

function hasPositivePlayerWritingContent(value) {
  return String(value || '')
    .split(/[。！？!?；;\n]+/u)
    .map((part) => part.trim())
    .filter(Boolean)
    .some((part) => (
      !PLAYER_AGENCY_CONTENT_PATTERNS.some((pattern) => pattern.test(part))
      && PLAYER_WRITING_CONTENT_PATTERNS.some((pattern) => pattern.test(part))
    ));
}

function appendCastEntry(entries, rawName, rawIdentity, source) {
  const name = compactText(rawName, 50);
  if (!name || entries.some((entry) => entry.name === name)) return;
  entries.push({ name, identity: compactText(rawIdentity, 72) || '身份待触发', source });
}

function extractIdentity(value) {
  const text = String(value || '');
  const match = text.match(/(?:身份|职业|定位|阵营|种族|境界)[：:]\s*([^\n；;]{1,72})/u);
  return String(match?.[1] || '').trim();
}

function compactText(value, maxLength) {
  const text = String(value || '').replace(/\s+/gu, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}
