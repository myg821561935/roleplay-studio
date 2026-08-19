import { resolveCharacterContentMode } from './characterContentMode.js';

const ENRICHMENT_VERSION = 2;
const MAX_FIELD_LENGTH = 800;
const MAX_EXAMPLES = 4;

const PERSONALITY_LABELS = [
  '性格', '性情', '人格', '人格核心', '性格特点', 'personality', 'traits'
];
const SCENARIO_LABELS = [
  '场景', '当前场景', '当前处境', '开局', '开局场景', '背景', '地点', 'scenario'
];
const PERSONALITY_CUES = /(?:性格|性情|脾气|为人|行事|说话|寡言|克制|谨慎|冷静|热情|骄傲|温和|多疑|果断|偏执|怯懦|善良|冷酷|幽默|沉稳)/iu;
const BEHAVIOR_CUES = /(?:必须|禁止|不得|不要|始终|只能|绝不|保持|避免|扮演|回应时|说话时|叙事时|语言风格|行为约束|不可透露|不应透露)/iu;
const WORLD_BOOK_PERSONALITY_TITLE = /(?:人物|角色|人设|性格|人格|言行|口癖|语气)/iu;
const WORLD_BOOK_SCENARIO_TITLE = /(?:开局|场景|舞台|地点|时代|背景|当前|序章|第一幕)/iu;
const WORLD_BOOK_BEHAVIOR_TITLE = /(?:规则|约束|扮演|行为|格式|文风|输出|禁忌|边界)/iu;
const METADATA_SNIPPET_PATTERN = /^(?:【\s*)?(?:作者(?:署名|说明)?|版权|转载|鸣谢|版本|更新日志|备注|素材来源|免责声明)(?:\s*】)?(?:\s*[：:].*)?$/iu;

export function enrichCharacterCard(card = {}, { worldBookEntries = [] } = {}) {
  const next = structuredClone(card || {});
  const sources = buildSources(next, worldBookEntries);
  const generatedFields = [];
  const contentMode = resolveCharacterContentMode(next, worldBookEntries);

  if (contentMode.kind !== 'scenario-container' && !hasText(next.personality)) {
    const personality = extractPersonality(sources);
    if (personality) {
      next.personality = personality;
      generatedFields.push('personality');
    }
  }

  if (contentMode.kind !== 'scenario-container' && !hasText(next.scenario)) {
    const scenario = extractScenario(sources);
    if (scenario) {
      next.scenario = scenario;
      generatedFields.push('scenario');
    }
  }

  const behaviorConstraints = extractBehaviorConstraints(sources);
  if (!hasText(next.systemPrompt) && !hasText(next.postHistoryInstructions) && behaviorConstraints.length) {
    next.postHistoryInstructions = [
      '以下约束由导入资源自动提炼，可在素材中心审阅和修改：',
      ...behaviorConstraints.map((item) => `- ${item}`)
    ].join('\n').slice(0, MAX_FIELD_LENGTH);
    generatedFields.push('postHistoryInstructions');
  }

  if (contentMode.kind !== 'scenario-container'
    && (!Array.isArray(next.exampleDialog) || !next.exampleDialog.some(hasText))) {
    const examples = extractDialogueExamples(sources, next.name);
    if (examples.length) {
      next.exampleDialog = examples;
      generatedFields.push('exampleDialog');
    }
  }

  const sourceKinds = uniqueStrings(sources.filter((item) => item.text).map((item) => item.kind));
  const existingExtensions = isPlainObject(next.extensions) ? next.extensions : {};
  const existingNamespace = isPlainObject(existingExtensions.local_roleplay_agent)
    ? existingExtensions.local_roleplay_agent
    : {};
  next.extensions = {
    ...existingExtensions,
    local_roleplay_agent: {
      ...existingNamespace,
      contentMode,
      enrichment: {
        version: ENRICHMENT_VERSION,
        generatedFields,
        sourceKinds,
        behaviorConstraints,
        reviewed: existingNamespace.enrichment?.reviewed === true
      }
    }
  };

  return {
    card: next,
    report: {
      version: ENRICHMENT_VERSION,
      contentMode,
      generatedFields,
      sourceKinds,
      behaviorConstraints
    }
  };
}

function buildSources(card, worldBookEntries) {
  const sources = [
    { kind: 'firstMessage', title: '开场白', text: cleanText(card.firstMessage) },
    ...(Array.isArray(card.alternateGreetings) ? card.alternateGreetings : []).map((text, index) => ({
      kind: 'alternateGreeting',
      title: `备选开场白 ${index + 1}`,
      text: cleanText(text)
    })),
    { kind: 'systemPrompt', title: '系统提示', text: cleanText(card.systemPrompt) },
    { kind: 'postHistoryInstructions', title: '历史后置提示', text: cleanText(card.postHistoryInstructions) },
    { kind: 'creatorNotes', title: '作者说明', text: cleanText(card.creatorNotes) }
  ];
  for (const entry of Array.isArray(worldBookEntries) ? worldBookEntries : []) {
    const title = cleanText(entry?.title).slice(0, 120);
    const text = cleanText(entry?.content);
    if (title || text) sources.push({ kind: 'worldBook', title, text });
  }
  return sources;
}

function extractPersonality(sources) {
  const labeled = collectLabeledValues(sources, PERSONALITY_LABELS);
  if (labeled.length) return joinSnippets(labeled, 3, 500);

  const worldBook = sources
    .filter((source) => source.kind === 'worldBook' && WORLD_BOOK_PERSONALITY_TITLE.test(source.title))
    .flatMap((source) => splitSentences(source.text))
    .filter((sentence) => PERSONALITY_CUES.test(sentence));
  if (worldBook.length) return joinSnippets(worldBook, 3, 500);

  const prompted = sources
    .filter((source) => ['systemPrompt', 'postHistoryInstructions', 'creatorNotes'].includes(source.kind))
    .flatMap((source) => splitSentences(source.text))
    .filter((sentence) => PERSONALITY_CUES.test(sentence));
  return joinSnippets(prompted, 3, 500);
}

function extractScenario(sources) {
  const labeled = collectLabeledValues(sources, SCENARIO_LABELS);
  if (labeled.length) return joinSnippets(labeled, 3, 600);

  const worldBook = sources
    .filter((source) => source.kind === 'worldBook' && WORLD_BOOK_SCENARIO_TITLE.test(source.title))
    .flatMap((source) => splitSentences(source.text));
  if (worldBook.length) return joinSnippets(worldBook, 3, 600);

  const greetings = sources
    .filter((source) => ['firstMessage', 'alternateGreeting'].includes(source.kind))
    .flatMap((source) => splitSentences(source.text));
  return joinSnippets(greetings, 3, 600);
}

function extractBehaviorConstraints(sources) {
  const preferred = sources
    .filter((source) => (
      ['systemPrompt', 'postHistoryInstructions'].includes(source.kind)
      || (source.kind === 'worldBook' && WORLD_BOOK_BEHAVIOR_TITLE.test(source.title))
    ))
    .flatMap((source) => splitSentences(source.text))
    .filter((sentence) => BEHAVIOR_CUES.test(sentence));
  const fallback = sources
    .filter((source) => ['creatorNotes', 'worldBook'].includes(source.kind))
    .flatMap((source) => splitSentences(source.text))
    .filter((sentence) => BEHAVIOR_CUES.test(sentence));
  return uniqueStrings([...preferred, ...fallback])
    .map((item) => item.slice(0, 220))
    .slice(0, 6);
}

function extractDialogueExamples(sources, characterName) {
  const examples = [];
  const speakerPattern = /^(?:[-*]\s*)?((?:\{\{user\}\}|\{\{char\}\}|用户|玩家|助手|角色|[^：:\n]{1,20}))\s*[：:]\s*(.+)$/u;
  for (const source of sources) {
    for (const line of source.text.split('\n').map((item) => item.trim()).filter(Boolean)) {
      const match = line.match(speakerPattern);
      if (!match) continue;
      const speaker = normalizeSpeaker(match[1], characterName);
      const content = match[2].trim();
      if (speaker && content) examples.push(`${speaker}：${content}`.slice(0, 500));
      if (examples.length >= MAX_EXAMPLES) return uniqueStrings(examples);
    }
  }

  const greeting = sources.find((source) => source.kind === 'firstMessage')?.text || '';
  if (greeting) {
    const excerpt = joinSnippets(splitSentences(greeting), 3, 420);
    if (excerpt) examples.push(`${hasText(characterName) ? characterName : '{{char}}'}：${excerpt}`);
  }
  return uniqueStrings(examples).slice(0, MAX_EXAMPLES);
}

function collectLabeledValues(sources, labels) {
  const escaped = labels.map(escapeRegExp).join('|');
  const pattern = new RegExp(`^(?:[-*#\\s]*)?(?:${escaped})\\s*[：:]\\s*(.+)$`, 'iu');
  return sources.flatMap((source) => source.text.split('\n'))
    .map((line) => line.trim().match(pattern)?.[1]?.trim() || '')
    .filter(Boolean);
}

function splitSentences(value) {
  return cleanText(value)
    .split(/(?<=[。！？!?；;])|\n+/u)
    .map((item) => item.replace(/^[-*#>\s]+/u, '').trim())
    .filter((item) => item.length >= 4 && item.length <= 500);
}

function cleanText(value) {
  return String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function joinSnippets(values, count, maxLength) {
  return uniqueStrings(values)
    .filter((item) => !METADATA_SNIPPET_PATTERN.test(item))
    .slice(0, count)
    .join('；')
    .replace(/[；;]\s*$/u, '')
    .slice(0, maxLength);
}

function normalizeSpeaker(value, characterName) {
  const speaker = String(value || '').trim();
  if (/^(?:用户|玩家|\{\{user\}\})$/iu.test(speaker)) return '{{user}}';
  if (/^(?:助手|角色|\{\{char\}\})$/iu.test(speaker)) return '{{char}}';
  if (hasText(characterName) && speaker === characterName) return '{{char}}';
  return speaker;
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean))];
}

function hasText(value) {
  return String(value || '').trim().length > 0;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
