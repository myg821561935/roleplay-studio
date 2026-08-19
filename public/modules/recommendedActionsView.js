import { resolveActionPanelPresentation } from './actionPanelPresentation.js';
import { normalizeRecommendedActionPresentation } from './recommendedActionPresentation.js';

const CUSTOM_ACTION_PATTERN = /^(?:自定义(?:行动|选项)?|自由输入|其他)(?:[。.!！])?$/u;
const INSTRUCTIONAL_HINT_PATTERN = /^(?:选择|请选择|可选择|你可以|从下列|在下方)/u;
const CONTROL_FRAGMENT_PATTERN = /(?:<\/?turn[_ -]?frame|lra\.narrative|\b(?:facts|stateDelta|affordances|presentActors|timeAdvanceMinutes)\s*[:：]|[{}\[\]])/iu;

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
  suggestedActions.forEach((text, index) => {
    list.append(createSuggestedActionButton(documentObject, text, index));
  });
  list.append(createCustomActionRow(documentObject, suggestedActions.length));

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
  const button = documentObject.createElement('button');
  button.type = 'button';
  button.className = 'recommendation-button';
  button.dataset.recommendedAction = text;
  button.setAttribute?.('aria-label', `行动选项 ${index + 1}：${text}`);
  button.append(createNumber(documentObject, index), createCopy(documentObject, text));
  return button;
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

function createCopy(documentObject, text) {
  const copy = documentObject.createElement('span');
  copy.className = 'recommendation-copy';
  copy.textContent = text;
  return copy;
}

function extractNarrativeClosing(value) {
  const source = String(value || '')
    .replace(/<turn[_ -]?frame\b[^>]*>[\s\S]*?<\/turn[_ -]?frame\s*>/giu, ' ')
    .split(/\n\s*---\s*\n/u)[0]
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!source) return '';
  const sentences = source.match(/[^。！？!?]{4,180}[。！？!?]?/gu) || [];
  return compactText(sentences.at(-1), 180);
}

function isNarrativeSituation(value) {
  const text = compactText(value, 240);
  if (!text || text.length < 6 || CONTROL_FRAGMENT_PATTERN.test(text)) return false;
  return /[\p{L}\p{N}]/u.test(text) && !/^[,，;；:：]/u.test(text);
}

function compactText(value, limit) {
  return String(value || '').replace(/\s+/gu, ' ').trim().slice(0, limit);
}

function ensureSentence(value) {
  const text = compactText(value, 240).replace(/[；;：:]$/u, '');
  return text && !/[。！？!?]$/u.test(text) ? `${text}。` : text;
}
