// Modal dialogs built on <dialog>.
import { h, clear, formatError } from './dom.js';

function openDialog(build) {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'modal' });
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      done(null);
    });
    build(dialog, done);
    document.body.append(dialog);
    dialog.showModal();
    dialog.querySelector('input:not([type=checkbox]), textarea, button.primary')?.focus();
  });
}

/**
 * Shows a form with the given fields and resolves with the values or null.
 * fields: [{name, label, placeholder?, value?, help?, required?, type?}]
 */
export function formDialog({ title, description, fields, submitLabel = 'OK' }) {
  return openDialog((dialog, done) => {
    const inputs = {};
    const form = h(
      'form',
      {
        method: 'dialog',
        onSubmit: (event) => {
          event.preventDefault();
          const values = {};
          for (const [name, input] of Object.entries(inputs)) values[name] = input.type === 'checkbox' ? input.checked : input.value.trim();
          done(values);
        },
      },
      h('h2', {}, title),
      description ? h('p', { class: 'muted' }, description) : null,
      fields.map((field) => {
        const input = h('input', {
          name: field.name,
          type: field.type || 'text',
          placeholder: field.placeholder || '',
          value: field.value ?? '',
          required: field.required,
          spellcheck: false,
          autocomplete: 'off',
          pattern: field.pattern,
        });
        inputs[field.name] = input;
        return h('label', { class: 'field' }, h('span', { class: 'field-label' }, field.label), input, field.help ? h('span', { class: 'field-help' }, field.help) : null);
      }),
      h(
        'div',
        { class: 'dialog-actions' },
        h('button', { type: 'button', class: 'btn', onClick: () => done(null) }, 'Cancel'),
        h('button', { type: 'submit', class: 'btn primary' }, submitLabel),
      ),
    );
    dialog.append(form);
  });
}

export function confirmDialog({ title, message, confirmLabel = 'OK', danger = false }) {
  return openDialog((dialog, done) => {
    dialog.append(
      h('h2', {}, title),
      h('p', {}, message),
      h(
        'div',
        { class: 'dialog-actions' },
        h('button', { type: 'button', class: 'btn', onClick: () => done(false) }, 'Cancel'),
        h('button', { type: 'button', class: ['btn', danger ? 'danger' : 'primary'], onClick: () => done(true) }, confirmLabel),
      ),
    );
  });
}

/** Lists projects visible to the signed-in account and lets the user pick which to add. */
export function discoverProjectsDialog(existingIds) {
  return openDialog((dialog, done) => {
    const selected = new Set();
    let projects = [];
    const filter = h('input', { type: 'search', placeholder: 'Filter projects…', spellcheck: false, onInput: () => renderList() });
    const list = h('div', { class: 'discover-list' }, h('div', { class: 'muted pad' }, 'Loading projects from Cloud Resource Manager…'));
    const addButton = h('button', { type: 'button', class: 'btn primary', disabled: true, onClick: () => done([...selected]) }, 'Add projects');

    const renderList = () => {
      clear(list);
      const q = filter.value.trim().toLowerCase();
      const visible = projects.filter((p) => !q || p.id.toLowerCase().includes(q) || p.displayName.toLowerCase().includes(q));
      if (!visible.length) list.append(h('div', { class: 'muted pad' }, projects.length ? 'No matching projects.' : 'No projects found.'));
      for (const p of visible) {
        const already = existingIds.has(p.id);
        const checkbox = h('input', {
          type: 'checkbox',
          checked: already || selected.has(p.id),
          disabled: already,
          onChange: (event) => {
            if (event.target.checked) selected.add(p.id);
            else selected.delete(p.id);
            addButton.disabled = selected.size === 0;
            addButton.textContent = selected.size ? `Add ${selected.size} project${selected.size > 1 ? 's' : ''}` : 'Add projects';
          },
        });
        list.append(
          h(
            'label',
            { class: ['discover-item', already && 'disabled'] },
            checkbox,
            h('span', { class: 'discover-name' }, p.displayName),
            h('span', { class: 'discover-id mono' }, p.id),
            already ? h('span', { class: 'pill' }, 'added') : null,
          ),
        );
      }
    };

    dialog.classList.add('wide');
    dialog.append(
      h('h2', {}, 'Discover projects'),
      h('p', { class: 'muted' }, 'Projects your Application Default Credentials can see.'),
      filter,
      list,
      h('div', { class: 'dialog-actions' }, h('button', { type: 'button', class: 'btn', onClick: () => done(null) }, 'Cancel'), addButton),
    );

    window.api
      .listProjects()
      .then((result) => {
        projects = result;
        renderList();
        filter.focus();
      })
      .catch((err) => {
        clear(list);
        list.append(formatError(err));
      });
  });
}
