import { cleanImmersiveSidebarText } from './immersiveDossier.js';

export function buildImmersiveImmediateTurnRecords(eventLedger, {
  truncateText = (value) => String(value || '')
} = {}) {
  return (Array.isArray(eventLedger) ? eventLedger : [])
    .filter((event) => event?.visibility === undefined || event.visibility === 'public')
    .slice(-4)
    .reverse()
    .map((event, index) => ({
      title: index === 0 ? '刚刚完成的回合' : '此前回合',
      detail: truncateText(cleanImmersiveSidebarText(event?.summary), 360),
      meta: [
        event?.timestamp ? String(event.timestamp).slice(0, 16).replace('T', ' ') : '',
        event?.status === 'committed' ? '已结算' : '已记录'
      ].filter(Boolean).join(' · ')
    }))
    .filter((record) => record.detail);
}
