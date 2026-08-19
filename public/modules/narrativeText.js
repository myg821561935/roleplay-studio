import { renderSafeMarkdown } from '../markdown.js';

const QUOTED_SPEECH_PATTERN = /“[^”\n]{1,600}”|「[^」\n]{1,600}」|『[^』\n]{1,600}』/gu;
const SPEECH_CUE_PATTERN = /(?:说|说道|问|问道|答|答道|喊|喊道|开口|低声|轻声|沉声|喃喃|回应|应声|喝道|笑道|斥道|叫道|嘀咕)/u;
const SPOKEN_PUNCTUATION_PATTERN = /[，,。！？?!…]/u;
const IMMERSIVE_OPTIONS_PATTERN = /^(?:\[|【)天机选项[：:]/u;
const EXPLICIT_SPEAKER_PATTERN = /^(?:【([^】\n]{1,24})】|([\p{L}\p{N}_·]{1,16})(?:[（(][^）)\n]{1,12}[）)])?[：:])\s*(?=[“「『])/u;
const INVALID_SPEAKER_PATTERN = /^(?:天机选项|选项\s*\d+|系统|system)$/iu;
const CHARACTER_PORTRAIT_URL_PATTERN = /^\/api\/character-images\/[a-f0-9]{64}\.png$/u;

export function splitNarrativeBlocks(value) {
  const text = String(value || '').replace(/\r\n?/g, '\n').trim();
  if (!text) return [];

  return text
    .split(/\n{2,}/u)
    .map((content) => content.trim())
    .filter(Boolean)
    .map((content) => classifyNarrativeBlock(content));
}

export function renderNarrativeMarkdown(value, {
  role = 'assistant',
  speaker = '',
  portraitBySpeaker = {}
} = {}) {
  const text = String(value || '');
  if (role !== 'assistant') return renderSafeMarkdown(text);

  const blocks = splitNarrativeBlocks(text);
  if (!blocks.length) return '';

  const toneClass = speaker ? ` narrative-prose--tone-${resolveNarrativeSpeakerTone(speaker)}` : '';
  return `<div class="narrative-prose${toneClass}">${blocks.map((block) => renderNarrativeBlock(block, {
    fallbackSpeaker: speaker,
    portraitBySpeaker
  })).join('')}</div>`;
}

function classifyNarrativeBlock(content) {
  if (IMMERSIVE_OPTIONS_PATTERN.test(content)) {
    return { content, kind: 'special', segments: [], speaker: '' };
  }

  const explicitSpeaker = extractExplicitSpeaker(content);
  const prose = explicitSpeaker ? content.slice(explicitSpeaker.length).trim() : content;
  const segments = splitDialogueSegments(prose);
  const dialogueLength = segments
    .filter((segment) => segment.kind === 'dialogue')
    .reduce((total, segment) => total + segment.text.length, 0);
  if (!dialogueLength) return { content: prose, kind: 'narration', segments, speaker: '' };

  const compact = prose.trim();
  const startsWithSpeech = /^[“「『]/u.test(compact);
  const dialogueDominant = startsWithSpeech && (
    dialogueLength / Math.max(1, compact.length) >= 0.52
    || compact.length - dialogueLength <= 28
  );
  return {
    content: prose,
    kind: dialogueDominant ? 'dialogue' : 'mixed',
    segments,
    speaker: dialogueDominant ? explicitSpeaker?.name || '' : ''
  };
}

function extractExplicitSpeaker(content) {
  const match = String(content || '').match(EXPLICIT_SPEAKER_PATTERN);
  if (!match) return null;
  const name = String(match[1] || match[2] || '').trim();
  if (!name || INVALID_SPEAKER_PATTERN.test(name)) return null;
  return { name, length: match[0].length };
}

function splitDialogueSegments(content) {
  const segments = [];
  let cursor = 0;

  for (const match of content.matchAll(QUOTED_SPEECH_PATTERN)) {
    const index = Number(match.index || 0);
    const quote = match[0];
    if (!isLikelySpokenQuote(content, index, quote)) continue;
    if (index > cursor) segments.push({ kind: 'narration', text: content.slice(cursor, index) });
    segments.push({ kind: 'dialogue', text: quote });
    cursor = index + quote.length;
  }

  if (cursor < content.length) segments.push({ kind: 'narration', text: content.slice(cursor) });
  return segments.length ? segments : [{ kind: 'narration', text: content }];
}

function isLikelySpokenQuote(content, index, quote) {
  const inner = quote.slice(1, -1).trim();
  if (inner.length < 2) return false;
  if (SPOKEN_PUNCTUATION_PATTERN.test(inner)) return true;

  const before = content.slice(Math.max(0, index - 18), index);
  const after = content.slice(index + quote.length, index + quote.length + 18);
  if (SPEECH_CUE_PATTERN.test(`${before}${after}`)) return true;

  return content.trim() === quote.trim() && inner.length >= 3;
}

function renderNarrativeBlock(block, { fallbackSpeaker = '', portraitBySpeaker = {} } = {}) {
  if (block.kind === 'special') {
    return `<div class="narrative-special-block">${renderSafeMarkdown(block.content)}</div>`;
  }

  const content = block.segments.map((segment) => {
    const html = renderSafeMarkdown(segment.text);
    return segment.kind === 'dialogue'
      ? `<span class="narrative-dialogue">${html}</span>`
      : html;
  }).join('');

  if (block.kind === 'dialogue') {
    const resolvedSpeaker = block.speaker || String(fallbackSpeaker || '').trim();
    const toneClass = resolvedSpeaker
      ? ` narrative-block--named narrative-block--tone-${resolveNarrativeSpeakerTone(resolvedSpeaker)}`
      : '';
    const portraitUrl = resolveSpeakerPortraitUrl(portraitBySpeaker, resolvedSpeaker);
    const avatar = portraitUrl
      ? `<img class="narrative-speaker-avatar" src="${escapeHtml(portraitUrl)}" alt="" loading="lazy" decoding="async" aria-hidden="true">`
      : '';
    const speaker = resolvedSpeaker
      ? `<cite class="narrative-speaker">${avatar}<span>${escapeHtml(resolvedSpeaker)}</span></cite>`
      : '';
    return `<blockquote class="narrative-block narrative-block--dialogue${toneClass}">${speaker}<span class="narrative-dialogue-copy">${content}</span></blockquote>`;
  }

  return `<p class="narrative-block narrative-block--${block.kind}">${content}</p>`;
}

function resolveSpeakerPortraitUrl(portraitBySpeaker, speaker) {
  if (!speaker || !portraitBySpeaker || typeof portraitBySpeaker !== 'object') return '';
  const direct = String(portraitBySpeaker[speaker] || '').trim();
  if (CHARACTER_PORTRAIT_URL_PATTERN.test(direct)) return direct;
  const normalized = String(speaker).replace(/[\s·・]/gu, '').toLowerCase();
  const match = Object.entries(portraitBySpeaker).find(([name, url]) => (
    String(name).replace(/[\s·・]/gu, '').toLowerCase() === normalized
    && CHARACTER_PORTRAIT_URL_PATTERN.test(String(url || '').trim())
  ));
  return String(match?.[1] || '').trim();
}

export function resolveNarrativeSpeakerTone(value) {
  let hash = 0;
  for (const character of String(value || '').trim()) {
    hash = ((hash * 31) + Number(character.codePointAt(0) || 0)) >>> 0;
  }
  return hash % 5;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
