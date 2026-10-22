import { collectWorldBookCharacterNames } from '../character/characterContentMode.js';

const rows = value => Array.isArray(value) ? value : [];
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Dialogue, thoughts, plans and control blocks are not evidence of occurrence.
export function continuityProse(value) {
  return String(value || '').replace(/<(npc_thought|thinking|think|analysis|planning|planing|time|ri_tucao|yue_tucao|options|UpdateVariable)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"/g, '');
}

export function actorPresenceEvents(content, name, knownActors = [name]) {
  const events = [];
  let priorProse = '';
  for (const sentence of continuityProse(content).split(/[。！？\n]/)) {
    const mentionedEarlier = priorProse.includes(name);
    priorProse = (priorProse + sentence).slice(-2400);
    if (/如果|若是|假如|回忆|想起|曾经|昨日|也许|可能|准备|打算|将要|不要|没有离开|尚未离开|并未离开|未曾离开/.test(sentence)) continue;
    // A sole remaining actor establishes absence without guessing who a pronoun refers to.
    const soleActor = knownActors.find(actor => new RegExp(`(?:只剩|只余|仅剩)(?:下|了)?${escape(actor)}(?:一人|一个人)`, 'u').test(sentence));
    if (soleActor && soleActor !== name && mentionedEarlier) {
      events.push({ actor: name, status: 'departed', evidence: sentence.trim().slice(0, 200), basis: 'sole-remaining-actor' });
    }
    for (const occurrence of sentence.matchAll(new RegExp(escape(name), 'gu'))) {
      let tail = sentence.slice(occurrence.index + name.length);
      // Stop at another named subject; do not attribute their movement to this actor.
      const nextActor = knownActors.map(actor => tail.indexOf(actor)).filter(index => index >= 0);
      if (nextActor.length) tail = tail.slice(0, Math.min(...nextActor));
      tail = tail.slice(0, 100);
      for (const movement of tail.matchAll(/返回|回到|折返|重新出现|走回|已经离开|已离开|离开了|离去了|走远了|退场|不在场|离去|没入|消失在/gu)) {
        if (/还没|尚未|没有|并未|未曾|不曾|想要|正要|即将|身影|背影|目送|看着|看向|望着|看见|望见|听见|朝|对着/.test(tail.slice(0, movement.index))) continue;
        if (/^的(?:方向|身影|地方|背影)/.test(tail.slice(movement.index + movement[0].length))) continue;
        const status = /^(?:返回|回到|折返|重新出现|走回)$/.test(movement[0]) ? 'present' : 'departed';
        events.push({ actor: name, status, evidence: sentence.trim().slice(0, 200) });
      }
    }
  }
  return events;
}

export function buildSceneContinuity({ messages = [], memory = {}, worldBook = [], persona = {} } = {}) {
  const names = [...new Set([
    ...collectWorldBookCharacterNames(worldBook),
    ...rows(memory?.characterRegistry?.records).map(r => r.name),
    ...rows(memory?.simulation?.actors).map(r => r.name),
    ...rows(memory?.worldState?.characters).map(r => r.name),
    ...messages.filter(m => m?.role === 'assistant' && !m.excluded && !m.contextExcluded && !m.aborted)
      .flatMap(m => rows(m.sceneContinuityActors)),
    persona?.enabled ? persona.name : '', memory?.worldState?.protagonist?.name
  ].filter(v => typeof v === 'string' && v.trim()).map(v => v.trim()))].slice(0, 64);
  const actors = new Map(), completed = new Map(), sceneObservations = new Map();
  for (const message of messages) {
    if (message?.role !== 'assistant' || message.excluded || message.contextExcluded || message.aborted) continue;
    const source = { sourceMessageId: message.id || '', origin: 'accepted-prose-observation' };
    for (const name of names) for (const event of actorPresenceEvents(message.content, name, names)) actors.set(name, { ...event, ...source });
    const sentences = continuityProse(message.content).split(/[。！？\n]/).map(s => s.trim()).filter(Boolean);
    for (const [index, sentence] of sentences.entries()) {
      if (sentence.length > 240 || /如果|若是|假如|回忆|想起|曾经|也许|可能|准备|打算|将要|想要|正要|即将|并未|尚未|还没|没有|不要|未完成|如何|怎么|安排|计划|以为/.test(sentence)) continue;
      if (/(?:只剩|只余|仅剩)(?:下|了)?[^。！？]{1,16}(?:一人|一个人)|(?:身影|人影|背影|脚步声)[^。！？]{0,32}(?:隐进|隐入|消失|吞没|没入|远去|远下去)/.test(sentence)) {
        // Preserve indirect wording without inventing the identity of 他/她.
        const evidence = sentences.slice(Math.max(0, index - 2), index + 1).join('。').slice(-420);
        sceneObservations.delete(evidence); sceneObservations.set(evidence, { evidence, ...source });
      }
      if (!/(?:已经|已把|已将|已被|已)[^。！？]{0,70}(?:补好|填平|盖严|完成|修好|归还|交还|收好|覆好|压实|培好|填好|埋好|埋得严实)|(?:覆好|补好|修好|填平|盖严|压实|归还|交还|完成)(?:的|了|完毕)|覆土完毕|(?:压到|填到|覆到)最后[^。！？]{0,100}(?:才松开手|才收回手|才停下)/.test(sentence)) continue;
      const evidence = sentence.trim();
      completed.delete(evidence); completed.set(evidence, { evidence, ...source });
    }
  }
  return { spec: 'lra.scene-continuity/v1', actors: [...actors.values()].slice(-24), completedActions: [...completed.values()].slice(-12), sceneObservations: [...sceneObservations.values()].slice(-4) };
}

export function renderSceneContinuity(state) {
  const departed = state.actors.filter(a => a.status === 'departed');
  if (!departed.length && !state.completedActions.length && !state.sceneObservations?.length) return '';
  return ['# 已接受正文的连续性记录',
    '以下是历史正文中的观察记录，不是额外世界设定。原句描述当时发生的事，不保证状态永远不变。沿着其后果继续，不能无交代让已离场人物回到近处或重演已完成动作。若后来明确返回、重新损坏或主动重做，应按新事件推进；人物最新转场记录优先于更早的独处原句。',
    ...state.completedActions.map(a => `已完成动作（来源 ${a.sourceMessageId}）：${a.evidence}`),
    ...(state.sceneObservations || []).map(a => `历史场景落点原句（来源 ${a.sourceMessageId}；代词须结合原文，不擅自指定人物）：${a.evidence}`),
    ...state.actors.map(a => `${a.status === 'departed' ? '离场人物' : '人物已明确返回'} ${a.actor}（最新转场来源 ${a.sourceMessageId}）：${a.evidence}`)
  ].join('\n');
}

export function renderExplicitTurnBoundary(userMessage) {
  const user = String(userMessage?.content ?? userMessage ?? '');
  const rules = [];
  if (/(?:暂不|不再|不要|不)(?:采取|进行|作出)新?行动/.test(user)) {
    rules.push('玩家明确不采取新行动。本轮只写被动观察和可感知的变化，保持已经确立的姿态与持物；不补写伸手、修补、拿取或移动，不制造新的损坏来驱动返工。没有新事件时可以短写，不以凑篇幅代替玩家行动。');
  }
  if (/保持当前的?地点/.test(user)) {
    rules.push('玩家明确要求保持当前地点。本轮回应结束后就停在当前场景，不自动执行对方此前交代的任务，不起身出发或走到另一个地点。对方已经离场时，不能为了接话让其重新出现在近处。');
  }
  return rules.length ? '# 玩家本轮明确边界\n' + rules.join('\n') : '';
}
