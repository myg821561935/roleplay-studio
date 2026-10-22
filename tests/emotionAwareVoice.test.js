import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveVoiceSpeed, synthesizeSpeech, EMOTION_SPEED_MAP } from '../server/agent/voiceClient.js';

test('resolveVoiceSpeed maps emotions to speed multipliers correctly', () => {
  assert.equal(resolveVoiceSpeed(null, 'furious'), 1.15);
  assert.equal(resolveVoiceSpeed(null, 'tense'), 1.10);
  assert.equal(resolveVoiceSpeed(null, 'playful'), 1.05);
  assert.equal(resolveVoiceSpeed(null, 'calm'), 1.0);
  assert.equal(resolveVoiceSpeed(null, 'tender'), 0.9);
  assert.equal(resolveVoiceSpeed(null, 'sorrowful'), 0.85);
  assert.equal(resolveVoiceSpeed(null, 'unknown'), 1.0);

  // 显式传入 speed 优先
  assert.equal(resolveVoiceSpeed(1.25, 'sorrowful'), 1.25);
});

test('synthesizeSpeech passes effective speed in TTS payload', async () => {
  let capturedBody = null;
  const fakeFetch = async (url, options) => {
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8)
    };
  };

  const provider = {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    model: 'tts-1'
  };

  await synthesizeSpeech({
    provider,
    text: '你休要狂妄！',
    emotion: 'furious',
    fetchImpl: fakeFetch
  });

  assert.ok(capturedBody, 'Must send request payload');
  assert.equal(capturedBody.input, '你休要狂妄！');
  assert.equal(capturedBody.speed, 1.15, 'Speed must be 1.15 for furious emotion');
});
