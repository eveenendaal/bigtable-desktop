// Cell / row inspector: version history with readable timestamps, JSON viewing and diffs.
import { h, icon, iconButton, replaceChildren, toast, formatError } from './dom.js';
import { describeValue, columnId } from '../shared/cells.js';
import { displayBytes, toHex, formatSize } from '../shared/bytes.js';
import { formatTimestamp, formatDuration, microsToIso } from '../shared/time.js';
import { diffLines, diffStats } from '../shared/diff.js';
import { cellToJSON, rowToPlain } from '../shared/export.js';
import { renderJsonText, renderJsonTree, highlightJsonLine, prettyJson } from './json-view.js';
import { workspace, persist } from './state.js';

const VIEW_LABELS = { pretty: 'Pretty', tree: 'Tree', raw: 'Raw', hex: 'Hex' };
const MAX_HEX_BYTES = 64 * 1024;

function hexDump(bytes) {
  const lines = [];
  const view = bytes.subarray(0, MAX_HEX_BYTES);
  for (let offset = 0; offset < view.length; offset += 16) {
    const chunk = view.subarray(offset, offset + 16);
    const hex = toHex(chunk, { separator: ' ' }).padEnd(47, ' ');
    const ascii = Array.from(chunk, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${offset.toString(16).padStart(8, '0')}  ${hex}  ${ascii}`);
  }
  if (bytes.length > MAX_HEX_BYTES) lines.push(`… ${formatSize(bytes.length - MAX_HEX_BYTES)} more`);
  return lines.join('\n');
}

function comparableText(bytes) {
  const desc = describeValue(bytes);
  if (desc.kind === 'json') return { text: prettyJson(desc.json), json: true };
  if (desc.kind === 'text' || desc.kind === 'empty') return { text: desc.text, json: false };
  return { text: hexDump(bytes), json: false };
}

function kindLabel(desc) {
  switch (desc.kind) {
    case 'json':
      return 'JSON';
    case 'text':
      return 'Text';
    case 'empty':
      return 'Empty';
    default:
      return desc.int64 !== undefined ? 'Int64 / binary' : 'Binary';
  }
}

export class Inspector {
  /**
   * @param {HTMLElement} el
   * @param {{onClose: Function, loadHistory?: (row, cell) => Promise<object[]>, onSelectCell: Function, saveText: Function}} options
   */
  constructor(el, options) {
    this.el = el;
    this.options = options;
    this.selection = null;
    this.versionIndex = 0;
    this.compare = false;
  }

  /** selection: {row, cell} or {row} */
  show(selection) {
    const sameCell = this.selection && selection && this.selection.row === selection.row && this.selection.cell === selection.cell;
    this.selection = selection;
    if (!sameCell) {
      this.versionIndex = 0;
      this.historyError = null;
    }
    this.render();
  }

  clear() {
    this.selection = null;
    this.render();
  }

  get view() {
    return workspace.settings.valueView || 'pretty';
  }

  set view(value) {
    workspace.settings.valueView = value;
    persist();
  }

  render() {
    const sel = this.selection;
    if (!sel) {
      replaceChildren(
        this.el,
        h('div', { class: 'inspector-empty' }, icon('json', { size: 28 }), h('p', {}, 'Select a cell to see its value and version history.'), h('p', { class: 'muted' }, 'Click a row key to see the whole row.')),
      );
      return;
    }
    if (sel.cell) this.renderCell(sel.row, sel.cell);
    else this.renderRow(sel.row);
  }

  header(title, subtitle, actions) {
    return h(
      'div',
      { class: 'inspector-header' },
      h('div', { class: 'inspector-titles' }, h('div', { class: 'inspector-title mono', title }, title), h('div', { class: 'inspector-subtitle mono', title: subtitle }, icon('key', { size: 12 }), ' ', subtitle)),
      h('div', { class: 'inspector-actions' }, actions, iconButton('x', 'Close inspector', () => this.options.onClose())),
    );
  }

  renderRow(row) {
    const tz = workspace.settings.timeZone;
    const keyText = displayBytes(row.key);
    const plain = rowToPlain(row, { allVersions: false });
    const json = JSON.stringify(plain, null, 2);
    const columns = row.cells.map((cell) => {
      const latest = cell.versions[0];
      const ts = latest?.timestampMicros ? formatTimestamp(latest.timestampMicros, { timeZone: tz }) : null;
      const desc = describeValue(latest?.value);
      return h(
        'button',
        { type: 'button', class: 'row-column', onClick: () => this.options.onSelectCell(row, cell) },
        h('span', { class: 'row-column-name mono' }, cell.family ? columnId(cell.family, cell.qualifier) : displayBytes(cell.qualifier)),
        h('span', { class: 'row-column-meta' }, kindLabel(desc), ' · ', formatSize(desc.size), cell.versions.length > 1 ? ` · ${cell.versions.length} versions` : ''),
        ts ? h('span', { class: 'row-column-time', title: ts.iso }, ts.relative) : null,
      );
    });
    replaceChildren(
      this.el,
      this.header('Row', keyText, [
        iconButton('copy', 'Copy row as JSON', () => window.api.copyText(json).then(() => toast('Row copied as JSON'))),
        iconButton('download', 'Export row (all versions)', () =>
          this.options.saveText(`row-${keyText.replace(/[^\w.-]+/g, '_').slice(0, 60)}.json`, JSON.stringify(rowToPlain(row), null, 2), 'json'),
        ),
      ]),
      h('div', { class: 'inspector-section-title' }, `${row.cells.length} column${row.cells.length === 1 ? '' : 's'}`),
      h('div', { class: 'row-columns' }, columns),
      h('div', { class: 'inspector-section-title' }, 'Latest values'),
      h('div', { class: 'value-body' }, renderJsonText(plain)),
    );
  }

  renderCell(row, cell) {
    const tz = workspace.settings.timeZone;
    const versions = cell.versions;
    if (this.versionIndex >= versions.length) this.versionIndex = 0;
    const version = versions[this.versionIndex];
    const colName = cell.family ? columnId(cell.family, cell.qualifier) : displayBytes(cell.qualifier);
    const keyText = displayBytes(row.key);

    const versionList = h(
      'div',
      { class: 'version-list', role: 'listbox', 'aria-label': 'Cell versions' },
      versions.map((v, i) => this.versionItem(v, i, versions, tz)),
    );

    const history = this.historyControls(row, cell);
    const valuePane = this.valuePane(version, versions[this.versionIndex + 1]);

    replaceChildren(
      this.el,
      this.header(colName, keyText, [
        iconButton('copy', 'Copy value', () => {
          const { text } = comparableText(version.value);
          window.api.copyText(text).then(() => toast('Value copied'));
        }),
        iconButton('download', 'Export cell with all versions (JSON)', () =>
          this.options.saveText(`cell-${colName.replace(/[^\w.-]+/g, '_')}.json`, cellToJSON(row.key, cell), 'json'),
        ),
      ]),
      h(
        'div',
        { class: 'inspector-section-title' },
        h('span', {}, icon('history', { size: 13 }), ` ${versions.length} version${versions.length === 1 ? '' : 's'}`),
        history,
      ),
      versionList,
      valuePane,
    );
    versionList.querySelector('.version.selected')?.scrollIntoView({ block: 'nearest' });
  }

  historyControls(row, cell) {
    if (!this.options.loadHistory || !cell.family || row.synthetic) return null;
    if (cell.fullHistory) return h('span', { class: 'muted small' }, 'full history loaded');
    if (this.historyError) {
      return h('span', { class: 'error-inline', title: this.historyError.hint || '' }, this.historyError.message);
    }
    return h(
      'button',
      {
        type: 'button',
        class: 'link-btn',
        disabled: this.loadingHistory,
        onClick: async () => {
          this.loadingHistory = true;
          this.render();
          try {
            const versions = await this.options.loadHistory(row, cell);
            if (versions.length) cell.versions = versions;
            cell.fullHistory = true;
            toast(`Loaded ${versions.length} version${versions.length === 1 ? '' : 's'}`);
          } catch (err) {
            this.historyError = err;
          } finally {
            this.loadingHistory = false;
            this.render();
          }
        },
      },
      this.loadingHistory ? 'Loading…' : 'Load full history',
    );
  }

  versionItem(v, i, versions, tz) {
    const ts = v.timestampMicros ? formatTimestamp(v.timestampMicros, { timeZone: tz }) : null;
    const older = versions[i + 1];
    const desc = describeValue(v.value);
    let delta = null;
    if (ts && older?.timestampMicros) {
      const olderMs = Number(BigInt(older.timestampMicros) / 1000n);
      delta = `${formatDuration(ts.ms - olderMs)} after previous`;
    }
    return h(
      'button',
      {
        type: 'button',
        role: 'option',
        'aria-selected': String(i === this.versionIndex),
        class: ['version', i === this.versionIndex && 'selected'],
        title: ts ? `${ts.iso}\n${ts.micros} µs since epoch` : 'No timestamp',
        onClick: () => {
          this.versionIndex = i;
          this.render();
        },
      },
      h('div', { class: 'v-rail' }, h('span', { class: ['v-dot', i === 0 && 'latest'] })),
      h(
        'div',
        { class: 'v-body' },
        ts
          ? [
              h(
                'div',
                { class: 'v-head' },
                h('span', { class: 'v-time' }, ts.time, h('span', { class: 'v-frac' }, ts.fraction, ts.subMillis ? h('span', { class: 'v-micro' }, ts.subMillis) : null)),
                h('span', { class: 'v-zone' }, ts.zone),
                i === 0 ? h('span', { class: 'pill accent' }, 'Latest') : h('span', { class: 'pill' }, `#${i + 1}`),
              ),
              h('div', { class: 'v-date' }, ts.date, h('span', { class: 'v-rel' }, ` · ${ts.relative}`)),
              h('div', { class: 'v-meta' }, [kindLabel(desc), formatSize(desc.size), delta].filter(Boolean).join(' · ')),
            ]
          : [
              h('div', { class: 'v-head' }, h('span', { class: 'v-time' }, 'No timestamp'), i === 0 ? h('span', { class: 'pill accent' }, 'Latest') : null),
              h('div', { class: 'v-meta' }, `${kindLabel(desc)} · ${formatSize(desc.size)}`),
            ],
      ),
    );
  }

  valuePane(version, older) {
    const desc = describeValue(version.value);
    const views = desc.kind === 'json' ? ['pretty', 'tree', 'raw', 'hex'] : desc.kind === 'binary' ? ['hex', 'raw'] : ['raw', 'hex'];
    let view = this.view;
    if (!views.includes(view)) view = views[0];

    const toolbar = h(
      'div',
      { class: 'value-toolbar' },
      h(
        'div',
        { class: 'segmented small' },
        views.map((v) =>
          h(
            'button',
            {
              type: 'button',
              class: v === view && !this.compare ? 'active' : '',
              onClick: () => {
                this.view = v;
                this.compare = false;
                this.render();
              },
            },
            VIEW_LABELS[v],
          ),
        ),
      ),
      h(
        'button',
        {
          type: 'button',
          class: ['btn small', this.compare && 'active'],
          disabled: !older,
          title: older ? 'Compare with the previous (older) version' : 'No older version to compare with',
          onClick: () => {
            this.compare = !this.compare;
            this.render();
          },
        },
        icon('diff', { size: 13 }),
        ' Diff vs previous',
      ),
      desc.int64 !== undefined ? h('span', { class: 'pill', title: '64-bit big-endian integer interpretation' }, `int64 ${desc.int64}`) : null,
    );

    let body;
    if (this.compare && older) {
      body = this.renderDiff(older, version);
    } else if (desc.kind === 'empty') {
      body = h('div', { class: 'muted pad' }, 'Empty value');
    } else if (view === 'pretty') {
      body = renderJsonText(desc.json);
    } else if (view === 'tree') {
      body = renderJsonTree(desc.json);
    } else if (view === 'hex') {
      body = h('pre', { class: 'code hex' }, hexDump(version.value));
    } else {
      body = h('pre', { class: 'code raw' }, desc.text ?? Array.from(version.value, (b) => String.fromCharCode(b)).join(''));
    }

    return h('div', { class: 'value-pane' }, toolbar, h('div', { class: 'value-body' }, body));
  }

  renderDiff(older, newer) {
    const a = comparableText(older.value);
    const b = comparableText(newer.value);
    const entries = diffLines(a.text, b.text);
    const stats = diffStats(entries);
    const tz = workspace.settings.timeZone;
    const label = (v) => (v.timestampMicros ? formatTimestamp(v.timestampMicros, { timeZone: tz }) : null);
    const la = label(older);
    const lb = label(newer);
    const highlight = a.json && b.json;
    return h(
      'div',
      { class: 'diff' },
      h(
        'div',
        { class: 'diff-summary' },
        h('span', { class: 'diff-del-count' }, `−${stats.removed}`),
        ' ',
        h('span', { class: 'diff-add-count' }, `+${stats.added}`),
        h('span', { class: 'muted' }, la && lb ? `  ${la.time}${la.fraction} → ${lb.time}${lb.fraction} (${formatDuration(lb.ms - la.ms)} later)` : ''),
      ),
      stats.added + stats.removed === 0
        ? h('div', { class: 'muted pad' }, 'Values are identical.')
        : h(
            'pre',
            { class: 'code diff-text' },
            entries.map((e) =>
              h(
                'div',
                { class: ['code-line', `diff-${e.type}`] },
                h('span', { class: 'ln' }, e.type === 'add' ? '+' : e.type === 'del' ? '−' : ' '),
                h('span', { class: 'lc' }, highlight ? highlightJsonLine(e.text) : e.text),
              ),
            ),
          ),
    );
  }
}

export function timestampTooltip(micros, tz) {
  const ts = formatTimestamp(micros, { timeZone: tz });
  if (!ts) return '';
  return `${ts.date} ${ts.time}${ts.fraction} ${ts.zone} (${ts.relative})\n${microsToIso(micros)}`;
}

export { formatError };
