export function createVoiceController({
  state,
  els,
  setStatus,
  escapeHtmlText,
  humanizeApiError,
  insertIntoChat = null,
  fetchImpl = globalThis.fetch
} = {}) {
  let mediaRecorder = null;
  let recordedChunks = [];
  let recordedBlob = null;
  let lastAudioUrl = '';
  let lastText = '';

  function render() {
    const providers = Array.isArray(state.config?.providers?.providers) ? state.config.providers.providers : [];
    const options = '<option value="">（使用默认 Provider）</option>' + providers.map((provider) => {
      const id = escapeHtmlText(provider.id);
      const label = escapeHtmlText(provider.id + (provider.model ? ` (${provider.model})` : ''));
      return `<option value="${id}">${label}</option>`;
    }).join('');
    if (els.ttsProvider) els.ttsProvider.innerHTML = options;
    if (els.sttProvider) els.sttProvider.innerHTML = options;
  }

  async function speak() {
    if (!els.ttsText || !els.ttsResult) return;
    const text = els.ttsText.value.trim();
    if (!text) {
      setStatus(els.providerStatus, '请输入要朗读的文本', 'error');
      return;
    }
    if (lastAudioUrl) URL.revokeObjectURL(lastAudioUrl);
    els.ttsSpeak.disabled = true;
    els.ttsResult.innerHTML = '<div class="module-empty-note">生成中...</div>';
    try {
      const response = await fetchImpl('/api/voice/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text,
          voice: els.ttsVoice?.value || 'alloy',
          format: els.ttsFormat?.value || 'mp3',
          providerId: els.ttsProvider?.value || ''
        })
      });
      if (!response.ok) {
        let message;
        try { message = (await response.json()).error || `HTTP ${response.status}`; }
        catch { message = `HTTP ${response.status}`; }
        throw new Error(message);
      }
      const blob = await response.blob();
      lastAudioUrl = URL.createObjectURL(blob);
      const format = els.ttsFormat?.value || 'mp3';
      els.ttsResult.innerHTML = `<div class="voice-result"><audio controls autoplay src="${lastAudioUrl}"></audio><span>${format} · ${(blob.size / 1024).toFixed(1)} KB</span><a href="${lastAudioUrl}" download="tts.${format}">下载</a></div>`;
      setStatus(els.providerStatus, '语音生成成功', 'ok');
    } catch (error) {
      els.ttsResult.innerHTML = `<div class="module-inline-error">生成失败：${escapeHtmlText(humanizeApiError(error))}</div>`;
    } finally {
      els.ttsSpeak.disabled = false;
    }
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus(els.providerStatus, '当前环境不支持录音', 'error');
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordedChunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunks.push(event.data);
      };
      mediaRecorder.onstop = () => {
        recordedBlob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        stream.getTracks().forEach((track) => track.stop());
        if (els.sttTranscribe) els.sttTranscribe.disabled = false;
        if (els.sttResult) els.sttResult.innerHTML = `<div class="module-empty-note">已录制 ${(recordedBlob.size / 1024).toFixed(1)} KB，点击“转写”</div>`;
      };
      mediaRecorder.start();
      if (els.sttRecord) els.sttRecord.disabled = true;
      if (els.sttStopRecord) els.sttStopRecord.disabled = false;
      if (els.sttTranscribe) els.sttTranscribe.disabled = true;
      if (els.sttResult) els.sttResult.innerHTML = '<div class="module-empty-note">录音中...</div>';
    } catch (error) {
      stream?.getTracks?.().forEach((track) => track.stop());
      setStatus(els.providerStatus, `录音失败：${error.message}`, 'error');
    }
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    if (els.sttRecord) els.sttRecord.disabled = false;
    if (els.sttStopRecord) els.sttStopRecord.disabled = true;
  }

  function selectFile() {
    if (!els.sttAudioInput?.files?.length) return;
    recordedBlob = els.sttAudioInput.files[0];
    if (els.sttTranscribe) els.sttTranscribe.disabled = false;
    if (els.sttResult) els.sttResult.innerHTML = `<div class="module-empty-note">已选择文件 ${escapeHtmlText(recordedBlob.name)} (${(recordedBlob.size / 1024).toFixed(1)} KB)</div>`;
  }

  async function transcribe() {
    if (!els.sttResult) return;
    if (!recordedBlob) {
      els.sttResult.innerHTML = '<div class="module-inline-error">请先录音或选择音频文件</div>';
      return;
    }
    els.sttResult.innerHTML = '<div class="module-empty-note">识别中...</div>';
    if (els.sttTranscribe) els.sttTranscribe.disabled = true;
    try {
      const formData = new FormData();
      formData.append('audio', recordedBlob, recordedBlob.name || 'audio.webm');
      if (els.sttProvider?.value) formData.append('providerId', els.sttProvider.value);
      if (els.sttLanguage?.value) formData.append('language', els.sttLanguage.value);
      const response = await fetchImpl('/api/voice/stt', { method: 'POST', body: formData });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
      lastText = String(payload.text || '').trim();
      els.sttResult.innerHTML = `<details open><summary>识别结果</summary><div class="voice-transcript">${escapeHtmlText(lastText)}</div></details>`;
      if (els.sttInsertToInput) els.sttInsertToInput.disabled = !lastText;
      setStatus(els.providerStatus, '语音识别完成', 'ok');
    } catch (error) {
      els.sttResult.innerHTML = `<div class="module-inline-error">识别失败：${escapeHtmlText(error.message)}</div>`;
    } finally {
      if (els.sttTranscribe) els.sttTranscribe.disabled = false;
    }
  }

  function insertToChat() {
    if (!lastText) return;
    if (typeof insertIntoChat === 'function') {
      insertIntoChat(lastText);
    } else if (els.chatInput) {
      els.chatInput.value = els.chatInput.value ? `${els.chatInput.value}\n${lastText}` : lastText;
      els.chatInput.dispatchEvent?.(new Event('input', { bubbles: true }));
      els.chatInput.focus();
    } else {
      return;
    }
    setStatus(els.providerStatus, '已插入到输入框', 'ok');
  }

  function bindEvents() {
    els.ttsSpeak?.addEventListener('click', speak);
    els.sttRecord?.addEventListener('click', startRecording);
    els.sttStopRecord?.addEventListener('click', stopRecording);
    els.sttTranscribe?.addEventListener('click', transcribe);
    els.sttAudioInput?.addEventListener('change', selectFile);
    els.sttInsertToInput?.addEventListener('click', insertToChat);
  }

  return { bindEvents, render, speak, startRecording, stopRecording, transcribe, insertToChat };
}

/**
 * 聊天输入区语音听写控制器：
 * 点击麦克风开始录音，再次点击停止并自动转写，结果插入输入框。
 * 依赖浏览器 MediaRecorder / getUserMedia，可注入以便测试。
 */
export function createVoiceDictationController({
  els = {},
  state = {},
  setStatus = () => {},
  insertIntoChat = () => {},
  fetchImpl = globalThis.fetch,
  language = '',
  providerId = '',
  mediaDevicesImpl = null,
  mediaRecorderImpl = null,
  blobImpl = null,
  formDataImpl = null
} = {}) {
  const recorderFactory = mediaRecorderImpl
    || ((stream) => new globalThis.MediaRecorder(stream));
  const mediaDevices = mediaDevicesImpl
    || globalThis.navigator?.mediaDevices;
  const BlobCtor = blobImpl || globalThis.Blob;
  const formDataFactory = () => (formDataImpl ? formDataImpl() : new globalThis.FormData());

  let recording = false;
  let activeStream = null;
  let activeRecorder = null;
  let transcribing = false;

  function isRecording() {
    return recording;
  }

  function syncButtonState() {
    const button = els.voiceDictation;
    if (!button) return;
    button.classList.toggle('is-recording', recording);
    button.classList.toggle('is-transcribing', transcribing);
    button.title = recording
      ? '正在录音，点击停止并转写'
      : transcribing ? '正在转写录音...' : '语音输入';
    button.setAttribute?.('aria-pressed', String(recording));
  }

  function setStatusLine(message, tone) {
    setStatus(els.sessionStatus, message, tone);
  }

  function stopTracks() {
    activeStream?.getTracks?.().forEach((track) => track.stop());
    activeStream = null;
  }

  async function transcribeBlob(blob) {
    const formData = formDataFactory();
    formData.append('audio', blob, blob.name || 'dictation.webm');
    if (providerId) formData.append('providerId', providerId);
    if (language) formData.append('language', language);
    const response = await fetchImpl('/api/voice/stt', { method: 'POST', body: formData });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
    return String(payload.text || '').trim();
  }

  async function start() {
    if (recording || transcribing) return false;
    if (!mediaDevices?.getUserMedia) {
      setStatusLine('当前浏览器不支持录音', 'error');
      return false;
    }
    try {
      activeStream = await mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      activeStream = null;
      setStatusLine(`录音启动失败：${error?.message || error}`, 'error');
      return false;
    }
    const chunks = [];
    try {
      activeRecorder = recorderFactory(activeStream);
    } catch (error) {
      stopTracks();
      setStatusLine(`录音初始化失败：${error?.message || error}`, 'error');
      return false;
    }
    activeRecorder.ondataavailable = (event) => {
      if (event?.data?.size > 0) chunks.push(event.data);
    };
    const stopped = new Promise((resolve) => {
      activeRecorder.onstop = () => resolve(new BlobCtor(chunks, { type: activeRecorder.mimeType || 'audio/webm' }));
    });
    activeRecorder.start();
    recording = true;
    syncButtonState();
    setStatusLine('正在录音，再次点击麦克风结束', 'busy');
    state.voiceDictating = true;

    const blob = await stopped;
    recording = false;
    activeRecorder = null;
    stopTracks();
    state.voiceDictating = false;

    if (!blob || blob.size === 0) {
      syncButtonState();
      setStatusLine('未录到有效音频，已取消', 'error');
      return false;
    }

    transcribing = true;
    syncButtonState();
    setStatusLine('录音结束，正在转写...', 'busy');
    try {
      const text = await transcribeBlob(blob);
      if (text) {
        insertIntoChat(text);
        setStatusLine('语音已转写并插入输入框', 'ok');
      } else {
        setStatusLine('未识别到语音内容', 'error');
      }
      return text || false;
    } catch (error) {
      setStatusLine(`转写失败：${error?.message || error}`, 'error');
      return false;
    } finally {
      transcribing = false;
      syncButtonState();
    }
  }

  function stop() {
    if (!recording || !activeRecorder) return false;
    if (activeRecorder.state !== 'inactive') activeRecorder.stop();
    return true;
  }

  async function toggle() {
    if (recording) return stop();
    return start();
  }

  return { isRecording, start, stop, toggle };
}

/**
 * 消息级 TTS 朗读控制器：
 * 对消息可见正文发起 TTS 请求并播放，同一时刻仅保留一条音频；
 * 再次点击同一消息停止播放，点击其他消息则切换。
 */
export function createMessagePlaybackController({
  els = {},
  setStatus = () => {},
  fetchImpl = globalThis.fetch,
  voice = '',
  format = 'mp3',
  providerId = '',
  resolveMessageSpeechText = null,
  createObjectUrl = null,
  audioElementFactory = null
} = {}) {
  const createUrl = createObjectUrl
    || ((blob) => globalThis.URL?.createObjectURL?.(blob) || '');
  const createAudio = audioElementFactory
    || (() => globalThis.document?.createElement?.('audio') || null);

  let activeMessageId = '';
  let activeAudioUrl = '';
  let activeAudio = null;
  let requestToken = 0;

  function isSpeaking(messageId) {
    return Boolean(messageId) && activeMessageId === messageId;
  }

  function releaseActive() {
    if (activeAudio) {
      try { activeAudio.pause(); } catch {}
      activeAudio = null;
    }
    if (activeAudioUrl) {
      try { globalThis.URL?.revokeObjectURL?.(activeAudioUrl); } catch {}
      activeAudioUrl = '';
    }
    activeMessageId = '';
  }

  function stop() {
    if (!activeMessageId) return false;
    releaseActive();
    return true;
  }

  async function speakMessage(message) {
    const messageId = String(message?.id || '');
    const text = String(
      (typeof resolveMessageSpeechText === 'function' ? resolveMessageSpeechText(message) : '')
      || message?.content
      || ''
    ).trim();
    if (!messageId || !text) {
      setStatus(els.sessionStatus, '请先选择有正文的消息再朗读', 'error');
      return false;
    }

    // 同一条消息：切换为停止
    if (isSpeaking(messageId)) {
      stop();
      setStatus(els.sessionStatus, '已停止朗读', 'ok');
      return false;
    }
    // 其他消息正在播：先释放再播新的
    releaseActive();

    const token = ++requestToken;
    activeMessageId = messageId;
    setStatus(els.sessionStatus, '正在合成语音...', 'busy');
    try {
      const response = await fetchImpl('/api/voice/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text,
          voice,
          format,
          providerId
        })
      });
      if (!response.ok) {
        let message2;
        try { message2 = (await response.json()).error || `HTTP ${response.status}`; }
        catch { message2 = `HTTP ${response.status}`; }
        throw new Error(message2);
      }
      const blob = await response.blob();
      if (token !== requestToken) return false; // 请求期间已被替换或停止

      activeAudioUrl = createUrl(blob);
      activeAudio = createAudio();
      if (!activeAudio || !activeAudioUrl) {
        releaseActive();
        setStatus(els.sessionStatus, '当前环境不支持音频播放', 'error');
        return false;
      }
      activeAudio.src = activeAudioUrl;
      activeAudio.onended = () => releaseActive();
      activeAudio.onerror = () => releaseActive();
      await activeAudio.play?.();
      setStatus(els.sessionStatus, '正在朗读消息', 'ok');
      return true;
    } catch (error) {
      if (token === requestToken) releaseActive();
      setStatus(els.sessionStatus, `朗读失败：${error?.message || error}`, 'error');
      return false;
    }
  }

  async function toggleMessage(message) {
    if (isSpeaking(String(message?.id || ''))) {
      stop();
      setStatus(els.sessionStatus, '已停止朗读', 'ok');
      return false;
    }
    return speakMessage(message);
  }

  return { isSpeaking, speakMessage, stop, toggleMessage };
}
