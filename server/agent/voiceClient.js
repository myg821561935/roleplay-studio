/**
 * 语音合成 (TTS) 与语音识别 (STT) 客户端
 * 调用 OpenAI Compatible /v1/audio/speech 与 /v1/audio/transcriptions 接口
 */

const RESERVED_CUSTOM_HEADERS = new Set(['authorization', 'content-type']);

function filterHeaders(headers = {}) {
  if (!headers || typeof headers !== 'object') return {};
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !RESERVED_CUSTOM_HEADERS.has(name.toLowerCase()))
  );
}

function resolveProvider(provider) {
  if (!provider || typeof provider !== 'object') {
    throw new Error('voice provider must be an object');
  }
  const baseUrl = String(provider.baseUrl || '').replace(/\/+$/, '');
  if (!baseUrl) throw new Error('Provider baseUrl is required for voice');
  const apiKey = String(provider.apiKey || '').trim();
  if (!apiKey) throw new Error('Provider apiKey is required for voice');
  return { baseUrl, apiKey };
}

export const EMOTION_SPEED_MAP = Object.freeze({
  furious: 1.15,
  tense: 1.10,
  playful: 1.05,
  calm: 1.0,
  tender: 0.9,
  sorrowful: 0.85
});

export function resolveVoiceSpeed(speed, emotion) {
  if (Number.isFinite(Number(speed)) && Number(speed) > 0) {
    return Math.max(0.5, Math.min(2.0, Number(speed)));
  }
  const normEmotion = String(emotion || '').toLowerCase().trim();
  return EMOTION_SPEED_MAP[normEmotion] || 1.0;
}

/**
 * 文本转语音 (TTS)
 * @param {{provider: any, text: string, voice?: string, format?: string, emotion?: string, speed?: number, fetchImpl?: Function}} args
 * @returns {Promise<{audio: ArrayBuffer, format: string, raw: any}>}
 */
export async function synthesizeSpeech({ provider, text, voice = 'alloy', format = 'mp3', emotion = '', speed = null, fetchImpl = fetch }) {
  const { baseUrl, apiKey } = resolveProvider(provider);
  const model = String(provider.ttsModel || provider.model || '').trim();
  if (!model) throw new Error('Provider model (or ttsModel) is required for TTS');

  const trimmedText = String(text || '').trim();
  if (!trimmedText) throw new Error('TTS text is required');
  const truncated = trimmedText.slice(0, 4000);

  const effectiveSpeed = resolveVoiceSpeed(speed, emotion);

  const url = `${baseUrl}/audio/speech`;
  const body = JSON.stringify({
    model,
    input: truncated,
    voice: String(voice || 'alloy').slice(0, 40),
    response_format: String(format || 'mp3').slice(0, 10),
    speed: effectiveSpeed
  });

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
      ...filterHeaders(provider.headers)
    },
    body
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    let errPayload;
    try { errPayload = JSON.parse(errText); } catch {}
    const message = errPayload ? JSON.stringify(errPayload).slice(0, 240) : errText.slice(0, 240);
    throw new Error(`TTS provider error ${response.status}: ${message}`);
  }

  const audio = await response.arrayBuffer();
  return { audio, format: String(format || 'mp3'), raw: { ok: true } };
}

/**
 * 语音转文本 (STT)
 * @param {{provider: any, audio: Blob|Buffer|ArrayBuffer, filename?: string, format?: string, language?: string, fetchImpl?: Function}} args
 * @returns {Promise<{text: string, raw: any}>}
 */
export async function transcribeSpeech({ provider, audio, filename = 'audio.wav', format = 'wav', language = '', fetchImpl = fetch }) {
  const { baseUrl, apiKey } = resolveProvider(provider);
  const model = String(provider.sttModel || provider.model || '').trim();
  if (!model) throw new Error('Provider model (or sttModel) is required for STT');

  if (!audio) throw new Error('STT audio is required');

  const url = `${baseUrl}/audio/transcriptions`;

  const formData = new FormData();
  formData.append('model', model);
  if (language) formData.append('language', String(language).slice(0, 10));
  if (filename) formData.append('filename', String(filename).slice(0, 100));

  let blob;
  if (audio instanceof Blob) {
    blob = audio;
  } else if (audio instanceof ArrayBuffer || ArrayBuffer.isView(audio)) {
    const type = format === 'mp3' ? 'audio/mpeg' : (format === 'webm' ? 'audio/webm' : 'audio/wav');
    blob = new Blob([audio], { type });
  } else {
    throw new Error('Unsupported audio input type for STT');
  }
  formData.append('file', blob, String(filename || `audio.${format || 'wav'}`));

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      ...filterHeaders(provider.headers)
    },
    body: formData
  });

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`STT provider returned non-JSON response ${response.status}: ${text.slice(0, 160)}`);
  }

  if (!response.ok) {
    throw new Error(`STT provider error ${response.status}: ${JSON.stringify(payload).slice(0, 240)}`);
  }

  const transcript = String(payload.text || '').trim();
  if (!transcript) {
    throw new Error('STT response missing text');
  }

  return { text: transcript, raw: payload };
}
