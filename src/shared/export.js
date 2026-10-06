// Serializing query results for export (JSON, NDJSON, CSV).
import { displayBytes } from './bytes.js';
import { valueToPlain, describeValue, columnId } from './cells.js';
import { microsToIso } from './time.js';

/**
 * Result shape produced by the main process:
 * {
 *   rows: [{ key: Uint8Array, cells: [{ family, qualifier: Uint8Array,
 *            versions: [{ timestampMicros: string|null, value: Uint8Array, labels?: string[] }] }] }]
 * }
 */

export function versionToPlain(version) {
  const out = {};
  if (version.timestampMicros != null) {
    out.timestamp = microsToIso(version.timestampMicros);
    out.timestampMicros = version.timestampMicros;
  }
  out.value = valueToPlain(version.value);
  if (version.labels?.length) out.labels = version.labels;
  return out;
}

/** A single row as a plain object. `allVersions` keeps every version, otherwise only the latest value. */
export function rowToPlain(row, { allVersions = true } = {}) {
  const columns = {};
  for (const cell of row.cells) {
    const id = cell.family ? columnId(cell.family, cell.qualifier) : displayBytes(cell.qualifier);
    if (allVersions) {
      columns[id] = cell.versions.map(versionToPlain);
    } else {
      columns[id] = cell.versions.length ? valueToPlain(cell.versions[0].value) : null;
    }
  }
  return { rowKey: displayBytes(row.key), columns };
}

export function toJSON(result, options) {
  return JSON.stringify(result.rows.map((row) => rowToPlain(row, options)), null, 2);
}

export function toNDJSON(result, options) {
  return result.rows.map((row) => JSON.stringify(rowToPlain(row, options))).join('\n') + '\n';
}

function csvEscape(text) {
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function csvValue(bytes) {
  const desc = describeValue(bytes);
  switch (desc.kind) {
    case 'json':
      return JSON.stringify(desc.json);
    case 'text':
    case 'empty':
      return desc.text;
    default:
      return desc.int64 ?? JSON.stringify(valueToPlain(bytes));
  }
}

/** CSV with one row per Bigtable row and one column per family:qualifier (latest value). */
export function toCSV(result, { includeTimestamps = false } = {}) {
  const ids = [];
  const seen = new Set();
  for (const row of result.rows) {
    for (const cell of row.cells) {
      const id = cell.family ? columnId(cell.family, cell.qualifier) : displayBytes(cell.qualifier);
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }
  const header = ['row_key'];
  for (const id of ids) {
    header.push(id);
    if (includeTimestamps) header.push(`${id} @timestamp`);
  }
  const lines = [header.map(csvEscape).join(',')];
  for (const row of result.rows) {
    const byId = new Map();
    for (const cell of row.cells) {
      byId.set(cell.family ? columnId(cell.family, cell.qualifier) : displayBytes(cell.qualifier), cell);
    }
    const fields = [displayBytes(row.key)];
    for (const id of ids) {
      const latest = byId.get(id)?.versions[0];
      fields.push(latest ? csvValue(latest.value) : '');
      if (includeTimestamps) fields.push(latest?.timestampMicros ? microsToIso(latest.timestampMicros) : '');
    }
    lines.push(fields.map(csvEscape).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

/** Export of a single cell with its full version history. */
export function cellToJSON(rowKey, cell) {
  return JSON.stringify(
    {
      rowKey: displayBytes(rowKey),
      column: cell.family ? columnId(cell.family, cell.qualifier) : displayBytes(cell.qualifier),
      versions: cell.versions.map(versionToPlain),
    },
    null,
    2,
  );
}
