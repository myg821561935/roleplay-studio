import { advanceWorldClock, normalizeWorldClock } from './worldClock.js';

export function tickOffscreenSimulation({
  worldState = {},
  groupMembers = [],
  activeActor = '',
  currentLocation = '',
  narrativeText = '',
  simulation,
  allowAmbientAdvance = true,
  allowOffscreenEvents = true
} = {}) {
  const currentClock = normalizeWorldClock(worldState.clock);
  const updatedClock = advanceWorldClock(currentClock, narrativeText, { allowAmbientAdvance, simulation });

  const actors = Array.isArray(worldState.actors) ? [...worldState.actors] : [];
  const offscreenEvents = Array.isArray(worldState.offscreenEvents)
    ? [...worldState.offscreenEvents]
    : [];

  const activeName = String(activeActor || '').trim();
  const currentLoc = normalizeLocation(currentLocation || worldState.location);

  // 1. 整理候选离场 NPC：在 groupMembers 中但当前不在本轮活跃的角色
  const members = Array.isArray(groupMembers) ? groupMembers : [];
  const offscreenMembers = members.filter((m) => {
    const name = String(m?.name || '').trim();
    return name && name !== activeName;
  });

  // 2. 为离场 NPC 产生自主推演动态（当世界时钟发生更迭或轮次累积时）
  for (const member of offscreenMembers) {
    if (!allowOffscreenEvents) break;
    const name = member.name.trim();
    const directives = Array.isArray(member.directives) && member.directives.length
      ? member.directives
      : (member.personality ? [member.personality] : ['暗中观察局势变化']);
    const primaryDirective = directives[0];
    const memberLocation = normalizeLocation(member.location);

    // 只为有明确、且确实离场位置的角色产生动态。没有可靠地点或只有
    // 对象序列化结果时，不能凭空补出“它处隐秘之地”的剧情。
    if (memberLocation && currentLoc && memberLocation !== currentLoc) {
      const eventSummary = `【第${updatedClock.day}天·${updatedClock.timeOfDay}】${name}在${memberLocation}：${primaryDirective}，暗中推进自身算盘。`;

      // 避免重复事件
      const hasRecentSame = offscreenEvents.slice(-4).some((e) => e.actor === name && e.day === updatedClock.day && e.timeOfDay === updatedClock.timeOfDay);
      if (!hasRecentSame) {
        offscreenEvents.push({
          id: `offscreen-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          actor: name,
          location: memberLocation,
          action: primaryDirective,
          day: updatedClock.day,
          timeOfDay: updatedClock.timeOfDay,
          summary: eventSummary,
          timestamp: Date.now()
        });
      }
    }
  }

  // 保留最近 12 条离场事件
  const trimmedEvents = offscreenEvents.slice(-12);

  return {
    clock: updatedClock,
    offscreenEvents: trimmedEvents
  };
}

function normalizeLocation(value) {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  return String(value.name || value.title || value.label || value.current || '').trim();
}
