import {
  compatibilityActionLabel,
  getPackCompatibilityAudit,
  isPackStartBlocked
} from './packCompatibility.js';

export function createStoryPackCardView(pack, {
  documentObject = globalThis.document,
  getStoryPackVisualId,
  getContentPackVisualPreset,
  storyPackPresentation = {},
  getStoryStageBackground,
  createCharacterPortraitImage = () => null
} = {}) {
  const visualPackId = getStoryPackVisualId(pack);
  const visual = getContentPackVisualPreset(visualPackId);
  const presentation = storyPackPresentation[visual.packId]
    || storyPackPresentation.neutral
    || { badge: '故事', accent: '#b84435' };
  const counts = pack.counts || pack.manifest?.counts || {};
  const audit = getPackCompatibilityAudit(pack);
  const blocked = isPackStartBlocked(pack);
  const stageBackground = getStoryStageBackground(pack);

  const card = documentObject.createElement('article');
  card.className = 'story-script-card';
  card.classList.add(`compatibility-${audit.tone}`);
  card.dataset.storyPackCard = pack.id;
  card.dataset.visualPackId = visual.packId;
  const cardBackground = stageBackground?.url || visual.backgroundImage;
  card.style.setProperty('--story-card-image', `url("${cardBackground}")`);
  card.classList.toggle('has-character-stage', Boolean(stageBackground));
  card.style.setProperty('--story-card-accent', presentation.accent);

  // 1. 左侧书卷封面区 (Cover Pane)
  const coverPane = documentObject.createElement('div');
  coverPane.className = 'story-card-cover-pane';

  const coverBg = documentObject.createElement('div');
  coverBg.className = 'story-card-cover-art';
  if (cardBackground) {
    coverBg.style.backgroundImage = `url("${cardBackground}")`;
  }

  // 竖排古籍书签/名签条 (Vertical Bookmark)
  const bookmark = documentObject.createElement('div');
  bookmark.className = 'story-card-bookmark';
  const bookmarkText = documentObject.createElement('span');
  bookmarkText.className = 'bookmark-text';
  const cleanTitle = (pack.title || pack.id || '古卷').replace(/·.*$/u, '').slice(0, 5);
  bookmarkText.textContent = cleanTitle;
  const bookmarkSeal = documentObject.createElement('span');
  bookmarkSeal.className = 'bookmark-seal';
  bookmarkSeal.textContent = '印';
  bookmark.append(bookmarkText, bookmarkSeal);

  const portrait = createCharacterPortraitImage(
    pack.characterPortrait,
    'story-card-portrait',
    pack.characterName
  );

  // 专属 badge 标识
  const badge = documentObject.createElement('span');
  badge.className = 'story-card-badge';
  badge.textContent = pack.custom === true ? '我的剧本' : presentation.badge;
  if (portrait) coverPane.append(portrait);
  coverPane.append(coverBg, bookmark, badge);

  // 2. 右侧主体详情区 (Main Pane)
  const mainPane = documentObject.createElement('div');
  mainPane.className = 'story-card-main-pane';

  // 2.1 顶部标题行 (Header Row)
  const headerRow = documentObject.createElement('div');
  headerRow.className = 'story-card-header-row';

  const titleGroup = documentObject.createElement('div');
  titleGroup.className = 'story-card-title-group';
  const title = documentObject.createElement('h4');
  title.className = 'story-card-title';
  title.textContent = pack.title || pack.id;
  titleGroup.append(title);

  // 兼容徽章 (Compat Badge)
  const compatBadge = documentObject.createElement('span');
  compatBadge.className = `story-card-compatibility story-card-compat-badge is-${audit.tone}`;
  compatBadge.textContent = audit.label || '兼容状态未记录';
  compatBadge.title = audit.reason;
  titleGroup.append(compatBadge);

  // 状态徽章/选中勾选
  const statusBadge = documentObject.createElement('div');
  statusBadge.className = 'story-card-status-mark';
  if (audit.tone === 'review' || audit.tone === 'warning') {
    const warnPill = documentObject.createElement('span');
    warnPill.className = 'status-pill is-pending';
    warnPill.textContent = '待审核';
    statusBadge.append(warnPill);
  } else {
    const checkCircle = documentObject.createElement('span');
    checkCircle.className = 'status-circle-check';
    checkCircle.textContent = '✓';
    statusBadge.append(checkCircle);
  }

  headerRow.append(titleGroup, statusBadge);

  // 2.2 简介引言 (Intro Paragraph)
  const intro = documentObject.createElement('p');
  intro.className = 'story-card-intro';
  intro.textContent = pack.description || '暂无剧本简介；开局前可先查看兼容状态与素材组成。';

  // 2.3 元数据统计行 (Stats Meta Row)
  const metaRow = documentObject.createElement('div');
  metaRow.className = 'story-card-meta-row';

  const worldBookCount = Number(counts.worldBook ?? pack.worldBookCount ?? pack.stats?.worldBookCount ?? 0);
  const characterCount = Number(counts.characterPresets ?? pack.characterCount ?? pack.stats?.characterCount ?? (pack.characterCard ? 1 : 0));
  const promptModuleCount = Number(counts.promptModules ?? counts.rules ?? pack.promptModuleCount ?? 0);

  metaRow.append(
    createMetaStatItem(documentObject, '书', `${worldBookCount} 世界书`),
    createMetaStatItem(documentObject, '角', `${characterCount} 角色`),
    createMetaStatItem(documentObject, '令', `${promptModuleCount} 规则`)
  );

  // 2.4 底部操作栏 (Actions Row)
  const actionsRow = documentObject.createElement('div');
  actionsRow.className = 'story-card-actions-row';

  const startAction = documentObject.createElement('button');
  startAction.type = 'button';
  startAction.className = 'story-card-start-button';

  if (blocked && audit.action !== 'none') {
    startAction.dataset.reviewStoryPackCompatibility = pack.id;
    startAction.classList.add('is-compatibility-action');
    startAction.textContent = audit.action === 'review-scripts'
      ? '逐项审核后新建对话'
      : compatibilityActionLabel(audit);
    startAction.title = audit.action === 'review-scripts'
      ? '先查看每项脚本的源码、风险与内容哈希；审核完成后会生成可开局的兼容复审版。'
      : audit.reason;
  } else {
    startAction.dataset.startStoryPack = pack.id;
    startAction.disabled = blocked;
    startAction.textContent = blocked ? '依赖不完整，暂不可开局' : '以此剧本新开一局';
    startAction.title = blocked ? audit.reason : '以此剧本创建独立故事与第一卷';
  }

  // 齿轮设置按钮 (Gear Manage Action)
  const gearBtn = documentObject.createElement('button');
  gearBtn.type = 'button';
  gearBtn.className = 'story-card-gear-button';
  gearBtn.title = pack.custom ? '管理此自定义剧本' : '派生/配置剧本';
  gearBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`;

  if (pack.custom) {
    gearBtn.dataset.editStoryPack = pack.id;
    const deleteBtn = documentObject.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'story-card-delete-button';
    deleteBtn.dataset.deleteStoryPack = pack.id;
    deleteBtn.textContent = '删除';
    deleteBtn.title = '删除此自定义剧本';
    actionsRow.append(deleteBtn);
  } else {
    gearBtn.dataset.deriveStoryPack = pack.id;
  }

  actionsRow.append(startAction, gearBtn);

  mainPane.append(headerRow, intro, metaRow, actionsRow);

  card.append(coverPane, mainPane);
  return card;
}

function createMetaStatItem(documentObject, icon, text) {
  const item = documentObject.createElement('span');
  item.className = 'meta-stat-item';
  const iconSpan = documentObject.createElement('span');
  iconSpan.className = 'stat-icon';
  iconSpan.textContent = icon;
  const textNode = documentObject.createTextNode(` ${text}`);
  item.append(iconSpan, textNode);
  return item;
}
