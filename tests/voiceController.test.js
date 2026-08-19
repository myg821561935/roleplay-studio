import test from 'node:test';
import assert from 'node:assert/strict';

import { createVoiceController, createVoiceDictationController, createMessagePlaybackController } from '../public/modules/voice.js';

class FakeElement {
  constructor() {
    this.listeners = new Map();
    this.files = [];
    this.value = '';
    this.disabled = false;
    this.innerHTML = '';
    this.focusCount = 0;
  }

  addEventListener(type, handler) {
    this.listeners.set(type, handler);
  }

  async emit(type) {
    await this.listeners.get(type)?.({ target: this });
  }

  focus() {
    this.focusCount += 1;
  }
}

function createEls() {
  return {
    providerStatus: new FakeElement(),
    sttAudioInput: new FakeElement(),
    sttProvider: new FakeElement(),
    sttLanguage: new FakeElement(),
    sttRecord: new FakeElement(),
    sttStopRecord: new FakeElement(),
    sttTranscribe: new FakeElement(),
    sttResult: new FakeElement(),
    sttInsertToInput: new FakeElement(),
    chatInput: new FakeElement()
  };
}

test('voice transcript insertion uses the composer input boundary', async () => {
  const els = createEls();
  const inserted = [];
  const audio = new Blob(['audio'], { type: 'audio/webm' });
  Object.defineProperty(audio, 'name', { value: 'sample.webm' });
  els.sttAudioInput.files = [audio];
  const controller = createVoiceController({
    state: { config: {} },
    els,
    setStatus: () => {},
    escapeHtmlText: String,
    humanizeApiError: String,
    insertIntoChat: (text) => inserted.push(text),
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ text: '雨夜拔剑' })
    })
  });

  controller.bindEvents();
  await els.sttAudioInput.emit('change');
  await controller.transcribe();
  controller.insertToChat();

  assert.deepEqual(inserted, ['雨夜拔剑']);
  assert.equal(els.chatInput.value, '');
  assert.equal(els.sttInsertToInput.disabled, false);
});

test('voice recording stops acquired tracks when recorder initialization fails', async () => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const recorderDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'MediaRecorder');
  let stopped = 0;
  const statuses = [];
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: async () => ({
          getTracks: () => [{ stop: () => { stopped += 1; } }]
        })
      }
    }
  });
  Object.defineProperty(globalThis, 'MediaRecorder', {
    configurable: true,
    value: class {
      constructor() {
        throw new Error('recorder unavailable');
      }
    }
  });

  try {
    const controller = createVoiceController({
      state: { config: {} },
      els: createEls(),
      setStatus: (_element, message, tone) => statuses.push({ message, tone }),
      escapeHtmlText: String,
      humanizeApiError: String
    });
    await controller.startRecording();
  } finally {
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
    else delete globalThis.navigator;
    if (recorderDescriptor) Object.defineProperty(globalThis, 'MediaRecorder', recorderDescriptor);
    else delete globalThis.MediaRecorder;
  }

  assert.equal(stopped, 1);
  assert.ok(statuses.some(({ message, tone }) => (
    message === '录音失败：recorder unavailable' && tone === 'error'
  )));
});

class FakeDictationClassList {
  constructor() {
    this.values = new Set();
  }
  add(name) { this.values.add(name); }
  remove(name) { this.values.delete(name); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) {
    if (force === undefined) {
      if (this.values.has(name)) this.values.delete(name);
      else this.values.add(name);
    } else if (force) this.values.add(name);
    else this.values.delete(name);
  }
}

class FakeDictationButton {
  constructor() {
    this.classList = new FakeDictationClassList();
    this.title = '';
    this.attributes = new Map();
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
}

// 可控的假录音器：手动触发 stop 后回调 onstop
class FakeDictationRecorder {
  constructor() {
    this.state = 'inactive';
    this.mimeType = 'audio/webm';
    this.ondataavailable = null;
    this.onstop = null;
  }
  start() { this.state = 'recording'; }
  stop() {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    this.ondataavailable?.({ data: { size: 128 } });
    this.onstop?.();
  }
}

// 假 FormData：真实 FormData.append 会校验 Blob 类型
class FakeFormData {
  append(key, value) {
    this[key] = value;
  }
}

function createDictationHarness({ sttText = '雨夜拔剑，剑光如虹', fetchError = null } = {}) {
  const button = new FakeDictationButton();
  const els = { voiceDictation: button, sessionStatus: new FakeElement() };
  const state = {};
  const inserted = [];
  const statuses = [];
  const requests = [];
  const recorder = new FakeDictationRecorder();
  const controller = createVoiceDictationController({
    els,
    state,
    setStatus: (_element, message, tone) => statuses.push({ message, tone }),
    insertIntoChat: (text) => inserted.push(text),
    fetchImpl: async (path, options) => {
      requests.push({ path, options });
      if (fetchError) {
        return { ok: false, status: 502, json: async () => ({ error: fetchError }) };
      }
      return { ok: true, json: async () => ({ text: sttText }) };
    },
    language: 'zh',
    providerId: 'openai',
    mediaDevicesImpl: {
      getUserMedia: async () => ({
        getTracks: () => [{ stop: () => {} }]
      })
    },
    mediaRecorderImpl: () => recorder,
    blobImpl: class {
      constructor(chunks, options) {
        this.chunks = chunks;
        this.type = options?.type || '';
        this.size = 128;
      }
    },
    formDataImpl: () => new FakeFormData()
  });
  return { button, controller, els, inserted, recorder, requests, state, statuses };
}

// 等待 start() 内的 getUserMedia 微任务链完成（recorder 已创建并开始录音）
async function waitForRecording(controller) {
  for (let i = 0; i < 20 && !controller.isRecording(); i += 1) {
    await Promise.resolve();
  }
  assert.equal(controller.isRecording(), true, '录音应已启动');
}

test('voice dictation records, transcribes and inserts text into the composer input', async () => {
  const harness = createDictationHarness();
  const started = harness.controller.start();
  await waitForRecording(harness.controller);
  assert.equal(harness.state.voiceDictating, true);
  assert.equal(harness.button.classList.contains('is-recording'), true);

  harness.recorder.stop();
  await started;

  assert.equal(harness.controller.isRecording(), false);
  assert.equal(harness.state.voiceDictating, false);
  assert.equal(harness.inserted.length, 1, '转写结果应插入输入框');
  assert.equal(harness.inserted[0], '雨夜拔剑，剑光如虹');
  assert.equal(harness.requests.length, 1);
  assert.equal(harness.requests[0].path, '/api/voice/stt');
  assert.equal(harness.button.classList.contains('is-recording'), false);
  assert.ok(harness.statuses.some(({ message, tone }) => (
    message === '语音已转写并插入输入框' && tone === 'ok'
  )));
});

test('voice dictation toggle stops an active recording', async () => {
  const harness = createDictationHarness();
  const started = harness.controller.start();
  await waitForRecording(harness.controller);
  assert.equal(await harness.controller.toggle(), true, 'toggle 在录音中应停止录音');
  await started;
  assert.equal(harness.inserted.length, 1);
});

test('voice dictation reports transcription failure without inserting text', async () => {
  const harness = createDictationHarness({ fetchError: 'STT provider error 502' });
  const started = harness.controller.start();
  await waitForRecording(harness.controller);
  harness.recorder.stop();
  await started;

  assert.equal(harness.inserted.length, 0);
  assert.ok(harness.statuses.some(({ message, tone }) => (
    message === '转写失败：STT provider error 502' && tone === 'error'
  )));
});

test('voice dictation degrades when getUserMedia is unavailable', async () => {
  const button = new FakeDictationButton();
  const statuses = [];
  const controller = createVoiceDictationController({
    els: { voiceDictation: button, sessionStatus: new FakeElement() },
    state: {},
    setStatus: (_element, message, tone) => statuses.push({ message, tone }),
    insertIntoChat: () => {},
    fetchImpl: async () => ({ ok: true, json: async () => ({ text: '' }) }),
    mediaDevicesImpl: null
  });
  assert.equal(await controller.start(), false);
  assert.ok(statuses.some(({ message }) => message === '当前浏览器不支持录音'));
});

test('voice dictation stops tracks when the recorder constructor throws', async () => {
  let stopped = 0;
  const statuses = [];
  const controller = createVoiceDictationController({
    els: { voiceDictation: new FakeDictationButton(), sessionStatus: new FakeElement() },
    state: {},
    setStatus: (_element, message, tone) => statuses.push({ message, tone }),
    insertIntoChat: () => {},
    fetchImpl: async () => ({ ok: true, json: async () => ({ text: '' }) }),
    mediaDevicesImpl: {
      getUserMedia: async () => ({
        getTracks: () => [{ stop: () => { stopped += 1; } }]
      })
    },
    mediaRecorderImpl: () => {
      throw new Error('recorder unavailable');
    }
  });
  assert.equal(await controller.start(), false);
  assert.equal(stopped, 1);
  assert.ok(statuses.some(({ message }) => message.includes('录音初始化失败')));
});

// ---- 消息级 TTS 朗读（messagePlayback）----

class FakePlaybackAudio {
  constructor() {
    this.src = '';
    this.paused = false;
    this.playCount = 0;
    this.pauseCount = 0;
    this.onended = null;
    this.onerror = null;
  }
  async play() {
    this.playCount += 1;
    this.paused = false;
  }
  pause() {
    this.pauseCount += 1;
    this.paused = true;
  }
}

function createPlaybackHarness({ ttsError = null } = {}) {
  const statuses = [];
  const audio = new FakePlaybackAudio();
  const requests = [];
  let revoked = [];
  const controller = createMessagePlaybackController({
    els: { sessionStatus: new FakeElement() },
    setStatus: (_element, message, tone) => statuses.push({ message, tone }),
    fetchImpl: async (path, options) => {
      requests.push({ path, body: JSON.parse(options.body) });
      if (ttsError) {
        return { ok: false, status: 502, json: async () => ({ error: ttsError }) };
      }
      return {
        ok: true,
        json: async () => ({}),
        blob: async () => ({ size: 2048 })
      };
    },
    resolveMessageSpeechText: (message) => message.speechText,
    createObjectUrl: () => 'blob:mock-audio-url',
    audioElementFactory: () => audio
  });
  return { audio, controller, requests, statuses };
}

test('message playback speaks a message and tracks the active message', async () => {
  const harness = createPlaybackHarness();
  const message = { id: 'assistant/1', content: '雨声渐急，灯下的字迹被洇开。', speechText: '雨声渐急，灯下的字迹被洇开。' };

  assert.equal(await harness.controller.speakMessage(message), true);
  assert.equal(harness.controller.isSpeaking('assistant/1'), true);
  assert.equal(harness.requests.length, 1);
  assert.equal(harness.requests[0].path, '/api/voice/tts');
  assert.equal(harness.requests[0].body.text, '雨声渐急，灯下的字迹被洇开。');
  assert.equal(harness.audio.src, 'blob:mock-audio-url');
  assert.equal(harness.audio.playCount, 1);
  assert.ok(harness.statuses.some(({ message: text, tone }) => text === '正在朗读消息' && tone === 'ok'));
});

test('message playback toggles the same message off and switches between messages', async () => {
  const harness = createPlaybackHarness();
  const first = { id: 'assistant/1', speechText: '第一段正文。' };
  const second = { id: 'assistant/2', speechText: '第二段正文。' };

  await harness.controller.speakMessage(first);
  // 同一条消息再点：停止
  assert.equal(await harness.controller.toggleMessage(first), false);
  assert.equal(harness.controller.isSpeaking('assistant/1'), false);
  assert.equal(harness.audio.pauseCount, 1, '停止时应暂停音频');

  // 播第二条：切换
  assert.equal(await harness.controller.toggleMessage(second), true);
  assert.equal(harness.controller.isSpeaking('assistant/2'), true);
  assert.equal(harness.controller.isSpeaking('assistant/1'), false);
  assert.equal(harness.requests.length, 2);
});

test('message playback reports failures and stays idle', async () => {
  const harness = createPlaybackHarness({ ttsError: 'TTS provider error 502' });
  const message = { id: 'assistant/1', speechText: '失败正文。' };

  assert.equal(await harness.controller.speakMessage(message), false);
  assert.equal(harness.controller.isSpeaking('assistant/1'), false);
  assert.equal(harness.audio.playCount, 0);
  assert.ok(harness.statuses.some(({ message: text, tone }) => (
    text === '朗读失败：TTS provider error 502' && tone === 'error'
  )));
});

test('message playback rejects empty text without a request', async () => {
  const harness = createPlaybackHarness();
  assert.equal(await harness.controller.speakMessage({ id: 'assistant/1', speechText: '   ' }), false);
  assert.equal(harness.requests.length, 0);
  assert.ok(harness.statuses.some(({ message: text }) => text === '请先选择有正文的消息再朗读'));
});

test('message playback releases audio when playback ends', async () => {
  const harness = createPlaybackHarness();
  await harness.controller.speakMessage({ id: 'assistant/1', speechText: '一段正文。' });
  assert.equal(harness.controller.isSpeaking('assistant/1'), true);

  harness.audio.onended?.();
  assert.equal(harness.controller.isSpeaking('assistant/1'), false, '播放结束后应释放');
});
