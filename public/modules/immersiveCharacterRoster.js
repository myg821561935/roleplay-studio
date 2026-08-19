export function appendImmersiveCharacterGroup(container, {
  kind,
  title,
  hint,
  members = [],
  empty
}, {
  documentObject = globalThis.document,
  createCharacterCard = () => null,
  resolveCard = () => ({})
} = {}) {
  if (!container || !documentObject) return;
  const section = documentObject.createElement('section');
  section.className = `immersive-character-group is-${kind}`;
  const heading = documentObject.createElement('header');
  const headingText = documentObject.createElement('div');
  const label = documentObject.createElement('h4');
  label.textContent = title;
  const description = documentObject.createElement('p');
  description.textContent = hint;
  headingText.append(label, description);
  const count = documentObject.createElement('span');
  count.className = 'immersive-character-group-count';
  count.textContent = String(members.length);
  count.setAttribute('aria-label', `${members.length} 名角色`);
  heading.append(headingText, count);
  section.append(heading);

  const list = documentObject.createElement('div');
  list.className = 'immersive-character-list';
  if (!members.length) {
    const emptyState = documentObject.createElement('div');
    emptyState.className = 'immersive-sidebar-empty immersive-character-group-empty';
    emptyState.textContent = empty;
    list.append(emptyState);
  } else {
    members.forEach((member) => {
      const card = createCharacterCard(member, resolveCard(member));
      if (card) list.append(card);
    });
  }
  section.append(list);
  container.append(section);
}
