import { resolveActionPanelPresentation } from './actionPanelPresentation.js';
import { normalizeRecommendedActionPresentation } from './recommendedActionPresentation.js';

const CUSTOM_ACTION_PATTERN = /^(?:自定义(?:行动|选项)?|自由输入|其他)(?:[。.!！])?$/u;
const INSTRUCTIONAL_HINT_PATTERN = /^(?:选择|请选择|可选择|你可以|从下列|在下方)/u;
const CONTROL_FRAGMENT_PATTERN = /(?:<\/?turn[_ -]?frame|lra\.narrative|\b(?:facts|stateDelta|affordances|presentActors|timeAdvanceMinutes)\s*[:：]|[{}\[\]])/iu;
const PRIMARY_ACTION_COUNT = 3;

export function createRecommendedActionsViewNode({
  actions,
  actionPresentation = null,
  message = {},
  roleplayPanels = {},
  characterCard = {},
  session = {},
  documentObject = globalThis.document
} = {}) {
  const normalizedActions = Array.isArray(actions)
    ? actions.map((action) => String(action || '').trim()).filter(Boolean)
    : [];
  if (!normalizedActions.length) return null;

  const fallbackPresentation = resolveActionPanelPresentation(characterCard, session);
  const presentation = normalizeRecommendedActionPresentation(actionPresentation, fallbackPresentation);
  const suggestedActions = normalizedActions.filter((action) => !isCustomRecommendedAction(action));

  const wrap = documentObject.createElement('div');
  wrap.className = 'recommended-actions narrative-choice-panel';
  wrap.dataset.actionTone = presentation.tone;
  if (presentation.source) wrap.dataset.actionSource = presentation.source;

  const header = documentObject.createElement('header');
  header.className = 'recommended-actions-header';
  const heading = documentObject.createElement('strong');
  heading.className = 'recommended-actions-label';
  heading.textContent = presentation.title;
  header.append(heading);

  const situation = documentObject.createElement('p');
  situation.className = 'recommended-actions-situation';
  situation.textContent = resolveRecommendedActionSituation({ message, actionPresentation, roleplayPanels });

  const list = documentObject.createElement('div');
  list.className = 'recommended-actions-list';
  suggestedActions.slice(0, PRIMARY_ACTION_COUNT).forEach((text, index) => {
    list.append(createSuggestedActionButton(documentObject, text, index));
  });
  list.append(createCustomActionRow(documentObject, Math.min(suggestedActions.length, PRIMARY_ACTION_COUNT)));
  const moreActions = createMoreActionsNode(documentObject, suggestedActions.slice(PRIMARY_ACTION_COUNT));
  if (moreActions) list.append(moreActions);

  wrap.append(header, situation, list);
  return wrap;
}

export function resolveRecommendedActionSituation({ message = {}, actionPresentation = null, roleplayPanels = {} } = {}) {
  const explicitHint = compactText(actionPresentation?.hint, 240);
  if (isNarrativeSituation(explicitHint) && !INSTRUCTIONAL_HINT_PATTERN.test(explicitHint)) {
    return ensureSentence(explicitHint);
  }

  const sceneSummary = compactText(message?.turnFrame?.scene?.summary, 240);
  if (isNarrativeSituation(sceneSummary)) return ensureSentence(sceneSummary);

  const sceneStatus = compactText(roleplayPanels?.sceneStatus || message?.roleplayPanels?.sceneStatus, 240);
  if (isNarrativeSituation(sceneStatus)) return ensureSentence(sceneStatus);

  const decision = message?.decisionNode || message?.turnFrame?.decision || {};
  const focus = compactText(decision.focus, 180);
  const actor = compactText(decision.actor, 80);
  if (isNarrativeSituation(focus) && decision.requiresPlayerResponse === true) {
    return ensureSentence(actor ? `${actor}正在等待你的回应：${focus}` : `眼前的交互正在等待你的回应：${focus}`);
  }
  if (isNarrativeSituation(focus)) return ensureSentence(focus);

  const narrativeClosing = extractNarrativeClosing(message?.content);
  if (narrativeClosing) return ensureSentence(narrativeClosing);
  return '当前场景已经停在需要你做出行动的位置。';
}

export function isCustomRecommendedAction(value) {
  return CUSTOM_ACTION_PATTERN.test(String(value || '').replace(/\s+/gu, '').trim());
}

function createSuggestedActionButton(documentObject, text, index) {
  const strategy = resolveActionStrategy(text);
  const button = documentObject.createElement('button');
  button.type = 'button';
  button.className = 'recommendation-button';
  button.dataset.recommendedAction = text;
  button.dataset.actionStrategy = strategy;
  button.setAttribute?.('aria-label', `行动选项 ${index + 1}，${strategy}：${text}`);
  button.append(createNumber(documentObject, index), createCopy(documentObject, text, strategy));
  return button;
}

function createMoreActionsNode(documentObject, actions) {
  if (!actions.length) return null;
  const details = documentObject.createElement('details');
  details.className = 'recommendation-more-actions';
  const summary = documentObject.createElement('summary');
  summary.textContent = `更多行动 · ${actions.length}`;
  const list = documentObject.createElement('div');
  list.className = 'recommendation-more-list';
  actions.forEach((text, index) => {
    list.append(createSuggestedActionButton(documentObject, text, PRIMARY_ACTION_COUNT + 1 + index));
  });
  details.append(summary, list);
  return details;
}

function createCustomActionRow(documentObject, index) {
  const row = documentObject.createElement('div');
  row.className = 'recommendation-custom-row';
  row.dataset.customActionRow = 'true';

  const input = documentObject.createElement('input');
  input.type = 'text';
  input.className = 'recommendation-custom-input';
  input.dataset.customActionInput = 'true';
  input.placeholder = '写下你自己的回答或行动…';
  input.maxLength = 600;
  input.setAttribute?.('aria-label', '自定义回答或行动');

  const submit = documentObject.createElement('button');
  submit.type = 'button';
  submit.className = 'recommendation-custom-submit';
  submit.dataset.customActionSubmit = 'true';
  submit.textContent = '发送';
  submit.setAttribute?.('aria-label', '发送自定义行动');

  row.append(createNumber(documentObject, index), input, submit);
  return row;
}

function createNumber(documentObject, index) {
  const number = documentObject.createElement('span');
  number.className = 'recommendation-number';
  number.textContent = String(index + 1).padStart(2, '0');
  return number;
}

function createCopy(documentObject, text, strategy = '') {
  const copy = documentObject.createElement('span');
  copy.className = 'recommendation-copy';
  if (strategy) {
    const badge = documentObject.createElement('span');
    badge.className = 'recommendation-strategy';
    badge.textContent = strategy;
    copy.append(badge);
  }
  const content = documentObject.createElement('span');
  content.className = 'recommendation-text';
  content.textContent = text;
  copy.append(content);
  return copy;
}

export function resolveActionStrategy(value) {
  const text = String(value || '').replace(/^\s*[【\[][^】\]]+[】\]]\s*/u, '').trim();
  if (/(?:回答|回应|说明|承认|表明|坦白|告诉|开口|答应|点头)/u.test(text)) return '回应';
  if (/(?:询问|反问|追问|试探|打听|套话|确认|求证)/u.test(text)) return '试探';
  if (/(?:观察|查看|检查|辨认|感知|倾听|等待|留意|分析)/u.test(text)) return '观察';
  if (/(?:沉默|隐瞒|掩饰|躲|藏|退|离开|避开|绕开|装作|假装)/u.test(text)) return '回避';
  if (/(?:攻击|出手|拔剑|反击|威胁|阻拦|强行|正面对抗|迎战)/u.test(text)) return '对抗';
  if (/(?:帮助|协助|配合|交付|递给|接受|同行|跟随)/u.test(text)) return '合作';
  if (/(?:前往|走向|进入|推门|起身|靠近|返回|追上|移动)/u.test(text)) return '行动';
  return '行动';
}

function extractNarrativeClosing(value) {
  const source = String(value || '')
    .replace(/<turn[_ -]?frame\b[^>]*>[\s\S]*?<\/turn[_ -]?frame\s*>/giu, ' ')
    .split(/\n\s*---\s*\n/u)[0]
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!source) return '';
  const sentences = source.match(/[^。！？!?]{4,100}[。！？!?]?/gu) || [];
  return compactText(sentences.at(-1), 90);
}

function isNarrativeSituation(value) {
  const text = compactText(value, 240);
  if (!text || text.length < 6 || text.length > 120 || CONTROL_FRAGMENT_PATTERN.test(text)) return false;
  return /[\p{L}\p{N}]/u.test(text) && !/^[,，;；:：]/u.test(text);
}

function compactText(value, limit) {
  return String(value || '').replace(/\s+/gu, ' ').trim().slice(0, limit);
}

function ensureSentence(value) {
  const text = compactText(value, 240).replace(/[；;：:]$/u, '');
  return text && !/[。！？!?]$/u.test(text) ? `${text}。` : text;
}
