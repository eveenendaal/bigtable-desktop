// Tiny DOM helpers so the renderer can stay framework-free.

/**
 * Creates an element. `attrs` supports `class`, `style` (object), `dataset`,
 * `on<Event>` handlers, boolean attributes and plain properties.
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : value;
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'html') el.innerHTML = value;
    else if (key in el && typeof value !== 'string') el[key] = value;
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, value);
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

export function replaceChildren(el, ...children) {
  clear(el);
  return append(el, children);
}

const ICONS = {
  chevron: '<path d="M9 6l6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  play: '<path d="M7 4l13 8-13 8z" fill="currentColor"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  project: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  instance: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  cluster: '<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  json: '<path d="M8 4c-2 0-2 2-2 4s-2 4-2 4 2 2 2 4 0 4 2 4M16 4c2 0 2 2 2 4s2 4 2 4-2 2-2 4 0 4-2 4"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  diff: '<path d="M12 3v18M5 8h4M7 6v4M15 16h4"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/>',
  row: '<rect x="3" y="9" width="18" height="6" rx="1"/>',
};

export function icon(name, { size = 16, className = '' } = {}) {
  const span = document.createElement('span');
  span.className = `icon ${className}`.trim();
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  return span;
}

export function iconButton(name, title, onClick, extra = {}) {
  return h('button', { type: 'button', class: ['icon-btn', extra.class], title, 'aria-label': title, onClick, disabled: extra.disabled }, icon(name, { size: extra.size || 15 }));
}

let toastHost;
export function toast(message, { kind = 'info', timeout = 3500, action } = {}) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toast-host' });
    document.body.append(toastHost);
  }
  const el = h('div', { class: ['toast', `toast-${kind}`] }, h('span', {}, message));
  if (action) el.append(h('button', { type: 'button', class: 'link-btn', onClick: () => { action.run(); el.remove(); } }, action.label));
  toastHost.append(el);
  setTimeout(() => el.remove(), timeout);
}

/** Shows a small popup menu anchored to `anchor`. Items: {label, onClick, hint?} | 'separator'. */
export function popupMenu(anchor, items) {
  document.querySelectorAll('.popup-menu').forEach((m) => m.remove());
  const menu = h(
    'div',
    { class: 'popup-menu', role: 'menu' },
    items.map((item) =>
      item === 'separator'
        ? h('div', { class: 'menu-sep' })
        : h(
            'button',
            {
              type: 'button',
              role: 'menuitem',
              class: 'menu-item',
              onClick: () => {
                menu.remove();
                item.onClick();
              },
            },
            h('span', {}, item.label),
            item.hint ? h('span', { class: 'menu-hint' }, item.hint) : null,
          ),
    ),
  );
  document.body.append(menu);
  const rect = anchor.getBoundingClientRect();
  const width = menu.offsetWidth;
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.left = `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))}px`;
  const close = (event) => {
    if (!menu.contains(event.target)) {
      menu.remove();
      document.removeEventListener('mousedown', close, true);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', close, true));
  menu.querySelector('button')?.focus();
  menu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') menu.remove();
  });
  return menu;
}

export function formatError(err) {
  return h(
    'div',
    { class: 'error-box' },
    h('div', { class: 'error-title' }, err.code ? `${err.code}: ` : '', err.message || String(err)),
    err.hint ? h('div', { class: 'error-hint' }, err.hint) : null,
  );
}
