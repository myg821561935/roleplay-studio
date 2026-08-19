import test from 'node:test';
import assert from 'node:assert/strict';

import {
  renderNarrativeMarkdown,
  resolveNarrativeSpeakerTone,
  splitNarrativeBlocks
} from '../public/modules/narrativeText.js';

test('splits narration, mixed speech, and dialogue-dominant paragraphs', () => {
  const blocks = splitNarrativeBlocks([
    '雨水沿着屋檐落下，长街已经空了。',
    '沈观澜停在门边，低声说：“别回头，继续往前走。”',
    '“我会在天亮以前回来。”'
  ].join('\n\n'));

  assert.deepEqual(blocks.map((block) => block.kind), ['narration', 'mixed', 'dialogue']);
  assert.equal(blocks[1].segments.filter((segment) => segment.kind === 'dialogue').length, 1);
});

test('does not mistake short quoted labels for character dialogue', () => {
  const [block] = splitNarrativeBlocks('石门上刻着一个“封”字，边缘已经生满青苔。');

  assert.equal(block.kind, 'narration');
  assert.equal(block.segments.some((segment) => segment.kind === 'dialogue'), false);
});

test('renders spoken text with semantic classes while preserving safe markdown', () => {
  const html = renderNarrativeMarkdown('**地伶**看向你：“不要碰它！”\n\n雾气重新合拢。');

  assert.match(html, /narrative-block--mixed/);
  assert.match(html, /<span class="narrative-dialogue">“不要碰它！”<\/span>/);
  assert.match(html, /<strong>地伶<\/strong>/);
  assert.match(html, /narrative-block--narration/);
  assert.match(html, /<p class="narrative-block narrative-block--narration">/);
});

test('renders explicit speaker prefixes as a semantic visual-novel nameplate', () => {
  const html = renderNarrativeMarkdown('地伶（低声）：“不要再往前了。”');

  assert.match(html, /<blockquote class="narrative-block narrative-block--dialogue narrative-block--named narrative-block--tone-\d">/);
  assert.match(html, /<cite class="narrative-speaker"><span>地伶<\/span><\/cite>/);
  assert.match(html, /<span class="narrative-dialogue-copy"><span class="narrative-dialogue">“不要再往前了。”<\/span><\/span>/);
  assert.doesNotMatch(html, /地伶（低声）[：:]/);
});

test('uses an imported local portrait for a named dialogue without accepting arbitrary image urls', () => {
  const assetId = 'a'.repeat(64);
  const html = renderNarrativeMarkdown('地伶：“门外有人。”', {
    portraitBySpeaker: {
      地伶: `/api/character-images/${assetId}.png`
    }
  });
  const unsafe = renderNarrativeMarkdown('地伶：“门外有人。”', {
    portraitBySpeaker: { 地伶: 'https://example.com/tracker.png' }
  });

  assert.match(html, new RegExp(`class="narrative-speaker-avatar" src="/api/character-images/${assetId}\\.png"`));
  assert.doesNotMatch(unsafe, /narrative-speaker-avatar/);
});

test('uses a stable speaker tone without inventing a speaker from narration', () => {
  assert.equal(resolveNarrativeSpeakerTone('地伶'), resolveNarrativeSpeakerTone('地伶'));
  assert.match(renderNarrativeMarkdown('“先别出声。”', { speaker: '地伶' }), /narrative-prose--tone-\d/);
  assert.doesNotMatch(renderNarrativeMarkdown('石门上刻着一个“封”字。'), /narrative-speaker/);
});

test('keeps user messages unchanged and escapes untrusted markup', () => {
  const userHtml = renderNarrativeMarkdown('我说：“继续。”', { role: 'user' });
  const assistantHtml = renderNarrativeMarkdown('<img src=x onerror=alert(1)> “停下！”');

  assert.doesNotMatch(userHtml, /narrative-dialogue/);
  assert.match(assistantHtml, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(assistantHtml, /<img/);
});

test('preserves immersive option parsing outside prose blocks', () => {
  const html = renderNarrativeMarkdown('[天机选项：雨夜]\n- 追上去\n- 留在原地');

  assert.match(html, /narrative-special-block/);
  assert.match(html, /class="immersive-option-item"/);
  assert.doesNotMatch(html, /narrative-block--narration/);
});
