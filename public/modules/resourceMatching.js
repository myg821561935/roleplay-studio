const GENRE_SIGNALS = [
  ['xianxia', '仙侠', /仙侠|修仙|修真|灵根|宗门|金丹|元婴|飞升|渡劫|灵气|炉鼎|双修|师尊|徒儿|剑尊|魔尊|合欢|天道|洞府|长生/],
  ['wuxia', '武侠', /武侠|江湖|门派|侠客|刀客|剑客|武林|内力|镖局|锦衣卫|六扇门|宗师|暗器/],
  ['fantasy', '玄幻', /玄幻|异界|斗气|魔法|魔兽|神荒|血脉|境界|神体|圣女|废柴|退婚|至尊|大帝|帝尊|异火/],
  ['modern', '现代', /现代|都市|公司|职场|校园|大学|高中|手机|网络|同居|总裁|豪门|天降|租客/],
  ['history', '历史', /历史|古代|朝廷|皇帝|王朝|明末|大明|崇祯|民国|权谋|后宫|皇子|文官|武将/],
  ['horror', '灵异', /灵异|恐怖|怪谈|鬼怪|邪祟|诅咒|克苏鲁|不可名状|走阴|筒子楼|纸扎|绣花鞋|八卦|封门|替死|借命/],
  ['science-fiction', '科幻', /科幻|星际|太空|机甲|赛博|人工智能|机器人|宇宙|仿生人|义体|殖民星|矩阵/],
  ['apocalypse', '末日', /末日|废土|丧尸|灾变|避难所|生存物资|异能|晶核|安全区|污染区|变异/],
  ['western-fantasy', '西幻', /西幻|教会|骑士|精灵|矮人|龙族|法师|王国|恶役|千金|圣女|教皇|魔女|神谕|领主|契约/]
];

const TOPIC_SIGNALS = [
  ['romance', '关系情感', /恋爱|爱情|情感|好感|关系|婚姻|青梅竹马|道侣|雌竞|雄竞|修罗场|病娇|白月光|朱砂痣|追夫火葬场|双向奔赴|纯爱|救赎/],
  ['mystery', '悬疑调查', /悬疑|调查|案件|线索|推理|谜团|真相|侦探|证物|密室/],
  ['politics', '势力权谋', /权谋|政治|朝局|势力|派系|战争|争霸|宫廷|结盟|背叛/],
  ['adventure', '冒险任务', /冒险|任务|委托|探索|秘境|远征|旅途|地牢|遗迹/],
  ['management', '经营管理', /经营|管理|庄园|领地|组织|公司|资源调度|宗门建设|基建/],
  ['slice-of-life', '日常生活', /日常|生活|家庭|同居|校园|职场|做饭|闲暇/],
  ['combat', '战斗成长', /战斗|修炼|升级|境界|技能|功法|武器|对决|破境|参悟/],
  ['survival', '生存压力', /生存|求生|物资|饥饿|逃亡|灾难|危机|绝境|搜刮/]
];

const GENERIC_TOKENS = new Set([
  '角色',
  '角色卡',
  '故事',
  '剧本',
  '世界',
  '世界书',
  '设定',
  '预设',
  '提示词',
  '自定义',
  '个人创作主角',
  '未命名角色'
]);

export function getResourceImportBatchKey(resource) {
  const source = resource?.source || {};
  if (source.importBatchId) return `batch:${String(source.importBatchId)}`;
  if (source.fileName && source.importedAt) {
    return `legacy:${String(source.fileName)}:${String(source.importedAt)}`;
  }
  return '';
}

export function evaluateResourceMatch(character, resource, { kind = resource?.kind || '' } = {}) {
  if (!character || character.kind !== 'character') return createUnratedMatch();
  const normalizedKind = kind === 'prompt' || kind === 'prompt-bundle' ? 'prompt' : 'worldbook';
  const characterText = buildCharacterText(character);
  const targetText = buildResourceText(resource, normalizedKind);
  const characterBatch = getResourceImportBatchKey(character);
  const targetBatch = getResourceImportBatchKey(resource);
  if (characterBatch && targetBatch && characterBatch === targetBatch) {
    return {
      score: 100,
      level: 'native',
      label: '原生匹配',
      reasons: ['与角色卡同批导入，属于角色卡原生资源'],
      conflict: false,
      native: true
    };
  }

  const reasons = [];
  let score = normalizedKind === 'prompt' ? 30 : 25;
  const characterName = normalizeTerm(character.payload?.name || character.title);
  const normalizedTargetText = normalizeSearchText(targetText);
  if (characterName.length >= 2 && normalizedTargetText.includes(characterName)) {
    score += 25;
    reasons.push(`明确关联角色“${character.payload?.name || character.title}”`);
  }

  const characterGenres = detectSignals(characterText, GENRE_SIGNALS);
  const targetGenres = detectSignals(targetText, GENRE_SIGNALS);
  const sharedGenres = intersectSignals(characterGenres, targetGenres);
  const genreConflict = characterGenres.length > 0
    && targetGenres.length > 0
    && sharedGenres.length === 0;
  if (sharedGenres.length) {
    score += 25;
    reasons.push(`题材一致：${sharedGenres.map((item) => item.label).join('、')}`);
  } else if (genreConflict) {
    score -= 25;
    reasons.push(`题材信号不一致：角色偏${characterGenres[0].label}，素材偏${targetGenres[0].label}`);
  }

  const sharedTopics = intersectSignals(
    detectSignals(characterText, TOPIC_SIGNALS),
    detectSignals(targetText, TOPIC_SIGNALS)
  );
  if (sharedTopics.length) {
    score += Math.min(15, sharedTopics.length * 5);
    reasons.push(`共同主题：${sharedTopics.slice(0, 3).map((item) => item.label).join('、')}`);
  }

  const sharedTokens = collectCharacterTokens(character)
    .filter((token) => normalizedTargetText.includes(token));
  if (sharedTokens.length) {
    score += Math.min(15, sharedTokens.length * 5);
    reasons.push(`命中角色标签：${sharedTokens.slice(0, 3).join('、')}`);
  }

  const sharedCollections = intersectStrings(character.collections, resource?.collections);
  if (sharedCollections.length) {
    score += 15;
    reasons.push(`同属素材集：${sharedCollections.slice(0, 2).join('、')}`);
  }

  const characterFile = normalizeFileName(character.source?.fileName);
  const targetFile = normalizeFileName(resource?.source?.fileName);
  if (characterFile && targetFile && characterFile === targetFile) {
    score += 20;
    reasons.push('来源文件一致');
  }

  score = Math.max(0, Math.min(95, Math.round(score)));
  const level = resolveMatchLevel(score, {
    conflict: genreConflict,
    genericPrompt: normalizedKind === 'prompt' && reasons.length === 0
  });
  if (!reasons.length) {
    reasons.push(normalizedKind === 'prompt'
      ? '通用预设，未发现角色专属约束'
      : '未发现与角色一致的来源、题材或关键词');
  }
  return {
    score,
    level,
    label: matchLevelLabel(level),
    reasons: reasons.slice(0, 3),
    conflict: genreConflict,
    native: false
  };
}

export function evaluatePromptGroupMatch(character, group = {}) {
  if (!character || character.kind !== 'character') return createUnratedMatch();
  const resources = Array.isArray(group.resources) ? group.resources : [];
  if (!resources.length) {
    return evaluateResourceMatch(character, {
      kind: 'prompt',
      title: group.title,
      payload: { content: group.title }
    }, { kind: 'prompt' });
  }
  const allMatches = resources.map((resource) => evaluateResourceMatch(character, resource, { kind: 'prompt' }));
  const native = allMatches.find((match) => match.native);
  if (native) return { ...native, recommended: false, recommendationLabel: '' };

  const promptModules = resources.filter((resource) => !resource.payload?.extensions?.sillyTavernRuntimeCompanion);
  const activeModules = promptModules.filter((resource) => resource.payload?.enabled !== false);
  const matchedModules = activeModules.length
    ? activeModules
    : promptModules.length
      ? promptModules
      : resources;
  const matches = matchedModules.map((resource) => evaluateResourceMatch(character, resource, { kind: 'prompt' }));
  const score = Math.round(matches.reduce((sum, match) => sum + match.score, 0) / matches.length);
  const conflictCount = matches.filter((match) => match.conflict).length;
  const conflict = conflictCount > matches.length / 2;
  const genericPrompt = matches.every((match) => match.level === 'general');
  const level = resolveMatchLevel(score, { conflict, genericPrompt });
  const best = [...matches].sort((left, right) => right.score - left.score)[0];
  const reasons = [`按 ${Number(group.moduleCount || matches.length)} 个启用模块综合评估`];
  if (conflictCount) reasons.push(`${conflictCount} 个模块存在题材信号冲突`);
  const supportingReason = best.reasons.find((reason) => !reason.includes('题材信号不一致'));
  if (supportingReason) reasons.push(supportingReason);
  return {
    score,
    level,
    label: matchLevelLabel(level),
    conflict,
    native: false,
    reasons: applyPromptRecommendationReasons(reasons, group),
    recommended: isPreferredClassbrainPreset(group),
    recommendationLabel: isPreferredClassbrainPreset(group) ? '类脑通用首选' : ''
  };
}

export function compareMatchedResources(left, right) {
  const nativeDiff = Number(Boolean(right?.match?.native)) - Number(Boolean(left?.match?.native));
  if (nativeDiff) return nativeDiff;
  const recommendationDiff = Number(Boolean(right?.match?.recommended)) - Number(Boolean(left?.match?.recommended));
  if (recommendationDiff) return recommendationDiff;
  const scoreDiff = Number(right?.match?.score ?? -1) - Number(left?.match?.score ?? -1);
  if (scoreDiff) return scoreDiff;
  return String(left?.title || '').localeCompare(String(right?.title || ''), 'zh-CN');
}

function isPreferredClassbrainPreset(group = {}) {
  const text = [
    group.title,
    group.sourceLabel,
    ...(Array.isArray(group.resources) ? group.resources.flatMap((resource) => [
      resource?.title,
      resource?.source?.fileName,
      resource?.payload?.extensions?.sillyTavernPreset?.presetTitle
    ]) : [])
  ].filter(Boolean).join('\n');
  return /(?:TG\s*(?:国模|break)?\s*😺?\s*V?3[._-]?1[._-]?2|TGbreak\s*😺?\s*V?3[._-]?1[._-]?2)/i.test(text);
}

function applyPromptRecommendationReasons(reasons, group) {
  const values = Array.isArray(reasons) ? [...reasons] : [];
  if (isPreferredClassbrainPreset(group)) {
    values.unshift('类脑通用首选：TG V3.1.2，适合作为无原生预设时的默认起点');
  }
  return values.slice(0, 3);
}

function createUnratedMatch() {
  return {
    score: null,
    level: 'unrated',
    label: '未评定',
    reasons: [],
    conflict: false,
    native: false
  };
}

function resolveMatchLevel(score, { conflict = false, genericPrompt = false } = {}) {
  if (conflict || score < 30) return 'low';
  if (score >= 75) return 'high';
  if (score >= 45) return 'medium';
  if (genericPrompt) return 'general';
  return 'low';
}

function matchLevelLabel(level) {
  return {
    native: '原生匹配',
    high: '高度匹配',
    medium: '中度匹配',
    general: '通用适配',
    low: '低匹配',
    unrated: '未评定'
  }[level] || '未评定';
}

function buildCharacterText(character) {
  const payload = character?.payload || {};
  return [
    character?.title,
    payload.name,
    payload.role,
    payload.description,
    payload.personality,
    payload.scenario,
    payload.systemPrompt,
    ...(Array.isArray(payload.tags) ? payload.tags : []),
    payload.extensions?.genre,
    payload.extensions?.contentPack,
    ...(Array.isArray(character?.collections) ? character.collections : [])
  ].filter(Boolean).join('\n');
}

function buildResourceText(resource, kind) {
  const payload = resource?.payload || {};
  const common = [
    resource?.title,
    payload.title,
    ...(Array.isArray(resource?.collections) ? resource.collections : []),
    resource?.source?.fileName
  ];
  if (kind === 'prompt') {
    const bundleModules = Array.isArray(payload.promptModules) ? payload.promptModules : [];
    return [
      ...common,
      payload.content,
      payload.systemPrompt,
      payload.extensions?.sillyTavernPreset?.presetTitle,
      ...bundleModules.flatMap((module) => [
        module?.title,
        module?.content,
        module?.extensions?.sillyTavernPreset?.presetTitle
      ])
    ].filter(Boolean).join('\n');
  }
  const entries = Array.isArray(payload.entries) ? payload.entries.slice(0, 80) : [];
  return [
    ...common,
    ...entries.flatMap((entry) => [
      entry?.title,
      ...(Array.isArray(entry?.keywords) ? entry.keywords : []),
      String(entry?.content || '').slice(0, 800)
    ])
  ].filter(Boolean).join('\n');
}

function collectCharacterTokens(character) {
  const payload = character?.payload || {};
  const values = [
    payload.name,
    payload.role,
    ...(Array.isArray(payload.tags) ? payload.tags : []),
    payload.extensions?.genre,
    payload.extensions?.contentPack
  ];
  return Array.from(new Set(values
    .flatMap((value) => String(value || '').split(/[\s,，、/|·;；:：()【】\[\]]+/))
    .map(normalizeTerm)
    .filter((value) => value.length >= 2 && value.length <= 24 && !GENERIC_TOKENS.has(value))));
}

function detectSignals(text, rules) {
  const source = String(text || '');
  return rules
    .filter(([, , pattern]) => pattern.test(source))
    .map(([id, label]) => ({ id, label }));
}

function intersectSignals(left, right) {
  const rightIds = new Set(right.map((item) => item.id));
  return left.filter((item) => rightIds.has(item.id));
}

function intersectStrings(left, right) {
  const rightValues = new Set((Array.isArray(right) ? right : []).map(normalizeTerm).filter(Boolean));
  return Array.from(new Set((Array.isArray(left) ? left : [])
    .map(normalizeTerm)
    .filter((value) => value && rightValues.has(value))));
}

function normalizeSearchText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, '');
}

function normalizeTerm(value) {
  return normalizeSearchText(value).replace(/[^\p{L}\p{N}_-]+/gu, '');
}

function normalizeFileName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\.[a-z0-9]{1,8}$/i, '');
}
