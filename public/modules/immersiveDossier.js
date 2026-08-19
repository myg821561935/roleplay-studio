export function splitDirectorNoteSections(value) {
  const source = String(value || '').trim();
  const lines = source.split('\n');
  const sections = [];
  let current = { title: '本轮推演', lines: [] };
  const headingPattern = /^\s*(?:#{1,4}\s*)?([^：:\n]{2,24})(分析|判定|推理|检查|思考)\s*[：:]?\s*(.*)$/;

  lines.forEach((line) => {
    const match = line.match(headingPattern);
    if (!match) {
      current.lines.push(line);
      return;
    }
    if (current.lines.some((item) => item.trim())) {
      sections.push({ title: current.title, content: current.lines.join('\n').trim() });
    }
    current = {
      title: `${match[1].trim()}${match[2]}`,
      lines: match[3] ? [match[3].trim()] : []
    };
  });
  if (current.lines.some((item) => item.trim())) {
    sections.push({ title: current.title, content: current.lines.join('\n').trim() });
  }
  return sections.length ? sections : [{ title: '本轮推演', content: source }];
}

export function parseImmersiveStatusFields(value) {
  const fields = [];
  String(value || '')
    .replace(/```(?:ya?ml|json|markdown|md)?/gi, '')
    .replace(/```/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*]\s*/, ''))
    .filter(Boolean)
    .forEach((line) => {
      if (/^[『【\[].+(?:状态|档案)[』】\]]$/.test(line)) return;
      const match = line.match(/^([^:：]{1,18})\s*[:：]\s*(.+)$/);
      if (!match) return;
      const label = match[1].replace(/[『』【】[\]]/g, '').trim();
      const fieldValue = match[2].trim();
      if (!label || !fieldValue || fields.some((field) => field.label === label && field.value === fieldValue)) return;
      fields.push({ label, value: fieldValue });
    });
  return fields.slice(0, 16);
}

export function findImmersiveStatusValue(fields, labels) {
  const wanted = Array.isArray(labels) ? labels : [];
  return fields.find((field) => wanted.some((label) => field.label.includes(label)))?.value || '';
}

export function mergeImmersiveFacts(entries, limit = 10) {
  const facts = [];
  (Array.isArray(entries) ? entries : []).forEach(([label, rawValue]) => {
    const value = Array.isArray(rawValue) ? rawValue.join('、') : String(rawValue || '').trim();
    if (!label || !value || facts.some((fact) => fact.label === label)) return;
    facts.push({ label, value });
  });
  return facts.slice(0, limit);
}

export function cleanImmersiveSidebarText(value) {
  return String(value || '')
    .replace(/<\/?[A-Za-z][^>]*>/g, ' ')
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/\*\*/g, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 520);
}

export function parseImmersiveDocumentSections(value) {
  const sections = [];
  let current = null;
  String(value || '').split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine
      .replace(/<\/?[A-Za-z][^>]*>/g, '')
      .replace(/^\s*#{1,6}\s*/, '')
      .replace(/^\s*[-*]\s*/, '')
      .replace(/\*\*/g, '')
      .trim();
    if (!line) return;
    const bracketed = line.match(/^【([^】]+)】\s*(.*)$/);
    if (bracketed) {
      current = { title: bracketed[1].trim(), detail: bracketed[2].trim(), meta: '' };
      sections.push(current);
      return;
    }
    const labeled = line.match(/^([^:：]{1,18})\s*[:：]\s*(.+)$/);
    if (labeled) {
      current = { title: labeled[1].trim(), detail: labeled[2].trim(), meta: '' };
      sections.push(current);
      return;
    }
    if (current) current.detail = `${current.detail} ${line}`.trim();
    else sections.push({ title: '设定摘要', detail: line, meta: '' });
  });
  return sections.filter((section) => section.title || section.detail).slice(0, 16);
}

export function normalizeImmersiveRecords(value, fallbackTitle) {
  const records = Array.isArray(value) ? value : value ? [value] : [];
  const normalized = records.map((record, index) => {
    if (typeof record !== 'object' || record === null) {
      return { title: fallbackTitle, detail: String(record), meta: '' };
    }
    const relationFrom = String(record.from || record.source || '').trim();
    const relationTo = String(record.to || record.target || record.character || '').trim();
    const relationTitle = relationFrom && relationTo ? `${relationFrom} ↔ ${relationTo}` : '';
    const title = record.title || relationTitle || record.name || record.item || record.subject || record.id
      || record.time || `${fallbackTitle} ${index + 1}`;
    const status = formatImmersiveRecordStatus(record.status);
    const restrictions = Array.isArray(record.limits || record.restrictions)
      ? (record.limits || record.restrictions).join('、')
      : String(record.limits || record.restrictions || '').trim();
    const consequences = Array.isArray(record.consequences)
      ? record.consequences.join('、')
      : String(record.consequences || '').trim();
    const resourceDetail = [
      record.ownership,
      restrictions ? `限制：${restrictions}` : '',
      consequences ? `后果：${consequences}` : ''
    ].filter(Boolean).join('；');
    const relationDetail = [record.type, record.relation, record.relationship, record.details]
      .filter(Boolean)
      .join(' · ');
    const detail = record.content || record.fact || record.event || record.state || record.stance
      || record.objective || record.description || record.progress || record.notes || record.details || relationDetail || resourceDetail || status
      || formatImmersiveRecordFallback(record);
    const meta = [
      record.time && record.time !== title ? record.time : '',
      detail !== status ? status : '',
      relationTitle && record.type ? record.type : '',
      record.holder,
      record.source
    ].filter(Boolean).join(' · ');
    return { title: String(title), detail: String(detail || '等待补充'), meta };
  }).filter((record) => record.detail);
  const deduplicated = new Map();
  normalized.forEach((record) => {
    const key = record.title.trim().toLowerCase();
    if (deduplicated.has(key)) deduplicated.delete(key);
    deduplicated.set(key, record);
  });
  return [...deduplicated.values()].slice(-16);
}

export function formatImmersiveRecordStatus(status) {
  const value = String(status || '').trim();
  const labels = {
    active: '进行中',
    available: '可接取',
    pending: '待处理',
    completed: '已完成',
    failed: '已失败',
    paused: '已暂停'
  };
  return labels[value.toLowerCase()] || value;
}

export function formatImmersiveRecordFallback(record) {
  return Object.entries(record || {})
    .filter(([key, value]) => !['id', 'title', 'name', 'subject', 'time'].includes(key) && value != null && value !== '')
    .slice(0, 4)
    .map(([key, value]) => `${key}：${Array.isArray(value) ? value.join('、') : String(value)}`)
    .join('；');
}

export function formatImmersiveLocation(value) {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  return [value.current, value.name, value.label, value.area, value.details, value.description]
    .map((item) => String(item || '').trim())
    .find(Boolean) || '';
}

export function formatImmersiveMemoryMeta(fact) {
  const timestamp = fact?.updatedAt || fact?.createdAt || fact?.time || '';
  const category = fact?.category || fact?.type || fact?.source || '';
  return [timestamp ? String(timestamp).slice(0, 16).replace('T', ' ') : '', category].filter(Boolean).join(' · ');
}

export function resolveLatestRoleplayPanels(messages, extractRoleplayPresentation) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'assistant') continue;
    const parsed = extractRoleplayPresentation(message.content);
    const materialized = message.roleplayPanels && typeof message.roleplayPanels === 'object'
      ? message.roleplayPanels
      : {};
    const recovered = parsed?.panels && typeof parsed.panels === 'object'
      ? parsed.panels
      : {};
    const panels = { ...recovered, ...materialized };
    if (Object.keys(panels).length) return panels;
  }
  return {};
}

export function resolveLatestTurnFrame(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'assistant') continue;
    if (message?.turnFrame?.validation?.status === 'accepted') return message.turnFrame;
  }
  return null;
}

export function inferStatusProtagonistName(characterStatus) {
  const matches = Array.from(String(characterStatus || '').matchAll(/^[『【\[]([^\n』】\]]+?)(?:状态|档案)[』】\]]/gm));
  const ignored = /^(?:环境|场景|世界|关系|角色好感度系统|系统)$/;
  return matches.map((match) => match[1].trim()).find((name) => name && !ignored.test(name)) || '';
}

export function inferStatusField(statusText, fieldNames) {
  const source = String(statusText || '');
  for (const fieldName of fieldNames) {
    const match = source.match(new RegExp(`^${fieldName}\\s*[:：]\\s*(.+)$`, 'm'));
    if (match?.[1]) return match[1].trim();
  }
  return '';
}

export function toImmersiveWorldBookRecord(entry, truncateText = (value) => value) {
  const keywords = Array.isArray(entry?.keywords)
    ? entry.keywords.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 4)
    : [];
  return {
    title: entry?.title || entry?.id || '未命名条目',
    detail: truncateText(cleanImmersiveSidebarText(entry?.content) || '暂无条目说明。', 220),
    meta: [
      entry?.constant ? '常驻' : (keywords.length ? `触发：${keywords.join('、')}` : '情境触发'),
      `Depth ${entry?.depth ?? 4}`
    ].join(' · ')
  };
}

export function getCustomOpeningProtagonistSnapshot(tpl) {
  if (tpl?.source !== 'custom-pack') return {};
  const fieldValue = (key) => cleanImmersiveSidebarText(
    tpl?.fields?.[key]?.defaultValue
      || tpl?.fields?.[key]?.value
      || ''
  );
  return {
    scenarioRole: tpl?.protagonist?.mode === 'scenario-role',
    name: fieldValue('name') || cleanImmersiveSidebarText(tpl?.protagonist?.name),
    role: fieldValue('role') || cleanImmersiveSidebarText(tpl?.protagonist?.role),
    personality: fieldValue('personality'),
    goal: fieldValue('goal'),
    relationshipStyle: fieldValue('relationshipStyle'),
    openingPressure: fieldValue('openingPressure')
  };
}

export function createImmersiveDossierToolkit({
  documentObject = globalThis.document,
  extractRoleplayPresentation = () => ({ content: '', panels: {} })
} = {}) {
  function appendImmersiveFactGrid(container, facts, className) {
    if (!Array.isArray(facts) || !facts.length) return;
    const grid = documentObject.createElement('dl');
    grid.className = className;
    facts.forEach(({ label, value }) => {
      const item = documentObject.createElement('div');
      const valStr = String(value || '').trim();
      if (valStr.length > 34) item.classList.add('is-wide');
      const term = documentObject.createElement('dt');
      term.textContent = label;
      const description = documentObject.createElement('dd');

      const meterMatch = valStr.match(/(\d+)\s*\/\s*(\d+)/);
      const percentMatch = !meterMatch ? valStr.match(/(?:^|\s)(\d{1,3})%/) : null;

      if (meterMatch && Number(meterMatch[2]) > 0) {
        description.textContent = valStr;
        const meter = documentObject.createElement('span');
        meter.className = 'immersive-profile-meter';
        const fill = documentObject.createElement('i');
        fill.style.width = `${Math.min(100, Math.round((Number(meterMatch[1]) / Number(meterMatch[2])) * 100))}%`;
        meter.append(fill);
        description.append(meter);
      } else if (percentMatch) {
        description.textContent = valStr;
        const meter = documentObject.createElement('span');
        meter.className = 'immersive-profile-meter';
        const fill = documentObject.createElement('i');
        fill.style.width = `${Math.min(100, Number(percentMatch[1]))}%`;
        meter.append(fill);
        description.append(meter);
      } else if (valStr.length > 0 && valStr.length <= 16 && !valStr.includes(' ')) {
        // Tag-like fields: wrap in badge
        const badge = documentObject.createElement('span');
        badge.className = 'immersive-badge';
        badge.textContent = valStr;
        description.append(badge);
      } else {
        description.textContent = valStr;
      }

      item.append(term, description);
      grid.append(item);
    });
    container.append(grid);
  }

  function createImmersiveDossier({ kind, eyebrow, title, summary, metrics = [] }) {
    const root = documentObject.createElement('article');
    root.className = `immersive-dossier immersive-dossier-${kind}`;
    const header = documentObject.createElement('header');
    header.className = 'immersive-dossier-header';
    const heading = documentObject.createElement('div');
    const kicker = documentObject.createElement('span');
    kicker.textContent = eyebrow;
    const titleNode = documentObject.createElement('h3');
    titleNode.textContent = title;
    heading.append(kicker, titleNode);
    const summaryNode = documentObject.createElement('p');
    summaryNode.textContent = summary;
    header.append(heading, summaryNode);
    root.append(header);

    if (metrics.length) {
      const metricList = documentObject.createElement('dl');
      metricList.className = 'immersive-dossier-metrics';
      metrics.forEach(([metricLabel, value]) => {
        const item = documentObject.createElement('div');
        const number = documentObject.createElement('dd');
        number.textContent = String(value ?? 0);
        const caption = documentObject.createElement('dt');
        caption.textContent = metricLabel;
        item.append(number, caption);
        metricList.append(item);
      });
      root.append(metricList);
    }

    const body = documentObject.createElement('div');
    body.className = 'immersive-dossier-body';
    root.append(body);
    return { root, body };
  }

  function appendImmersiveLedgerSection(container, title, items, { numbered = false, tone = '' } = {}) {
    if (!items?.length) return;
    const section = documentObject.createElement('section');
    section.className = `immersive-ledger-section${tone ? ` is-${tone}` : ''}`;
    const heading = documentObject.createElement('h4');
    heading.textContent = title;
    const list = documentObject.createElement('div');
    list.className = 'immersive-ledger-list';
    items.forEach((item, index) => {
      const row = documentObject.createElement('article');
      row.className = 'immersive-ledger-row';
      const marker = documentObject.createElement('span');
      marker.className = 'immersive-ledger-marker';
      marker.textContent = numbered ? String(index + 1).padStart(2, '0') : '•';
      const copy = documentObject.createElement('div');
      const itemTitle = documentObject.createElement('strong');
      itemTitle.textContent = item.title || title;
      const detail = documentObject.createElement('p');
      detail.textContent = item.detail || item.content || '';
      copy.append(itemTitle, detail);
      if (item.meta) {
        const meta = documentObject.createElement('small');
        meta.textContent = item.meta;
        copy.append(meta);
      }
      row.append(marker, copy);
      list.append(row);
    });
    section.append(heading, list);
    container.append(section);
  }

  function appendImmersiveMemoryRows(container, title, items) {
    if (!items?.length) return;
    const section = documentObject.createElement('section');
    section.className = 'immersive-memory-block';
    const heading = documentObject.createElement('div');
    heading.className = 'immersive-memory-block-title';
    const titleNode = documentObject.createElement('h4');
    titleNode.textContent = title;
    const count = documentObject.createElement('span');
    count.textContent = `${items.length} 条`;
    heading.append(titleNode, count);
    const list = documentObject.createElement('div');
    list.className = 'immersive-memory-list';
    items.forEach((item, index) => {
      const row = documentObject.createElement('article');
      row.className = 'immersive-memory-row';
      const number = documentObject.createElement('span');
      number.textContent = String(index + 1).padStart(2, '0');
      const copy = documentObject.createElement('div');
      const itemTitle = documentObject.createElement('strong');
      itemTitle.textContent = item.title || '叙事事实';
      const detail = documentObject.createElement('p');
      detail.textContent = item.detail || '';
      copy.append(itemTitle, detail);
      if (item.meta) {
        const meta = documentObject.createElement('small');
        meta.textContent = item.meta;
        copy.append(meta);
      }
      row.append(number, copy);
      list.append(row);
    });
    section.append(heading, list);
    container.append(section);
  }

  function getImmersiveRecentTurns(messages) {
    return (Array.isArray(messages) ? messages : [])
      .filter((message) => ['user', 'assistant'].includes(message?.role) && message?.content)
      .slice(-6)
      .reverse()
      .map((message) => {
        const presentation = message.role === 'assistant' ? extractRoleplayPresentation(message.content) : null;
        const visibleContent = message.role === 'assistant' ? presentation?.content : message.content;
        const detail = cleanImmersiveSidebarText(visibleContent);
        return {
          title: message.role === 'user' ? '主角行动' : (presentation?.speaker || '世界回应'),
          detail,
          meta: message.createdAt ? String(message.createdAt).slice(0, 16).replace('T', ' ') : ''
        };
      })
      .filter((item) => item.detail);
  }

  function appendImmersiveDossierEmpty(container, message) {
    if (!container || container.childElementCount) return;
    const empty = documentObject.createElement('div');
    empty.className = 'immersive-sidebar-empty';
    empty.textContent = message;
    container.append(empty);
  }

  return {
    appendImmersiveDossierEmpty,
    appendImmersiveFactGrid,
    appendImmersiveLedgerSection,
    appendImmersiveMemoryRows,
    createImmersiveDossier,
    getImmersiveRecentTurns
  };
}
