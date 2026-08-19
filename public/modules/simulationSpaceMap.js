import { escapeHtmlText } from './utils.js';

export function renderSpaceTimeMap(snapshot, container, directorView) {
  if (!container) return;
  const simulation = snapshot?.simulation || {};
  const worldState = snapshot?.worldState || {};
  const actors = Array.isArray(simulation.actors) ? simulation.actors : [];

  const protagonist = worldState.protagonist || {};
  const protagonistLoc = String(worldState.location?.current || worldState.location || protagonist.location || '未知区域').trim();

  const locationGroups = new Map();
  const addActorToLocation = (loc, actorInfo) => {
    const key = loc || '未知区域';
    if (!locationGroups.has(key)) locationGroups.set(key, []);
    locationGroups.get(key).push(actorInfo);
  };

  // Add protagonist
  if (protagonist.name || protagonistLoc !== '未知区域') {
    addActorToLocation(protagonistLoc, {
      name: protagonist.name || '主角',
      role: protagonist.role || 'Player',
      isProtagonist: true
    });
  }

  actors.filter(a => a.enabled !== false).forEach(actor => {
    const loc = String(actor.location || '未知区域').trim();
    addActorToLocation(loc, {
      name: actor.name,
      role: actor.role,
      isProtagonist: false,
      schedule: Array.isArray(actor.schedule) && actor.schedule.length ? actor.schedule[0] : null
    });
  });

  if (locationGroups.size === 0) {
    container.innerHTML = '<div class="compact-empty">尚未收集到任何空间坐标。</div>';
    return;
  }

  const cardsHtml = Array.from(locationGroups.entries()).map(([locName, people]) => {
    const isCurrent = locName === protagonistLoc;
    const peopleHtml = people.map(p => `
      <div class="minimap-actor ${p.isProtagonist ? 'is-protagonist' : ''}">
        <span class="minimap-actor-name">${escapeHtmlText(p.name)}</span>
        ${p.schedule && directorView ? `<span class="minimap-actor-intent" title="${escapeHtmlText(p.schedule.activity || '')}">→ ${escapeHtmlText(p.schedule.location || '?')}</span>` : ''}
      </div>
    `).join('');

    return `
      <div class="minimap-card ${isCurrent ? 'is-current-location' : ''}">
        <div class="minimap-card-header">
          <strong>${escapeHtmlText(locName)}</strong>
          <span>${people.length} 人</span>
        </div>
        <div class="minimap-card-body">
          ${peopleHtml}
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="minimap-grid">
      ${cardsHtml}
    </div>
  `;
}
