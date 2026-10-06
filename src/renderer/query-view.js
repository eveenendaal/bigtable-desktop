// One query tab: query editor, results grid and inspector.
import { h, icon, iconButton, replaceChildren, toast, popupMenu, formatError } from './dom.js';
import { rowsRequestFromForm, describeSavedQuery, mcpReferenceText } from '../shared/query.js';
import { toJSON, toNDJSON, toCSV, rowToPlain } from '../shared/export.js';
import { workspace, persist, flush, findProject, connFor, defaultSql } from './state.js';
import { ResultsGrid, collectColumns } from './grid.js';
import { Inspector } from './inspector.js';

let queryCounter = 0;

const FILE_FILTERS = {
  json: [{ name: 'JSON', extensions: ['json'] }],
  ndjson: [{ name: 'Newline-delimited JSON', extensions: ['ndjson', 'jsonl'] }],
  csv: [{ name: 'CSV', extensions: ['csv'] }],
};

export async function saveText(defaultPath, content, kind) {
  try {
    const file = await window.api.saveFile({ defaultPath, content, filters: FILE_FILTERS[kind] });
    if (file) toast(`Saved ${file.split(/[\\/]/).pop()}`, { action: { label: 'Show', run: () => window.api.revealFile(file) } });
  } catch (err) {
    toast(`Export failed: ${err.message}`, { kind: 'error' });
  }
}

function field(label, control, { className, help } = {}) {
  return h('label', { class: ['qfield', className] }, h('span', { class: 'qlabel' }, label), control, help ? h('span', { class: 'qhelp' }, help) : null);
}

export class QueryView {
  constructor(tab, { onTitleChange }) {
    this.tab = tab;
    this.onTitleChange = onTitleChange;
    this.result = null;
    this.running = false;
    this.error = null;
    this.families = undefined; // undefined = loading, null = unavailable
    this.selection = null;
    this.filter = '';
    this.columnFilter = '';

    this.el = h('div', { class: 'query-view' });
    this.editorEl = h('div', { class: 'query-editor' });
    this.statusEl = h('div', { class: 'results-bar' });
    this.gridEl = h('div', { class: 'grid-wrap' });
    this.messageEl = h('div', { class: 'results-message' });
    this.inspectorEl = h('aside', { class: 'inspector' });
    this.grid = new ResultsGrid(this.gridEl, { onSelect: (sel) => this.select(sel) });
    this.inspector = new Inspector(this.inspectorEl, {
      onClose: () => this.select(null),
      onSelectCell: (row, cell) => this.select({ row, cell }),
      loadHistory: (row, cell) => this.loadHistory(row, cell),
      saveText,
    });

    const resizer = h('div', { class: 'inspector-resizer', title: 'Drag to resize' });
    this.installResizer(resizer);

    this.el.append(
      this.editorEl,
      this.statusEl,
      h('div', { class: 'results-area' }, h('div', { class: 'results-main' }, this.messageEl, this.gridEl), resizer, this.inspectorEl),
    );
    this.renderEditor();
    this.renderStatus();
    this.inspector.render();
    this.loadFamilies();
  }

  get project() {
    return findProject(this.tab.projectKey);
  }

  get conn() {
    const project = this.project;
    if (project) return connFor(project);
    // Projects removed from the sidebar keep working for their open tabs.
    const [projectId, emulatorHost] = (this.tab.projectKey || '').split('@');
    return { projectId, emulatorHost: emulatorHost || undefined };
  }

  installResizer(handle) {
    handle.addEventListener('pointerdown', (event) => {
      handle.setPointerCapture(event.pointerId);
      const startX = event.clientX;
      const startWidth = this.inspectorEl.getBoundingClientRect().width;
      const move = (e) => {
        const width = Math.min(Math.max(startWidth + (startX - e.clientX), 280), window.innerWidth * 0.7);
        document.documentElement.style.setProperty('--inspector-width', `${width}px`);
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        workspace.settings.inspectorWidth = getComputedStyle(document.documentElement).getPropertyValue('--inspector-width').trim();
        persist();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }

  async loadFamilies() {
    const { tab } = this;
    if (!tab.tableId) return;
    try {
      this.families = await window.api.listFamilies(this.conn, tab.instanceId, tab.tableId);
    } catch {
      this.families = null; // Needs bigtable.tables.get; the free-form input still works.
    }
    this.renderFamilies();
  }

  /** Called when the tab is (re)bound to a different table. */
  rebind() {
    this.result = null;
    this.error = null;
    this.families = undefined;
    this.selection = null;
    this.renderEditor();
    this.renderStatus();
    this.renderResults();
    this.inspector.clear();
    this.loadFamilies();
  }

  // -------------------------------------------------------------------------
  // Editor
  // -------------------------------------------------------------------------

  renderEditor() {
    const { tab } = this;
    if (!tab.tableId) {
      replaceChildren(
        this.editorEl,
        h('div', { class: 'empty-tab' }, icon('table', { size: 32 }), h('h2', {}, 'Pick a table'), h('p', { class: 'muted' }, 'Select a table in the sidebar to start querying. Each tab keeps its own query, and tabs are restored when you reopen the app.')),
      );
      return;
    }

    const modeToggle = h(
      'div',
      { class: 'segmented' },
      [
        ['rows', 'Rows', 'Read rows by key, prefix or range'],
        ['sql', 'SQL', 'GoogleSQL for Bigtable'],
      ].map(([mode, label, title]) =>
        h(
          'button',
          {
            type: 'button',
            title,
            class: tab.mode === mode ? 'active' : '',
            onClick: () => {
              tab.mode = mode;
              persist();
              this.onTitleChange();
              this.renderEditor();
            },
          },
          label,
        ),
      ),
    );

    this.runButton = h('button', { type: 'button', class: 'btn primary run-btn', onClick: () => (this.running ? this.cancel() : this.run()) });
    this.updateRunButton();

    const breadcrumb = h(
      'div',
      { class: 'breadcrumb' },
      h('span', { class: 'crumb', title: tab.projectKey }, icon('project', { size: 13 }), tab.projectKey),
      h('span', { class: 'crumb-sep' }, '/'),
      h('span', { class: 'crumb' }, icon('instance', { size: 13 }), tab.instanceId),
      h('span', { class: 'crumb-sep' }, '/'),
      h('span', { class: 'crumb strong' }, icon('table', { size: 13 }), tab.tableId),
    );

    replaceChildren(
      this.editorEl,
      h('div', { class: 'editor-top' }, breadcrumb, h('div', { class: 'spacer' }), modeToggle, this.runButton),
      tab.mode === 'sql' ? this.sqlEditor() : this.rowsEditor(),
    );
  }

  updateRunButton() {
    if (!this.runButton) return;
    const mac = window.api.platform === 'darwin';
    replaceChildren(
      this.runButton,
      icon(this.running ? 'stop' : 'play', { size: 12 }),
      this.running ? ' Cancel' : ' Run',
      h('span', { class: 'kbd' }, this.running ? (mac ? '⌘.' : 'Ctrl+.') : mac ? '⌘↵' : 'Ctrl+↵'),
    );
    this.runButton.classList.toggle('danger', this.running);
  }

  bindInput(input, key, { number = false } = {}) {
    input.value = this.tab.query[key] ?? '';
    input.addEventListener('input', () => {
      this.tab.query[key] = number ? (input.value === '' ? '' : Number(input.value)) : input.value;
      persist();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && input.tagName !== 'TEXTAREA') this.run();
    });
    return input;
  }

  rowsEditor() {
    const q = this.tab.query;
    const keyInputs = h('div', { class: 'key-inputs' });
    const renderKeyInputs = () => {
      const mode = q.keyMode;
      if (mode === 'prefix') {
        replaceChildren(keyInputs, this.bindInput(h('input', { type: 'text', class: 'mono grow', placeholder: 'Row key prefix (empty = scan from the start)', spellcheck: false }), 'prefix'));
      } else if (mode === 'range') {
        replaceChildren(
          keyInputs,
          this.bindInput(h('input', { type: 'text', class: 'mono grow', placeholder: 'Start key (inclusive)', spellcheck: false }), 'start'),
          h('span', { class: 'muted' }, '→'),
          this.bindInput(h('input', { type: 'text', class: 'mono grow', placeholder: 'End key (exclusive)', spellcheck: false }), 'end'),
        );
      } else {
        replaceChildren(keyInputs, this.bindInput(h('textarea', { class: 'mono grow keys-input', rows: 2, placeholder: 'One row key per line', spellcheck: false }), 'keys'));
      }
    };
    renderKeyInputs();

    const keyMode = h(
      'div',
      { class: 'segmented small' },
      [
        ['prefix', 'Prefix'],
        ['range', 'Range'],
        ['keys', 'Keys'],
      ].map(([mode, label]) =>
        h(
          'button',
          {
            type: 'button',
            class: q.keyMode === mode ? 'active' : '',
            onClick: (event) => {
              q.keyMode = mode;
              persist();
              event.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === event.currentTarget));
              renderKeyInputs();
            },
          },
          label,
        ),
      ),
    );

    this.familiesEl = h('div', { class: 'family-chips' });
    this.renderFamilies();

    return h(
      'div',
      { class: 'rows-editor' },
      h('div', { class: 'qrow' }, field('Row keys', h('div', { class: 'key-row' }, keyMode, keyInputs), { className: 'grow', help: 'Use \\xNN for binary bytes.' })),
      h(
        'div',
        { class: 'qrow' },
        field('Column families', this.familiesEl, { className: 'families-field' }),
        field('Column qualifier (regex)', this.bindInput(h('input', { type: 'text', class: 'mono', placeholder: 'e.g. ^status', spellcheck: false }), 'qualifierRegex')),
        field('Value (regex)', this.bindInput(h('input', { type: 'text', class: 'mono', placeholder: 'e.g. .*"active".*', spellcheck: false }), 'valueRegex')),
      ),
      h(
        'div',
        { class: 'qrow' },
        field('Versions per cell', this.bindInput(h('input', { type: 'number', min: 1, max: 1000, class: 'narrow', placeholder: 'all' }), 'versions', { number: true }), { help: 'Empty = all versions' }),
        field('Written after', this.bindInput(h('input', { type: 'datetime-local', step: 1 }), 'timeStart')),
        field('Written before', this.bindInput(h('input', { type: 'datetime-local', step: 1 }), 'timeEnd')),
        field('Row limit', this.bindInput(h('input', { type: 'number', min: 1, max: 10000, class: 'narrow' }), 'limit', { number: true })),
      ),
    );
  }

  renderFamilies() {
    if (!this.familiesEl) return;
    const q = this.tab.query;
    if (this.families === undefined) {
      replaceChildren(this.familiesEl, h('span', { class: 'muted' }, 'Loading…'));
      return;
    }
    if (this.families === null) {
      replaceChildren(this.familiesEl, this.bindFamiliesText());
      return;
    }
    const selected = new Set(q.families);
    replaceChildren(
      this.familiesEl,
      this.families.length
        ? this.families.map((family) =>
            h(
              'button',
              {
                type: 'button',
                class: ['chip', selected.has(family) && 'active'],
                title: selected.has(family) ? 'Click to stop filtering on this family' : 'Only read this family',
                onClick: (event) => {
                  if (selected.has(family)) selected.delete(family);
                  else selected.add(family);
                  q.families = [...selected];
                  persist();
                  event.currentTarget.classList.toggle('active', selected.has(family));
                },
              },
              family,
            ),
          )
        : h('span', { class: 'muted' }, 'No column families'),
      selected.size ? null : h('span', { class: 'muted small' }, 'all families'),
    );
  }

  bindFamiliesText() {
    const input = h('input', { type: 'text', class: 'mono', placeholder: 'family1, family2', spellcheck: false, value: this.tab.query.families.join(', ') });
    input.addEventListener('input', () => {
      this.tab.query.families = input.value.split(',').map((s) => s.trim()).filter(Boolean);
      persist();
    });
    return input;
  }

  sqlEditor() {
    const { tab } = this;
    const textarea = h('textarea', { class: 'mono sql-input', rows: 6, spellcheck: false, placeholder: defaultSql(tab.tableId) });
    textarea.value = tab.sql;
    textarea.addEventListener('input', () => {
      tab.sql = textarea.value;
      persist();
    });
    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Tab') {
        event.preventDefault();
        textarea.setRangeText('  ', textarea.selectionStart, textarea.selectionEnd, 'end');
        tab.sql = textarea.value;
        persist();
      }
    });
    const limit = h('input', { type: 'number', min: 1, max: 10000, class: 'narrow', value: tab.sqlLimit });
    limit.addEventListener('input', () => {
      tab.sqlLimit = Number(limit.value) || 1000;
      persist();
    });
    const docs = h(
      'button',
      { type: 'button', class: 'link-btn', onClick: () => window.api.openExternal('https://cloud.google.com/bigtable/docs/googlesql-overview') },
      'GoogleSQL reference ',
      icon('external', { size: 11 }),
    );
    return h(
      'div',
      { class: 'sql-editor' },
      textarea,
      h(
        'div',
        { class: 'qrow sql-footer' },
        field('Max rows', limit),
        h(
          'div',
          { class: 'sql-tips muted' },
          'Column families come back as maps and are shown as family:qualifier columns. Add ',
          h('code', {}, `FROM \`${tab.tableId}\`(with_history => TRUE)`),
          ' to see versions with timestamps. ',
          docs,
        ),
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Running queries
  // -------------------------------------------------------------------------

  async run({ more = false } = {}) {
    const { tab } = this;
    if (!tab.tableId || this.running) return;
    const queryId = `q${++queryCounter}`;
    this.queryId = queryId;
    this.running = true;
    this.error = null;
    this.updateRunButton();
    this.renderStatus();
    const started = performance.now();
    try {
      let response;
      if (tab.mode === 'sql') {
        response = await window.api.executeSql(this.conn, { queryId, instanceId: tab.instanceId, sql: tab.sql, limit: tab.sqlLimit });
      } else {
        response = await window.api.readRows(this.conn, {
          queryId,
          instanceId: tab.instanceId,
          tableId: tab.tableId,
          query: rowsRequestFromForm(this.tab.query),
          afterKey: more ? this.result?.lastKey : null,
        });
      }
      if (this.queryId !== queryId) return;
      const source = tab.mode === 'sql' ? 'sql' : 'rows';
      if (more && this.result) {
        this.result = {
          ...this.result,
          rows: [...this.result.rows, ...response.rows],
          hasMore: response.hasMore,
          lastKey: response.lastKey ?? this.result.lastKey,
          elapsedMs: this.result.elapsedMs + response.elapsedMs,
          cancelled: response.cancelled,
        };
      } else {
        this.result = { ...response, source, versionsLimit: source === 'rows' ? this.tab.query.versions : null };
        this.selection = null;
        this.inspector.clear();
      }
      this.result.roundTripMs = Math.round(performance.now() - started);
      tab.lastRunAt = Date.now();
      persist();
    } catch (err) {
      if (this.queryId !== queryId) return;
      this.error = err;
      if (!more) {
        this.result = null;
        this.select(null);
      }
    } finally {
      if (this.queryId === queryId) {
        this.running = false;
        this.updateRunButton();
        this.renderStatus();
        this.renderResults();
      }
    }
  }

  cancel() {
    if (!this.running) return;
    window.api.cancel(this.queryId);
  }

  async loadHistory(row, cell) {
    return window.api.readCellHistory(this.conn, {
      instanceId: this.tab.instanceId,
      tableId: this.tab.tableId,
      rowKey: row.key,
      family: cell.family,
      qualifier: cell.qualifier,
    });
  }

  select(selection) {
    this.selection = selection;
    this.el.classList.toggle('inspector-open', Boolean(selection));
    if (selection) this.inspector.show(selection);
    else this.inspector.clear();
    if (!selection) this.gridEl.querySelectorAll('.selected').forEach((n) => n.classList.remove('selected'));
  }

  // -------------------------------------------------------------------------
  // Results
  // -------------------------------------------------------------------------

  renderStatus() {
    const r = this.result;
    const parts = [];
    if (this.running) {
      parts.push(h('span', { class: 'spinner' }), h('span', {}, 'Running…'));
    } else if (r) {
      const columns = collectColumns(r).length;
      parts.push(
        h('span', { class: 'stat' }, h('strong', {}, String(r.rows.length)), ` row${r.rows.length === 1 ? '' : 's'}`),
        h('span', { class: 'stat' }, h('strong', {}, String(columns)), ` column${columns === 1 ? '' : 's'}`),
        h('span', { class: 'stat muted' }, `${r.roundTripMs ?? r.elapsedMs} ms`),
      );
      if (r.cancelled) parts.push(h('span', { class: 'pill warn' }, 'cancelled'));
      if (r.hasMore && r.source === 'rows') {
        parts.push(h('button', { type: 'button', class: 'btn small', onClick: () => this.run({ more: true }) }, 'Load more'));
      } else if (r.hasMore) {
        parts.push(h('span', { class: 'pill warn' }, 'row limit reached'));
      }
    } else if (!this.error) {
      parts.push(h('span', { class: 'muted' }, this.tab.tableId ? 'Run the query to see results.' : ''));
    }

    const filterInput = h('input', {
      type: 'search',
      class: 'results-filter',
      placeholder: 'Find in results…',
      value: this.filter,
      spellcheck: false,
      onInput: (event) => {
        this.filter = event.target.value;
        this.renderGrid();
      },
    });
    const columnInput = h('input', {
      type: 'search',
      class: 'results-filter',
      placeholder: 'Filter columns…',
      value: this.columnFilter,
      spellcheck: false,
      onInput: (event) => {
        this.columnFilter = event.target.value;
        this.renderGrid();
      },
    });
    const exportButton = h(
      'button',
      { type: 'button', class: 'btn small export-btn', disabled: !r?.rows.length, onClick: (event) => this.showExportMenu(event.currentTarget) },
      icon('download', { size: 13 }),
      ' Export',
    );
    replaceChildren(
      this.statusEl,
      h('div', { class: 'results-stats' }, parts),
      h('div', { class: 'spacer' }),
      r ? filterInput : null,
      r ? columnInput : null,
      exportButton,
    );
  }

  showExportMenu(anchor) {
    popupMenu(anchor, [
      { label: 'JSON — all versions with timestamps', onClick: () => this.export('json') },
      { label: 'JSON — latest values only', onClick: () => this.export('json-latest') },
      { label: 'NDJSON — one row per line', onClick: () => this.export('ndjson') },
      'separator',
      { label: 'CSV — latest values', onClick: () => this.export('csv') },
      { label: 'CSV — latest values + timestamps', onClick: () => this.export('csv-ts') },
      'separator',
      { label: 'Copy as JSON', hint: 'clipboard', onClick: () => this.export('copy') },
      { label: 'Copy MCP reference', hint: 'for Claude Code', onClick: () => this.copyMcpReference() },
    ]);
  }

  exportSlug() {
    const stamp = new Date().toISOString().replace(/[:]/g, '').replace(/\..+/, '');
    return `${this.tab.tableId || 'results'}-${stamp}`;
  }

  async export(kind) {
    const result = this.result;
    if (!result?.rows.length) return;
    const base = this.exportSlug();
    switch (kind) {
      case 'json':
        return saveText(`${base}.json`, toJSON(result, { allVersions: true }), 'json');
      case 'json-latest':
        return saveText(`${base}.json`, toJSON(result, { allVersions: false }), 'json');
      case 'ndjson':
        return saveText(`${base}.ndjson`, toNDJSON(result, { allVersions: true }), 'ndjson');
      case 'csv':
        return saveText(`${base}.csv`, toCSV(result), 'csv');
      case 'csv-ts':
        return saveText(`${base}.csv`, toCSV(result, { includeTimestamps: true }), 'csv');
      case 'copy':
        await window.api.copyText(toJSON(result, { allVersions: true }));
        return toast(`Copied ${result.rows.length} rows as JSON`);
      default:
        return undefined;
    }
  }

  /**
   * Snapshots the current results for the MCP server's get_query_results tool and
   * copies a reference that points Claude Code at this query and its results.
   */
  async copyMcpReference() {
    const { tab, result } = this;
    try {
      await flush(); // the MCP server reads the saved query from the workspace file
      const snapshot = {
        ...describeSavedQuery(tab),
        capturedAt: new Date().toISOString(),
        rowCount: result.rows.length,
        hasMore: Boolean(result.hasMore),
        rows: result.rows.map((row) => rowToPlain(row)),
      };
      await window.api.saveResultSnapshot(tab.id, snapshot);
      await window.api.copyText(mcpReferenceText(tab, snapshot));
      toast('MCP reference copied. Paste it into Claude Code.');
    } catch (err) {
      toast(`Could not copy the MCP reference: ${err.message}`, { kind: 'error' });
    }
  }

  renderResults() {
    if (this.error) {
      replaceChildren(this.messageEl, formatError(this.error));
    } else {
      replaceChildren(this.messageEl);
    }
    this.renderGrid();
  }

  renderGrid() {
    this.grid.render(this.result, {
      filter: this.filter,
      columnFilter: this.columnFilter,
      timeZone: workspace.settings.timeZone,
      selection: this.selection,
    });
  }

  /** Re-renders time-dependent parts (e.g. after switching between UTC and local time). */
  refreshTimes() {
    this.renderGrid();
    this.inspector.render();
  }
}
