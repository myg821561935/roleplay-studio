import { getCardAssetPreviewUrl } from './cardAssets.js';

const CHARACTER_PORTRAIT_URL_PATTERN = /^\/api\/character-images\/[a-f0-9]{64}\.png$/;

export function getCharacterPortraitUrl(characterOrPortrait, emotion = '') {
  const character = characterOrPortrait?.portrait
    ? characterOrPortrait
    : null;
  const portrait = characterOrPortrait?.portrait
    || characterOrPortrait?.characterPortrait
    || characterOrPortrait;

  // 表情立绘优先：如果角色有 expressions 映射且指定了 emotion，优先使用
  if (character?.expressions && emotion) {
    const normalizedEmotion = String(emotion).trim().toLowerCase();
    const expressionPortrait = character.expressions[normalizedEmotion];
    if (expressionPortrait) {
      const url = String(expressionPortrait.url || '').trim();
      if (CHARACTER_PORTRAIT_URL_PATTERN.test(url)) return url;
    }
  }

  const url = String(portrait?.url || '').trim();
  return CHARACTER_PORTRAIT_URL_PATTERN.test(url) ? url : '';
}

export function getEnabledSpeakerCharacters(config = {}) {
  return [
    config?.characterCard,
    ...(Array.isArray(config?.groupMembers) ? config.groupMembers : [])
  ].filter((character) => (
    character
    && character.enabled !== false
    && String(character.name || '').trim()
  ));
}

export function resolveSpeakerCharacter(config = {}, speaker = '') {
  const normalized = normalizeSpeakerName(speaker);
  if (!normalized) return null;
  return getEnabledSpeakerCharacters(config).find((character) => (
    normalizeSpeakerName(character.name) === normalized
  )) || null;
}

export function buildSpeakerPortraitMap(config = {}) {
  return Object.fromEntries(getEnabledSpeakerCharacters(config)
    .map((character) => [character.name, getCharacterPortraitUrl(character)])
    .filter(([, url]) => Boolean(url)));
}

export function createCharacterPortraitImage(
  characterOrPortrait,
  className,
  fallbackName = '',
  options = {}
) {
  const { documentObject = globalThis.document, emotion = '' } = options;
  const url = getCharacterPortraitUrl(characterOrPortrait, emotion);
  if (!url || typeof documentObject?.createElement !== 'function') return null;

  const image = documentObject.createElement('img');
  image.className = className;
  image.src = url;
  image.alt = `${fallbackName || characterOrPortrait?.name || '角色'}立绘`;
  image.loading = 'lazy';
  image.decoding = 'async';
  return image;
}

export function createCharacterPresentation({ documentObject = globalThis.document } = {}) {
  return {
    getCharacterPortraitUrl,
    createCharacterPortraitImage: (characterOrPortrait, className, fallbackName = '', options = {}) => (
      createCharacterPortraitImage(
        characterOrPortrait,
        className,
        fallbackName,
        { documentObject, ...options }
      )
    )
  };
}

function normalizeSpeakerName(value) {
  return String(value || '').replace(/[\s·・]/gu, '').trim().toLowerCase();
}
