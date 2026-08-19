export const MODULE_HELP = Object.freeze({
  contentPack: {
    title: '题材内容包',
    body: '选择故事题材会预览对应舞台背景；点击“应用到会话”后，才会同步世界书、角色卡、Prompt 和规则系统。阅读模式是全局偏好，不随剧本切换。'
  },
  memory: {
    title: '记忆',
    body: '查看滚动摘要、短期记忆和世界状态。适合确认自动总结有没有抓住关键事实。'
  },
  status: {
    title: '状态',
    body: '展示当前规则系统、世界时钟、NPC 日程与事件账本。幕后视图用于创作审阅，公开视图只显示角色可见信息。'
  },
  facts: {
    title: '事实',
    body: '管理后台抽取出的动态事实。可以审阅、删改，再决定是否保留进长期上下文。'
  },
  usage: {
    title: '用量',
    body: '查看本轮和累计 token 消耗，帮助判断是否需要摘要、裁剪或切换便宜模型。'
  },
  worldbook: {
    title: '世界书',
    body: '存放地点、势力、功法、禁忌、历史和规则。条目会按关键词、正则和深度插入到上下文。'
  },
  character: {
    title: '角色卡',
    body: '编辑主角、NPC 或群聊成员。角色卡决定口吻、身份、动机、开局与创作边界。'
  },
  authoring: {
    title: '创作账本',
    body: '记录当前场景目标、必须揭示或隐藏的信息、伏笔承诺和创作决策，避免长篇推进时静默遗忘。'
  },
  sources: {
    title: '资源库',
    body: '统一管理本地角色卡、世界书与 Prompt，也可从社区来源采集素材，再在剧本工坊中组装为会话可用的自定义剧本。'
  },
  prompt: {
    title: 'Prompt',
    body: '管理系统提示、风格约束和输出格式。建议只放稳定规则，把临时要求放到作者注释。'
  },
  persona: {
    title: '人设',
    body: '配置用户/主角侧画像。它会影响叙事视角和互动关系，但不应覆盖角色卡核心设定。'
  },
  quickreplies: {
    title: '快捷',
    body: '保存常用行动指令或分支选择。适合放“继续推进”“查看状态”“快进时间”等高频操作。'
  },
  macro: {
    title: '宏',
    body: '把可复用文本片段做成变量模板，适合统一状态栏、战斗结算或章节开头。'
  },
  continue: {
    title: '继续',
    body: '让模型沿着上一轮自然推进。适合你没有新动作、只想让剧情继续流动时使用。'
  },
  rewrite: {
    title: '润色',
    body: '把输入框里的指令改写得更清楚、更像创作提示；不会直接发送。'
  },
  format: {
    title: '修复格式',
    body: '要求模型修正上一轮格式问题，尽量保持剧情不倒退。适合状态栏、选项栏乱掉时使用。'
  },
  targetSpeaker: {
    title: '指定发言',
    body: '在群聊或多角色场景中指定下一位说话者，避免模型随意切换视角。'
  },
  authorNote: {
    title: '作者注释',
    body: '临时追加本回合写作指令，例如天气、节奏、禁用桥段或需要突出某个伏笔。'
  },
  background: {
    title: '舞台背景',
    body: '切换会话舞台图，只影响沉浸感，不覆盖会话内容和题材规则。'
  },
  scrollBottom: {
    title: '回到底部',
    body: '快速回到最新回复。长文、多轮分支和状态卡较多时很有用。'
  },
  startJourney: {
    title: '封存卷轴',
    body: '将当前题材、主角、天命和世界书整理成第一轮开局稿，方便你检查后再发送。'
  },
  workModeCreative: {
    title: '创作模式',
    body: '对话与剧本推进的主战场。适合日常生成、改写、继续与作者注释，检查器侧栏仍可随时展开。'
  },
  workModeImmersive: {
    title: '沉浸模式',
    body: '全屏阅读体验，弱化工具栏，突出立绘侧栏与舞台背景。适合长段阅读和角色扮演入戏。'
  },
  workModeSettings: {
    title: '设定模式',
    body: '集中管理 Provider、世界书、角色卡、预设与舞台等全局配置；不影响当前会话正文。'
  },
  workModeDebug: {
    title: '调试与检查',
    body: '打开检查器、会话健康度、用量统计与记忆视图，用于排查上下文漂移和规则冲突。'
  },
  wbFieldTitle: {
    title: '标题',
    body: '条目在编辑器中显示的名称，仅用于人工识别，不会进入 AI 上下文。'
  },
  wbFieldType: {
    title: '类型',
    body: '条目分类，影响排序与展示，不直接参与关键词匹配。可从 17 种预设中选或自定义。'
  },
  wbFieldContent: {
    title: '内容',
    body: '命中后注入到上下文的正文。建议简洁明确，避免重复世界书其他条目已写过的事实。'
  },
  wbFieldKeywords: {
    title: '主关键词',
    body: '用户或 AI 的发言中只要出现这些词，本条目就会被激活。逗号分隔，大小写由「区分大小写」控制。'
  },
  wbFieldPriority: {
    title: '优先级',
    body: '0-100，数值越高越优先保留。当 token 预算紧张时，低优先级条目会先被裁剪。默认 50。'
  },
  wbFieldDepth: {
    title: '插入深度',
    body: '把本条目插入到倒数第 N 条消息的位置。0 表示放在最末尾，越大越靠前。默认 4。'
  },
  wbFieldRegex: {
    title: '正则触发器',
    body: '比关键词更灵活的匹配规则，使用标准正则表达式。多个正则用逗号分隔；逗号需转义。'
  },
  wbFieldSecondaryKeywords: {
    title: '次关键词',
    body: '配合「匹配模式 selective」使用：主关键词命中后，再检查是否出现次关键词，决定最终是否激活。'
  },
  wbFieldMatchMode: {
    title: '匹配模式',
    body: 'keyword：仅看主关键词；regex：仅看正则；selective：主关键词命中后再用次关键词二次过滤。'
  },
  wbFieldLogic: {
    title: '逻辑',
    body: 'any：任一关键词命中即激活；all：所有关键词都要命中；not：出现即不激活；not all：并非全部命中时激活。'
  },
  wbFieldPosition: {
    title: '位置',
    body: '注入到 prompt 的位置：角色卡之后/之前、prompt 末尾、prompt 开头。'
  },
  wbFieldInsertionOrder: {
    title: '插入顺序',
    body: '同位置多个条目的排序权重，数值小的先注入。未填时按条目顺序处理。'
  },
  wbFieldScope: {
    title: '作用域',
    body: 'prompt：注入系统 prompt；world：世界级共享；character：随角色卡携带。'
  },
  wbFieldEnabled: {
    title: '启用',
    body: '关闭后条目保留在书中但不参与匹配，适合临时屏蔽而不删除。'
  },
  wbFieldConstant: {
    title: '常驻',
    body: '开启后无论是否命中关键词，每次都会注入到上下文。常用于世界基础规则、主角身份等。'
  },
  wbFieldCaseSensitive: {
    title: '区分大小写',
    body: '关键词匹配时是否区分大小写。对英文专有名词（如 NPC 姓名）有用，中文一般无需开启。'
  },
  termHardFact: {
    title: '硬事实',
    body: '系统从对话中抽取的不可推翻的关键事实，用于一致性校验。冲突时回滚本轮记忆更新。'
  },
  termVectorMemory: {
    title: '向量记忆 RAG',
    body: '把历史消息向量化并按相似度检索注入上下文，用于在长篇对话中找回远距离细节。需要支持 embeddings 的 Provider。'
  },
  termFallbackChain: {
    title: '回退链',
    body: '主 Provider 调用失败时，按顺序尝试的其他 Provider ID。用于保证可用性，但可能改变写作风格。'
  },
  termUsageEstimated: {
    title: '本地估算',
    body: '当 Provider 没有返回 token 用量时，系统按本地分词估算。与「服务商返回」相对，仅供预算参考。'
  }
});

const HELP_TRIGGER_SELECTOR = [
  '[data-help-key]',
  '[data-tab]',
  '[data-tab-shortcut]',
  '[data-action-template]',
  '[data-scroll-bottom]'
].join(',');

export function resolveModuleHelpKey(trigger) {
  if (!trigger) return '';
  if (trigger.dataset.helpKey) return trigger.dataset.helpKey;
  if (trigger.dataset.tab) return trigger.dataset.tab;
  if (trigger.dataset.tabShortcut) return trigger.dataset.tabShortcut;
  if (trigger.dataset.scrollBottom !== undefined) return 'scrollBottom';
  if (trigger.dataset.actionTemplate) return 'format';
  return '';
}

export function createModuleHelpController({
  documentObject = globalThis.document,
  windowObject = globalThis.window,
  requestFrame,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
  autoCloseMs = 5200
} = {}) {
  let eventsBound = false;
  let moduleHintTimer = null;
  let renderVersion = 0;
  const scheduleFrame = requestFrame
    || windowObject?.requestAnimationFrame?.bind(windowObject)
    || ((callback) => callback());

  function closeModuleHint() {
    renderVersion += 1;
    if (moduleHintTimer !== null) {
      clearTimer(moduleHintTimer);
      moduleHintTimer = null;
    }
    documentObject?.querySelector?.('.module-hint-popover')?.remove();
  }

  function showModuleHint(helpKey, anchor) {
    const help = MODULE_HELP[helpKey];
    if (!help || !anchor || !documentObject?.body) return null;

    closeModuleHint();
    const version = renderVersion;
    const popover = documentObject.createElement('aside');
    popover.className = 'module-hint-popover';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-modal', 'false');
    popover.setAttribute('aria-live', 'polite');
    popover.dataset.helpKey = helpKey;

    const title = documentObject.createElement('div');
    title.className = 'module-hint-title';
    title.id = `module-hint-title-${version}`;
    title.textContent = help.title;
    popover.setAttribute('aria-labelledby', title.id);

    const body = documentObject.createElement('p');
    body.textContent = help.body;

    const close = documentObject.createElement('button');
    close.type = 'button';
    close.className = 'module-hint-close';
    close.dataset.moduleHintClose = 'true';
    close.setAttribute('aria-label', '关闭提示');
    close.textContent = '×';

    popover.append(close, title, body);
    documentObject.body.append(popover);

    const anchorRect = anchor.getBoundingClientRect();
    scheduleFrame(() => {
      if (version !== renderVersion || popover.isConnected === false) return;
      const popoverRect = popover.getBoundingClientRect();
      const gutter = 12;
      const viewportWidth = Number(windowObject?.innerWidth) || 0;
      const viewportHeight = Number(windowObject?.innerHeight) || 0;
      const maxLeft = Math.max(gutter, viewportWidth - popoverRect.width - gutter);
      let left = Math.min(Math.max(gutter, anchorRect.left), maxLeft);
      let top = anchorRect.bottom + 8;
      if (top + popoverRect.height > viewportHeight - gutter) {
        top = anchorRect.top - popoverRect.height - 8;
      }
      if (top < gutter) {
        top = gutter;
        left = Math.min(Math.max(gutter, anchorRect.right + 8), maxLeft);
      }
      popover.style.left = `${left}px`;
      popover.style.top = `${top}px`;
      popover.classList.add('visible');
    });

    moduleHintTimer = setTimer(() => {
      if (version === renderVersion) closeModuleHint();
    }, autoCloseMs);
    return popover;
  }

  function handleModuleHelpClick(event) {
    const target = event?.target;
    if (!target?.closest) return;
    if (target.closest('[data-module-hint-close]')) {
      closeModuleHint();
      return;
    }
    if (target.closest('.module-hint-popover')) return;

    // 常规导航（模式切换、Tab 标签页、下拉选框与输入框）执行纯粹的界面切换，不弹浮窗遮挡
    const isPrimaryControl = target.closest('.work-mode-button, .tab-button, select, input, textarea');
    const isGlossaryTerm = target.closest('.wb-term, [data-help-trigger]');
    if (isPrimaryControl && !isGlossaryTerm) {
      closeModuleHint();
      return;
    }

    const trigger = target.closest(HELP_TRIGGER_SELECTOR);
    const helpKey = resolveModuleHelpKey(trigger);
    if (helpKey && MODULE_HELP[helpKey]) {
      showModuleHint(helpKey, trigger);
    } else {
      closeModuleHint();
    }
  }

  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;
    documentObject?.addEventListener?.('click', handleModuleHelpClick);
  }

  return {
    bindEvents,
    closeModuleHint,
    handleModuleHelpClick,
    showModuleHint
  };
}
