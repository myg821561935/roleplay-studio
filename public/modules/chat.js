import { shouldHideAuxiliaryMessage } from './messagePresentation.js';

const MASKED_SECRET = '********';

function isLoopbackUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
}

export function isProviderConfigured(providersConfig = {}) {
  const providers = Array.isArray(providersConfig.providers) ? providersConfig.providers : [];
  const activeId = String(providersConfig.activeProviderId || providers[0]?.id || '').trim();
  const provider = providers.find((item) => item?.id === activeId) || providers[0];
  if (!provider || !String(provider.id || '').trim()) return false;
  if (!String(provider.model || '').trim()) return false;

  const kind = String(provider.kind || 'openai-compatible').trim().toLowerCase();
  const usesProviderDefaultEndpoint = ['anthropic', 'gemini'].includes(kind);
  if (!usesProviderDefaultEndpoint && !String(provider.baseUrl || '').trim()) return false;

  const apiKey = String(provider.apiKey || '').trim();
  return (!usesProviderDefaultEndpoint && isLoopbackUrl(provider.baseUrl))
    || Boolean(apiKey && apiKey !== 'sk-...')
    || apiKey === MASKED_SECRET;
}

export function resolveOpeningButtonText(template = {}) {
  return String(template?.buttonText || '').trim()
    || '[ 确认当前设定 · 开始故事 ]';
}

export function createProviderOnboardingBanner({ onConfigure } = {}) {
  const banner = document.createElement('div');
  banner.className = 'provider-onboarding-banner';
  banner.setAttribute('role', 'alert');

  const copy = document.createElement('div');
  copy.className = 'provider-onboarding-copy';
  const title = document.createElement('strong');
  title.textContent = '未配置 Provider';
  const description = document.createElement('span');
  description.textContent = '先连接一个模型，再开始生成剧情。';
  copy.append(title, description);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'provider-onboarding-action';
  button.textContent = '去配置';
  button.addEventListener('click', () => onConfigure?.());

  banner.append(copy, button);
  return banner;
}

export function createQuickStartGuide({ onOpenLibrary, onConfigure } = {}) {
  const guide = document.createElement('div');
  guide.className = 'quick-start-guide';

  const heading = document.createElement('h3');
  heading.className = 'quick-start-heading';
  heading.textContent = '快速上手';
  guide.append(heading);

  const steps = [
    { num: 1, label: '配置接口', hint: '连接一个 AI 模型 Provider', action: onConfigure, actionLabel: '去配置' },
    { num: 2, label: '选择剧本', hint: '从书架中挑选一个题材剧本', action: onOpenLibrary, actionLabel: '打开书架' },
    { num: 3, label: '开始故事', hint: '剧本选定后，按提示开局', action: null, actionLabel: '' }
  ];

  for (const step of steps) {
    const item = document.createElement('div');
    item.className = 'quick-start-step';

    const badge = document.createElement('span');
    badge.className = 'quick-start-badge';
    badge.textContent = String(step.num);

    const body = document.createElement('div');
    body.className = 'quick-start-body';
    const label = document.createElement('strong');
    label.textContent = step.label;
    const hint = document.createElement('span');
    hint.textContent = step.hint;
    body.append(label, hint);

    item.append(badge, body);

    if (step.action) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'quick-start-action ghost-button compact';
      btn.textContent = step.actionLabel;
      btn.addEventListener('click', () => step.action?.());
      item.append(btn);
    }

    guide.append(item);
  }

  return guide;
}

export function createChatController(deps) {
  const {
    state,
    els,
    getCurrentSessionId,
    getCurrentSessionLabel = getCurrentSessionId,
    applyBackgroundImage,
    renderImmersiveSidebar,
    renderJourneyDraft,
    setStatus,
    resolvePrologueTemplate,
    renderOpeningWorkflow,
    startGuidedJourney,
    createMessageNode,
    openProviderSettings,
    openStoryLauncher
  } = deps;
  let autoFollowLatest = true;

  function isNearBottom(threshold = 112) {
    if (!els.messages) return true;
    const remaining = els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight;
    return remaining <= threshold;
  }

  function captureScrollState() {
    return {
      scrollTop: els.messages?.scrollTop || 0,
      followLatest: autoFollowLatest || isNearBottom()
    };
  }

  function restoreScrollState(snapshot = {}, { forceLatest = false } = {}) {
    if (!els.messages) return;
    if (forceLatest || snapshot.followLatest) {
      els.messages.scrollTop = els.messages.scrollHeight;
      autoFollowLatest = true;
      return;
    }
    const maxScrollTop = Math.max(0, els.messages.scrollHeight - els.messages.clientHeight);
    els.messages.scrollTop = Math.min(Number(snapshot.scrollTop || 0), maxScrollTop);
    autoFollowLatest = false;
  }

  function scrollToLatest() {
    restoreScrollState({ followLatest: true }, { forceLatest: true });
  }

  els.messages?.addEventListener('scroll', () => {
    autoFollowLatest = isNearBottom();
  }, { passive: true });

  function renderMessages() {
    const scrollState = captureScrollState();
    const messages = Array.isArray(state.session?.messages) ? state.session.messages : [];
    const openingFocus = messages.length === 0 && !state.pendingJourneyDraft;
    document.body.classList.toggle('story-opening-focus', openingFocus);
    els.messages.innerHTML = '';
    els.messages.classList.remove('has-cover-page', 'has-journey-draft');
    applyBackgroundImage(state.session?.settings?.backgroundImage || '');
    renderImmersiveSidebar();

    if (!messages.length) {
      if (state.pendingJourneyDraft) {
        els.messages.classList.add('has-journey-draft');
        els.messages.append(renderJourneyDraft(state.pendingJourneyDraft));
        els.messages.scrollTop = 0;
        setStatus(els.sessionStatus, `${getCurrentSessionLabel()} · 开局稿待发送`, 'ok');
        return;
      }

      const empty = document.createElement('div');
      empty.className = 'epic-cover-page';
      els.messages.classList.add('has-cover-page');
      const { genre, tpl } = resolvePrologueTemplate();

      if (!isProviderConfigured(state.config?.providers)) {
        empty.append(createProviderOnboardingBanner({ onConfigure: openProviderSettings }));
      }

      if (!messages.length && !state.pendingJourneyDraft) {
        empty.append(createQuickStartGuide({
          onOpenLibrary: openStoryLauncher,
          onConfigure: openProviderSettings
        }));
      }

      if (tpl) {
        const title = document.createElement('h1');
        title.textContent = tpl.title;
        empty.dataset.prologueGenre = genre;

        const subtitle = document.createElement('h2');
        subtitle.textContent = tpl.subtitle;

        const tagline = document.createElement('p');
        tagline.className = 'epic-tagline';
        tagline.textContent = tpl.tagline;

        const workflow = renderOpeningWorkflow(genre, tpl);

        const startBtn = document.createElement('button');
        startBtn.className = 'epic-start-btn';
        startBtn.type = 'button';
        startBtn.dataset.helpKey = 'startJourney';
        startBtn.textContent = resolveOpeningButtonText(tpl);
        startBtn.onclick = () => startGuidedJourney(genre);

        const actions = document.createElement('div');
        actions.className = 'epic-cover-actions';
        actions.append(startBtn);

        empty.append(title, subtitle, tagline, workflow, actions);
      } else {
        const error = document.createElement('p');
        error.textContent = '无法加载设定模板...';
        empty.append(error);
      }

      els.messages.append(empty);
    } else {
      const fragment = document.createDocumentFragment();
      messages
        .filter((message, index) => (
          !isJourneySetupMessage(message)
          && !shouldHideAuxiliaryMessage(message, messages[index + 1])
        ))
        .forEach((message) => fragment.append(createMessageNode(message)));
      els.messages.append(fragment);
      restoreScrollState(scrollState);
    }

    const count = messages.length;
    setStatus(els.sessionStatus, `${getCurrentSessionLabel()} · ${count} 条消息`, '');
  }

  return {
    renderMessages,
    captureScrollState,
    restoreScrollState,
    scrollToLatest
  };
}

function isJourneySetupMessage(message) {
  if (message?.role !== 'user') return false;
  if (message.kind === 'journey-setup') return true;
  return /^\s*\[\s*命途设定\s*[：:]?/u.test(String(message.content || ''));
}
