// Modal dialogs built on <dialog>.
import { h, clear, formatError, icon, toast } from './dom.js';
import { workspace, persist } from './state.js';

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

function copyBlock(text, label) {
  return h(
    'div',
    { class: 'copy-block' },
    h('pre', { class: 'code' }, text),
    h(
      'button',
      { type: 'button', class: 'btn small', onClick: () => window.api.copyText(text).then(() => toast(`${label} copied`)) },
      icon('copy', { size: 13 }),
      ' Copy',
    ),
  );
}

/** Shows where the built-in MCP server is listening and registers it with Claude Code. */
export function connectClaudeDialog() {
  return openDialog((dialog, done) => {
    dialog.classList.add('wide');
    const server = h('div', { class: 'connect-server muted' }, h('span', { class: 'spinner' }), ' Starting the MCP server…');
    const status = h('div', { class: 'connect-status muted' }, h('span', { class: 'spinner' }), ' Looking for Claude Code…');
    const commandSlot = h('div', {});
    const jsonSlot = h('div', {});

    dialog.append(
      h('h2', {}, 'Connect to Claude Code'),
      h(
        'p',
        { class: 'muted' },
        'While Bigtable Desktop is open, it runs an MCP server on localhost that gives Claude Code read-only access to your Bigtable data. It uses the same Google credentials, projects and saved queries as the app.',
      ),
      h(
        'ul',
        { class: 'connect-tools' },
        h('li', {}, 'List projects, instances, clusters, tables and column families'),
        h('li', {}, 'Read rows and full cell history, with JSON values and timestamps'),
        h('li', {}, 'Run GoogleSQL, and run the queries saved in your tabs'),
      ),
      server,
      status,
      h('h3', {}, 'Or run this in a terminal'),
      commandSlot,
      h('details', { class: 'connect-json' }, h('summary', {}, 'Configuration for other MCP clients (JSON)'), jsonSlot),
      h('div', { class: 'dialog-actions' }, h('button', { type: 'button', class: 'btn', onClick: () => done(null) }, 'Done')),
    );

    const showServer = (info) => {
      clear(server);
      clear(commandSlot);
      clear(jsonSlot);
      commandSlot.append(copyBlock(info.command, 'Command'));
      jsonSlot.append(copyBlock(info.json, 'Configuration'));
      server.classList.remove('muted');
      const port = h('input', { type: 'number', min: 1024, max: 65535, required: true, value: info.port });
      const apply = h('button', { type: 'submit', class: 'btn small' }, 'Change port');
      const form = h(
        'form',
        {
          class: 'connect-row',
          onSubmit: async (event) => {
            event.preventDefault();
            apply.disabled = true;
            try {
              const next = await window.api.setMcpPort(Number(port.value));
              showServer(next);
              if (next.running) {
                workspace.settings.mcpPort = next.port;
                persist();
                toast('MCP server restarted. Add it to Claude Code again to use the new port.');
              }
            } catch (err) {
              toast(err.message, { kind: 'error' });
              apply.disabled = false;
            }
          },
        },
        h('span', { class: 'muted' }, 'Port'),
        port,
        apply,
      );
      server.append(
        info.running
          ? h('div', { class: 'connect-row' }, h('span', { class: 'connect-dot' }), h('span', {}, 'Running at ', h('span', { class: 'mono' }, info.url)))
          : h('div', { class: 'connect-result error' }, `The MCP server is not running. ${info.error || ''}`),
        form,
      );
    };

    window.api
      .mcpConfig()
      .then((info) => {
        showServer(info);
        clear(status);
        if (!info.claudePath) {
          status.append('The Claude Code CLI was not found on this computer. Install Claude Code, then run the command below.');
          return;
        }
        const result = h('div', { class: 'connect-result' });
        const button = h(
          'button',
          {
            type: 'button',
            class: 'btn primary',
            onClick: async () => {
              button.disabled = true;
              button.textContent = 'Adding…';
              const res = await window.api.installMcp().catch((err) => ({ ok: false, message: err.message }));
              button.disabled = false;
              button.textContent = res.ok ? 'Added ✓' : 'Add to Claude Code';
              replaceResult(result, res);
            },
          },
          'Add to Claude Code',
        );
        status.classList.remove('muted');
        status.append(
          h('div', { class: 'connect-row' }, button, h('span', { class: 'muted small mono' }, info.claudePath)),
          h('div', { class: 'muted small' }, 'Adds the server for all your projects (user scope). Running it again updates the registration.'),
          result,
        );
      })
      .catch((err) => {
        clear(server);
        clear(status);
        status.append(formatError(err));
      });
  });
}

function replaceResult(el, res) {
  clear(el);
  el.className = ['connect-result', res.ok ? 'ok' : 'error'].join(' ');
  el.append(
    res.ok ? 'Added. Start a new Claude Code session and ask about your Bigtable data, or run /mcp to check the connection.' : res.message,
  );
}
