const LEGACY_RUNTIME_FALLBACK_ACTION_PATTERNS = [
  /^向.+?(?:追问「开局情境」的关键信息|确认眼前局势与下一步选择)$/u,
  /^围绕「开局情境」继续调查可确认的线索$/u,
  /^观察周围，确认可利用的线索与风险$/u,
  /^先评估风险，再决定是否介入眼前局面$/u,
  /^以现有修行或技艺应对当前阻碍$/u,
  /^盘点现有资源，筹备下一步所需物资$/u,
  /^谨慎前往下一处可能推进局势的地点$/u,
  /^正面回应.+?的问题，只说自己已经确认的部分$/u,
  /^保留关键信息，反问.+?为何要问$/u,
  /^暂不回答，先确认.+?的态度与目的$/u,
  /^在.+?回应.+?此刻的反应，明确自己愿意推进到哪一步$/u,
  /^先停下当前动作，询问.+?是否愿意继续以及边界在哪里$/u,
  /^暂不继续推进，保持当前距离观察.+?会不会主动回应$/u,
  /^按「.+?」的要求行动，但保留随时停下的余地$/u,
  /^暂不行动，追问.+?提出这项要求的真实目的$/u,
  /^只做一个低风险的试探动作，观察.+?会如何反应$/u
];

export function filterLegacyRuntimeFallbackActions(actions = []) {
  return (Array.isArray(actions) ? actions : [])
    .map((action) => String(action || '').trim())
    .filter((action) => action && !LEGACY_RUNTIME_FALLBACK_ACTION_PATTERNS.some((pattern) => pattern.test(action)));
}
