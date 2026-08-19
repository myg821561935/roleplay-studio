import { escapeHtmlText, humanizeApiError, prettyJson } from './utils.js';
import { renderSpaceTimeMap } from './simulationSpaceMap.js';

export function formatSimulationDuration(minutes) {
  if (minutes >= 1440 && minutes % 1440 === 0) return `${minutes / 1440} 日`;
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} 小时`;
  return `${minutes} 分钟`;
}

export function formatSimulationTimestamp(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '时间未知';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

export function renderSimulationTextList(items, emptyText = '') {
  const values = (Array.isArray(items) ? items : []).map((item) => String(item || '').trim()).filter(Boolean);
  if (!values.length) return emptyText ? `<p class="simulation-list-empty">${escapeHtmlText(emptyText)}</p>` : '';
  return `<ul>${values.map((item) => `<li>${escapeHtmlText(item)}</li>`).join('')}</ul>`;
}

export function renderSimulationActor(actor, { directorView }) {
  const goals = renderSimulationTextList(actor.goals, '尚未登记目标');
  const publicKnowledge = renderSimulationTextList(actor.publicKnowledge, '暂无公开知识');
  const privateKnowledge = directorView
    ? `<div class="simulation-private-block"><span>私有知识</span>${renderSimulationTextList(actor.privateKnowledge, '暂无私有知识')}</div>`
    : '';
  const agenda = Array.isArray(actor.agenda) ? actor.agenda.filter((item) => item.status === 'active') : [];
  const agendaHtml = agenda.length
    ? `<div class="simulation-agenda"><span>${directorView ? '幕后议程' : '当前议程'}</span>${renderSimulationTextList(agenda.map((item) => item.title))}</div>`
    : '';
  const schedules = Array.isArray(actor.schedule) ? actor.schedule : [];
  const scheduleHtml = schedules.length
    ? `<details class="simulation-actor-details"><summary>日程 ${schedules.length}</summary><div>${schedules.map((entry) => `
        <p><time>${escapeHtmlText(entry.at || '--:--')}</time><span>${escapeHtmlText([entry.location, entry.activity].filter(Boolean).join(' · ') || '待定')}</span></p>
      `).join('')}</div></details>`
    : '';
  return `
    <article class="simulation-actor${actor.enabled === false ? ' is-disabled' : ''}">
      <header>
        <div>
          <strong>${escapeHtmlText(actor.name || '未命名角色')}</strong>
          <span>${escapeHtmlText(actor.role || '未登记身份')}</span>
        </div>
        <span class="simulation-actor-status">${escapeHtmlText(actor.status || 'idle')}</span>
      </header>
      <p class="simulation-actor-location">${escapeHtmlText(actor.location || '位置未知')}</p>
      <div class="simulation-actor-grid">
        <div><span>目标</span>${goals}</div>
        <div><span>公开知识</span>${publicKnowledge}</div>
      </div>
      ${privateKnowledge}
      ${agendaHtml}
      ${scheduleHtml}
    </article>
  `;
}

export function renderSimulationEvent(event) {
  const kindLabels = {
    turn: '剧情回合',
    'manual-action': '创作者动作',
    'simulation-tick': '世界时钟',
    'actor-registry': '角色档案'
  };
  const effects = Array.isArray(event.effects) ? event.effects : [];
  return `
    <article class="simulation-event">
      <div class="simulation-event-meta">
        <span class="simulation-event-kind">${escapeHtmlText(kindLabels[event.kind] || event.kind || '事件')}</span>
        <time>${escapeHtmlText(formatSimulationTimestamp(event.timestamp))}</time>
        <span class="simulation-event-status is-${escapeHtmlText(event.status || 'observed')}">${escapeHtmlText(event.status || 'observed')}</span>
      </div>
      <p>${escapeHtmlText(event.summary || '未记录摘要')}</p>
      <div class="simulation-event-foot">
        <span>${escapeHtmlText(event.actor || 'system')}</span>
        <span>${effects.length} 项状态变化</span>
        ${Number.isInteger(event.revisionAfter) ? `<span>修订 ${event.revisionAfter}</span>` : ''}
      </div>
    </article>
  `;
}

function simulationMetric(label, value) {
  return `<div class="simulation-metric"><strong>${escapeHtmlText(value)}</strong><span>${escapeHtmlText(label)}</span></div>`;
}

export function createWorldSimulationController({
  state = {},
  els = {},
  apiRequest = async () => ({}),
  getCurrentSessionId = () => 'main',
  parseJsonFromTextarea = (textarea) => JSON.parse(textarea?.value || 'null'),
  setStatus = () => {},
  documentObject = globalThis.document,
  queueMicrotaskFn = globalThis.queueMicrotask
} = {}) {
  function getVisibleSimulationSnapshot() {
    if (state.simulationView === 'public' && state.simulationPublicSnapshot) {
      return state.simulationPublicSnapshot;
    }
    const memory = state.session?.memory || {};
    return {
      sessionId: state.session?.id || getCurrentSessionId(),
      worldState: memory.worldState || {},
      simulation: memory.simulation || {},
      events: Array.isArray(memory.eventLedger) ? memory.eventLedger : [],
      narrativeState: memory.narrativeState || {},
      ruleSystem: memory.ruleSystem || null,
      cardRuntime: memory.cardRuntime || null
    };
  }

  function renderWorldSimulation() {
    if (!els.simulationActors || !els.simulationEvents) return;
    const localRevision = Number(state.session?.memory?.simulation?.revision || 0);
    const publicRevision = Number(state.simulationPublicSnapshot?.simulation?.revision ?? -1);
    if (state.simulationView === 'public' && !state.simulationBusy && publicRevision !== localRevision) {
      queueMicrotaskFn(() => refreshWorldSimulation('public'));
    }
    const snapshot = getVisibleSimulationSnapshot();
    const simulation = snapshot?.simulation || {};
    const actors = Array.isArray(simulation.actors) ? simulation.actors : [];
    const events = Array.isArray(snapshot?.events) ? snapshot.events : [];
    const backstageEvents = Array.isArray(simulation.backstageEvents) ? simulation.backstageEvents : [];
    const clock = simulation.clock || {};
    const directorView = state.simulationView !== 'public';

    if (els.simulationClockLabel) els.simulationClockLabel.textContent = clock.label || '第1日 08:00';
    els.simulationViewSwitch?.querySelectorAll('[data-simulation-view]').forEach((button) => {
      const active = button.dataset.simulationView === state.simulationView;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    documentObject?.querySelectorAll?.('[data-simulation-advance]').forEach((button) => {
      button.disabled = state.simulationBusy;
    });
    if (els.saveSimulationActors) {
      els.saveSimulationActors.disabled = state.simulationBusy || !directorView;
    }

    if (els.simulationMetrics) {
      els.simulationMetrics.innerHTML = [
        simulationMetric('修订', Number(simulation.revision || 0)),
        simulationMetric('运行角色', actors.filter((actor) => actor.enabled !== false).length),
        simulationMetric('事件账本', events.length),
        simulationMetric(directorView ? '幕后事件' : '公开事件', backstageEvents.length)
      ].join('');
    }

    const minimapContainer = els.simulationMinimap || documentObject.getElementById('simulation-minimap');
    if (minimapContainer) {
      renderSpaceTimeMap(snapshot, minimapContainer, directorView);
    }

    if (els.simulationActorCount) els.simulationActorCount.textContent = `${actors.length} 人`;
    els.simulationActors.innerHTML = actors.length
      ? actors.map((actor) => renderSimulationActor(actor, { directorView })).join('')
      : '<div class="compact-empty">当前内容包尚未登记可运行角色。</div>';

    const visibleEvents = [...events].reverse().slice(0, 20);
    if (els.simulationEventCount) els.simulationEventCount.textContent = `${events.length} 条`;
    els.simulationEvents.innerHTML = visibleEvents.length
      ? visibleEvents.map(renderSimulationEvent).join('')
      : '<div class="compact-empty">事件账本为空，剧情行动与时间推进会在这里留下记录。</div>';

    if (els.simulationActorsEditor && documentObject?.activeElement !== els.simulationActorsEditor) {
      els.simulationActorsEditor.value = prettyJson(actors);
      els.simulationActorsEditor.readOnly = !directorView;
    }
  }

  function applyDirectorSimulationSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;
    const memory = state.session?.memory || {};
    state.session.memory = {
      ...memory,
      worldState: snapshot.worldState || memory.worldState || {},
      simulation: snapshot.simulation || memory.simulation || {},
      eventLedger: Array.isArray(snapshot.events) ? snapshot.events : (memory.eventLedger || []),
      narrativeState: snapshot.narrativeState || memory.narrativeState || {},
      ruleSystem: snapshot.ruleSystem || memory.ruleSystem || null,
      cardRuntime: snapshot.cardRuntime || memory.cardRuntime || null
    };
    state.simulationPublicSnapshot = null;
  }

  async function selectSimulationView(view) {
    const nextView = view === 'public' ? 'public' : 'director';
    state.simulationView = nextView;
    renderWorldSimulation();
    if (nextView === 'public') await refreshWorldSimulation('public');
  }

  async function refreshWorldSimulation(view = state.simulationView) {
    if (state.simulationBusy) return;
    state.simulationBusy = true;
    renderWorldSimulation();
    try {
      const sessionId = state.session?.id || getCurrentSessionId();
      const payload = await apiRequest(`/api/sessions/${encodeURIComponent(sessionId)}/simulation?view=${view}`);
      if (view === 'public') {
        state.simulationPublicSnapshot = payload.snapshot || null;
      } else {
        applyDirectorSimulationSnapshot(payload.snapshot);
      }
    } catch (error) {
      setStatus(els.simulationStatus, `世界状态刷新失败：${humanizeApiError(error)}`, 'error');
    } finally {
      state.simulationBusy = false;
      renderWorldSimulation();
    }
  }

  async function advanceWorldSimulation(minutes) {
    if (state.simulationBusy || !Number.isFinite(minutes)) return;
    state.simulationBusy = true;
    renderWorldSimulation();
    try {
      const sessionId = state.session?.id || getCurrentSessionId();
      const payload = await apiRequest(`/api/sessions/${encodeURIComponent(sessionId)}/simulation/advance`, {
        method: 'POST',
        body: {
          minutes,
          reason: `创作者推进世界时间 ${minutes} 分钟`,
          view: 'director'
        }
      });
      applyDirectorSimulationSnapshot(payload.snapshot);
      if (state.simulationView === 'public') {
        const publicPayload = await apiRequest(`/api/sessions/${encodeURIComponent(sessionId)}/simulation?view=public`);
        state.simulationPublicSnapshot = publicPayload.snapshot || null;
      }
      setStatus(els.simulationStatus, `世界时钟已推进 ${formatSimulationDuration(minutes)}`, 'ok');
    } catch (error) {
      setStatus(els.simulationStatus, `时间推进失败：${humanizeApiError(error)}`, 'error');
    } finally {
      state.simulationBusy = false;
      renderWorldSimulation();
    }
  }

  async function saveSimulationActors() {
    if (state.simulationBusy || !els.simulationActorsEditor) return;
    let actors;
    try {
      actors = parseJsonFromTextarea(els.simulationActorsEditor, 'NPC 档案');
      if (!Array.isArray(actors)) throw new Error('NPC 档案必须是 JSON 数组');
    } catch (error) {
      setStatus(els.simulationActorsStatus, error.message, 'error');
      return;
    }

    state.simulationBusy = true;
    renderWorldSimulation();
    try {
      const sessionId = state.session?.id || getCurrentSessionId();
      const payload = await apiRequest(`/api/sessions/${encodeURIComponent(sessionId)}/simulation/actors`, {
        method: 'PUT',
        body: { actors, view: 'director' }
      });
      applyDirectorSimulationSnapshot(payload.snapshot);
      setStatus(els.simulationActorsStatus, `已保存 ${payload.snapshot?.simulation?.actors?.length || 0} 名角色`, 'ok');
    } catch (error) {
      setStatus(els.simulationActorsStatus, `保存失败：${humanizeApiError(error)}`, 'error');
    } finally {
      state.simulationBusy = false;
      renderWorldSimulation();
    }
  }

  return {
    advanceWorldSimulation,
    applyDirectorSimulationSnapshot,
    refreshWorldSimulation,
    renderWorldSimulation,
    saveSimulationActors,
    selectSimulationView
  };
}
