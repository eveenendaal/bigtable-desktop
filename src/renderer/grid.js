// Results grid: one row per Bigtable row, one column per family:qualifier.
import { h, icon } from './dom.js';
import { describeValue, previewValue, columnId } from '../shared/cells.js';
import { displayBytes } from '../shared/bytes.js';
import { timestampTooltip } from './inspector.js';

const MAX_COLUMNS = 400;

/** Collects the distinct columns of a result. */
export function collectColumns(result) {
  const map = new Map();
  for (const row of result.rows) {
    for (const cell of row.cells) {
      const id = cell.family ? columnId(cell.family, cell.qualifier) : `:${displayBytes(cell.qualifier)}`;
      if (!map.has(id)) map.set(id, { id, family: cell.family, qualifier: displayBytes(cell.qualifier), order: map.size });
    }
  }
  const columns = [...map.values()];
  if (result.source === 'rows') {
    columns.sort((a, b) => a.family.localeCompare(b.family) || a.qualifier.localeCompare(b.qualifier));
  }
  return columns;
}

const cellKey = (cell) => (cell.family ? columnId(cell.family, cell.qualifier) : `:${displayBytes(cell.qualifier)}`);

export class ResultsGrid {
  constructor(el, { onSelect }) {
    this.el = el;
    this.onSelect = onSelect;
    this.el.tabIndex = 0;
    this.el.addEventListener('keydown', (event) => this.onKey(event));
  }

  render(result, { filter = '', columnFilter = '', timeZone = 'local', selection = null } = {}) {
    this.result = result;
    this.el.replaceChildren();
    if (!result) return;
    let columns = collectColumns(result);
    const totalColumns = columns.length;
    if (columnFilter) {
      const q = columnFilter.toLowerCase();
      columns = columns.filter((c) => c.id.toLowerCase().includes(q));
    }
    const truncatedColumns = columns.length > MAX_COLUMNS;
    if (truncatedColumns) columns = columns.slice(0, MAX_COLUMNS);
    this.columns = columns;

    const q = filter.trim().toLowerCase();
    const rows = [];
    result.rows.forEach((row, index) => {
      const cellsById = new Map(row.cells.map((c) => [cellKey(c), c]));
      const key = displayBytes(row.key);
      const previews = columns.map((col) => {
        const cell = cellsById.get(col.id);
        if (!cell) return null;
        const desc = describeValue(cell.versions[0]?.value);
        return { cell, desc, text: previewValue(desc) };
      });
      if (q && !key.toLowerCase().includes(q) && !previews.some((p) => p?.text.toLowerCase().includes(q))) return;
      rows.push({ row, index, key, previews });
    });
    this.visibleRows = rows;

    const families = [];
    for (const col of columns) {
      const last = families[families.length - 1];
      if (last && last.family === col.family) last.span++;
      else families.push({ family: col.family, span: 1 });
    }
    const showFamilies = families.some((f) => f.family);

    const thead = h(
      'thead',
      {},
      showFamilies
        ? h(
            'tr',
            { class: 'family-row' },
            h('th', { class: 'key-col sticky-corner', rowSpan: 2 }, 'Row key'),
            families.map((f) => h('th', { colSpan: f.span, class: 'family-head' }, f.family || '')),
          )
        : null,
      h(
        'tr',
        { class: 'qualifier-row' },
        showFamilies ? null : h('th', { class: 'key-col sticky-corner' }, result.source === 'sql' ? '_key' : 'Row key'),
        columns.map((col) => h('th', { class: 'qualifier-head', title: col.id }, col.qualifier)),
      ),
    );

    const tbody = h('tbody');
    const frag = document.createDocumentFragment();
    rows.forEach((r, ri) => {
      const tr = h('tr', { dataset: { ri: String(ri) } });
      const keyCell = h(
        'th',
        {
          class: ['key-col', 'mono', selection && !selection.cell && selection.row === r.row && 'selected'],
          title: r.key,
          dataset: { ri: String(ri), ci: '-1' },
        },
        r.row.synthetic ? h('span', { class: 'muted' }, r.key) : r.key,
      );
      tr.append(keyCell);
      r.previews.forEach((p, ci) => {
        if (!p) {
          tr.append(h('td', { class: 'empty', dataset: { ri: String(ri), ci: String(ci) } }));
          return;
        }
        const latest = p.cell.versions[0];
        const td = h(
          'td',
          {
            class: [`kind-${p.desc.kind}`, selection && selection.cell === p.cell && 'selected'],
            dataset: { ri: String(ri), ci: String(ci) },
            title: latest?.timestampMicros ? timestampTooltip(latest.timestampMicros, timeZone) : '',
          },
          h('div', { class: 'cell-inner' },
            p.desc.kind === 'json' ? h('span', { class: 'cell-badge json' }, Array.isArray(p.desc.json) ? '[ ]' : '{ }') : null,
            h('span', { class: 'cell-text' }, p.text),
            p.cell.versions.length > 1 ? h('span', { class: 'cell-badge versions', title: `${p.cell.versions.length} versions` }, icon('history', { size: 11 }), String(p.cell.versions.length)) : null,
          ),
        );
        tr.append(td);
      });
      frag.append(tr);
    });
    tbody.append(frag);

    const table = h('table', { class: 'grid' }, thead, tbody);
    table.addEventListener('click', (event) => {
      const target = event.target.closest('[data-ci]');
      if (!target) return;
      this.selectAt(Number(target.dataset.ri), Number(target.dataset.ci));
    });
    this.el.append(table);

    if (!rows.length) {
      this.el.append(h('div', { class: 'grid-empty muted' }, result.rows.length ? 'No rows match the filter.' : 'No rows returned.'));
    }
    if (truncatedColumns) {
      this.el.append(h('div', { class: 'grid-note muted' }, `Showing the first ${MAX_COLUMNS} of ${totalColumns} columns. Use the column filter to narrow them down.`));
    }
  }

  selectAt(ri, ci) {
    const r = this.visibleRows?.[ri];
    if (!r) return;
    this.el.querySelectorAll('.selected').forEach((n) => n.classList.remove('selected'));
    const target = this.el.querySelector(`[data-ri="${ri}"][data-ci="${ci}"]`);
    target?.classList.add('selected');
    target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    this.cursor = { ri, ci };
    if (ci < 0) {
      this.onSelect({ row: r.row });
    } else {
      const p = r.previews[ci];
      if (p) this.onSelect({ row: r.row, cell: p.cell });
    }
  }

  onKey(event) {
    if (!this.visibleRows?.length) return;
    const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    const { ri = 0, ci = -1 } = this.cursor || {};
    const nri = Math.min(Math.max(ri + move[0], 0), this.visibleRows.length - 1);
    const nci = Math.min(Math.max(ci + move[1], -1), this.columns.length - 1);
    this.selectAt(nri, nci);
  }
}
