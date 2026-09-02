export function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'cls')   e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) {
    if (c == null) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

export function openModal({ title, body, buttons = [] }) {
  return new Promise(resolve => {
    const overlay = el('div', { cls: 'bcm-onetime-overlay' });
    const setFixed = (node) => {
      node.style.setProperty('position', 'fixed', 'important');
      node.style.setProperty('top', '0', 'important');
      node.style.setProperty('left', '0', 'important');
      node.style.setProperty('width', '100vw', 'important');
      node.style.setProperty('height', '100vh', 'important');
      node.style.setProperty('display', 'flex', 'important');
      node.style.setProperty('align-items', 'center', 'important');
      node.style.setProperty('justify-content', 'center', 'important');
      node.style.setProperty('z-index', '2147483640', 'important');
      node.style.setProperty('background', 'rgba(0,0,0,.45)', 'important');
    };
    setFixed(overlay);
    const card = el('div', { cls: 'bcm-onetime-card', style: { minWidth: 'min(340px, 94vw)', maxWidth: 'min(500px, 96vw)' } });
    if (title) card.appendChild(el('div', { cls: 'bcm-onetime-title' }, title));
    if (body instanceof Node) {
      card.appendChild(body);
    } else if (typeof body === 'string' && body) {
      card.appendChild(el('div', { cls: 'bcm-modal-body' }, body));
    }
    const btnRow = el('div', { cls: 'bcm-onetime-actions' });
    const finish = val => { overlay.remove(); resolve(val); };
    const btns = buttons.length ? buttons : [{ label: 'OK', primary: true, value: true }];
    for (const b of btns) {
      const cls = 'bcm-modal-btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : '');
      btnRow.appendChild(el('button', { cls, type: 'button', onclick: () => { if (b.onClick) b.onClick(); finish(b.value ?? (b.primary ? true : false)); }}, b.label));
    }
    card.appendChild(btnRow);
    overlay.appendChild(card);
    overlay.addEventListener('click', e => { if (e.target === overlay) finish(null); });
    document.documentElement.appendChild(overlay);
    setTimeout(() => btnRow.querySelector('button')?.focus(), 30);
  });
}

export function openAlert(message) {
  return openModal({ title: null, body: message, buttons: [{ label: 'OK', primary: true, value: true }] });
}

export function openConfirm(message) {
  return openModal({ title: null, body: message, buttons: [
    { label: 'Cancel', primary: false, value: false },
    { label: 'OK', primary: true, value: true },
  ]});
}

export function openPrompt(message, defaultValue = '') {
  return new Promise(resolve => {
    const input = el('input', { cls: 'bcm-modal-input', type: 'text', value: defaultValue });
    input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') finish(input.value); if (e.key === 'Escape') finish(null); });
    const bodyEl = el('div', {}, ...(message ? [el('div', { cls: 'bcm-modal-body' }, message)] : []), input);
    const overlay = el('div', { cls: 'bcm-onetime-overlay' });
    const card = el('div', { cls: 'bcm-onetime-card', style: { minWidth: 'min(320px, 94vw)', maxWidth: 'min(480px, 96vw)' } });
    card.appendChild(bodyEl);
    const btnRow = el('div', { cls: 'bcm-onetime-actions' });
    const finish = val => { overlay.remove(); resolve(val); };
    btnRow.appendChild(el('button', { cls: 'bcm-modal-btn', type: 'button', onclick: () => finish(null) }, 'Cancel'));
    btnRow.appendChild(el('button', { cls: 'bcm-modal-btn primary', type: 'button', onclick: () => finish(input.value) }, 'OK'));
    card.appendChild(btnRow);
    overlay.appendChild(card);
    overlay.addEventListener('click', e => { if (e.target === overlay) finish(null); });
    document.documentElement.appendChild(overlay);
    setTimeout(() => { input.focus(); input.select(); }, 30);
  });
}

export function openSelect(message, options) {
  return new Promise(resolve => {
    const finish = val => { overlay.remove(); resolve(val); };
    const overlay = el('div', { cls: 'bcm-onetime-overlay' });
    const card = el('div', { cls: 'bcm-onetime-card', style: { minWidth: 'min(280px, 94vw)', maxWidth: 'min(380px, 96vw)' } });
    if (message) card.appendChild(el('div', { cls: 'bcm-modal-body' }, message));
    const btnList = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', padding: '4px 0' } });
    for (const opt of options) {
      btnList.appendChild(el('button', { cls: 'bcm-modal-btn', type: 'button', onclick: () => finish(opt.value) }, opt.label));
    }
    card.appendChild(btnList);
    card.appendChild(el('div', { cls: 'bcm-onetime-actions' },
      el('button', { cls: 'bcm-modal-btn', type: 'button', onclick: () => finish(null) }, 'Cancel'),
    ));
    overlay.appendChild(card);
    overlay.addEventListener('click', e => { if (e.target === overlay) finish(null); });
    document.documentElement.appendChild(overlay);
  });
}

export function tickMark(status) {
  if (status === 'read')      return el('span', { cls: 'bcm-tick bcm-tick-read' },      ' ✓✓');
  if (status === 'delivered') return el('span', { cls: 'bcm-tick bcm-tick-delivered' }, ' ✓✓');
  if (status === 'sent')      return el('span', { cls: 'bcm-tick bcm-tick-sent' },      ' ✓');
  return null;
}
