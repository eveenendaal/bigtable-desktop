// Thin wrapper around the official @google-cloud/bigtable client focused on
// discovery (instances, clusters, tables) and reading data.
import bigtablePkg from '@google-cloud/bigtable';
import { toBytes, prefixSuccessor, compareBytes, utf8Encode } from '../shared/bytes.js';

const { Bigtable } = bigtablePkg;

export const MAX_ROWS = 10_000;
export const MAX_HISTORY = 1_000;

const toBuffer = (value) => {
  const bytes = toBytes(value);
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
};
const toUint8 = (buf) => new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength).slice();

/** Escapes a literal for use inside an RE2 expression. */
export function escapeRegex(text) {
  return text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

/** Builds the filter chain for a ReadRows request from the query form fields. */
export function buildFilter(query) {
  const chain = [];
  const families = (query.families || []).filter(Boolean);
  if (families.length) {
    chain.push({ family: `^(?:${families.map(escapeRegex).join('|')})$` });
  }
  if (query.qualifierRegex) chain.push({ column: { name: query.qualifierRegex } });
  if (query.valueRegex) chain.push({ value: query.valueRegex });
  if (query.timeStart || query.timeEnd) {
    const time = {};
    if (query.timeStart) time.start = new Date(query.timeStart);
    if (query.timeEnd) time.end = new Date(query.timeEnd);
    chain.push({ time });
  }
  const versions = Number(query.versions);
  if (Number.isFinite(versions) && versions > 0) chain.push({ column: { cellLimit: Math.floor(versions) } });
  return chain.length ? chain : undefined;
}

/**
 * Builds the row-set part of a ReadRows request.
 * @param {object} query - key selection from the query form (keys are Uint8Array).
 * @param {Uint8Array|null} afterKey - continue strictly after this key (pagination).
 * @returns {{ranges?: object[], keys?: Buffer[]}|null} null when nothing is left to read.
 */
export function buildRowSet(query, afterKey) {
  const mode = query.keyMode || 'prefix';
  if (mode === 'keys') {
    let keys = (query.keys || []).map(toBytes).filter((k) => k.length);
    keys.sort(compareBytes);
    if (afterKey) keys = keys.filter((k) => compareBytes(k, afterKey) > 0);
    if (!keys.length) return (query.keys || []).length ? null : {};
    return { keys: keys.map(toBuffer) };
  }

  let start = null;
  let end = null;
  if (mode === 'prefix') {
    const prefix = toBytes(query.prefix);
    if (prefix.length) {
      start = prefix;
      end = prefixSuccessor(prefix);
    }
  } else if (mode === 'range') {
    if (query.start?.length) start = toBytes(query.start);
    if (query.end?.length) end = toBytes(query.end);
  }

  const range = {};
  if (afterKey) {
    range.start = { value: toBuffer(afterKey), inclusive: false };
  } else if (start) {
    range.start = { value: toBuffer(start), inclusive: true };
  }
  if (end) {
    if (afterKey && compareBytes(afterKey, end) >= 0) return null;
    range.end = { value: toBuffer(end), inclusive: false };
  }
  return Object.keys(range).length ? { ranges: [range] } : {};
}

/**
 * The client turns 8-byte values that look like safe integers into numbers even
 * with decode:false (it assumes they are counters); turn them back into bytes.
 */
function cellValueToBytes(value) {
  if (Buffer.isBuffer(value)) return toUint8(value);
  if (typeof value === 'number') {
    const buf = Buffer.alloc(8);
    buf.writeBigInt64BE(BigInt(value));
    return toUint8(buf);
  }
  return utf8Encode(String(value ?? ''));
}

/** Converts a row from the client (decode: false) into the transport format. */
export function normalizeRow(row) {
  const cells = [];
  for (const [family, columns] of Object.entries(row.data || {})) {
    for (const [qualifier, versions] of Object.entries(columns)) {
      cells.push({
        family,
        // The client uses qualifiers as object keys, so they arrive as UTF-8 strings.
        qualifier: utf8Encode(qualifier),
        versions: versions.map((v) => ({
          timestampMicros: v.timestamp == null ? null : String(v.timestamp),
          value: cellValueToBytes(v.value),
          labels: v.labels?.length ? v.labels : undefined,
        })),
      });
    }
  }
  const key = Buffer.isBuffer(row.id) ? toUint8(row.id) : utf8Encode(String(row.id));
  return { key, cells };
}

export class BigtableService {
  constructor() {
    this.clients = new Map();
    this.active = new Map();
  }

  client(conn) {
    const projectId = conn.projectId;
    const endpoint = conn.emulatorHost || '';
    const cacheKey = `${projectId}|${endpoint}`;
    let client = this.clients.get(cacheKey);
    if (!client) {
      client = new Bigtable({
        projectId,
        apiEndpoint: endpoint || undefined,
        metricsEnabled: false,
        appProfileId: conn.appProfileId || undefined,
      });
      this.clients.set(cacheKey, client);
    }
    return client;
  }

  async listProjects() {
    const { ProjectsClient } = (await import('@google-cloud/resource-manager')).default;
    const client = new ProjectsClient();
    const projects = [];
    for await (const project of client.searchProjectsAsync({ query: 'state:ACTIVE' })) {
      projects.push({ id: project.projectId, displayName: project.displayName || project.projectId });
      if (projects.length >= 2000) break;
    }
    projects.sort((a, b) => a.id.localeCompare(b.id));
    return projects;
  }

  async listInstances(conn) {
    const [instances, failedLocations] = await this.client(conn).getInstances();
    return {
      instances: instances
        .map((i) => ({
          id: i.id,
          displayName: i.metadata?.displayName || i.id,
          type: i.metadata?.type,
          state: i.metadata?.state,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      failedLocations: failedLocations || [],
    };
  }

  async listClusters(conn, instanceId) {
    const [clusters] = await this.client(conn).instance(instanceId).getClusters();
    return clusters
      .map((c) => ({
        id: c.id,
        location: (c.metadata?.location || '').split('/').pop(),
        serveNodes: c.metadata?.serveNodes,
        storageType: c.metadata?.defaultStorageType,
        state: c.metadata?.state,
        autoscaling: Boolean(c.metadata?.clusterConfig?.clusterAutoscalingConfig),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async listTables(conn, instanceId) {
    const [tables] = await this.client(conn).instance(instanceId).getTables({ view: 'NAME_ONLY' });
    return tables.map((t) => t.id).sort((a, b) => a.localeCompare(b));
  }

  async listFamilies(conn, instanceId, tableId) {
    const [families] = await this.client(conn).instance(instanceId).table(tableId).getFamilies();
    return families.map((f) => f.id).sort((a, b) => a.localeCompare(b));
  }

  /** Cancels an in-flight read or SQL query. */
  cancel(queryId) {
    const stream = this.active.get(queryId);
    if (stream) {
      stream.cancelledByUser = true;
      stream.end();
      this.active.delete(queryId);
    }
  }

  _collect(queryId, stream, limit, onRow) {
    return new Promise((resolve, reject) => {
      let count = 0;
      let hasMore = false;
      let done = false;
      const finish = (err) => {
        if (done) return;
        done = true;
        this.active.delete(queryId);
        if (err && !stream.cancelledByUser) reject(err);
        else resolve({ hasMore, cancelled: Boolean(stream.cancelledByUser) });
      };
      if (queryId) this.active.set(queryId, stream);
      stream.on('data', (row) => {
        if (done) return;
        if (count >= limit) {
          hasMore = true;
          stream.end();
          finish();
          return;
        }
        count++;
        onRow(row);
      });
      stream.on('error', finish);
      stream.on('end', () => finish());
    });
  }

  /**
   * Reads rows for the "Rows" query mode.
   * @returns {Promise<{rows, hasMore, cancelled, lastKey, elapsedMs}>}
   */
  async readRows(conn, { queryId, instanceId, tableId, query, afterKey }) {
    const started = Date.now();
    const limit = Math.min(Math.max(Number(query.limit) || 100, 1), MAX_ROWS);
    const rowSet = buildRowSet(query, afterKey ? toBytes(afterKey) : null);
    if (rowSet === null) return { rows: [], hasMore: false, cancelled: false, elapsedMs: 0 };
    const options = { decode: false, ...rowSet, limit: limit + 1 };
    const filter = buildFilter(query);
    if (filter) options.filter = filter;

    const table = this.client(conn).instance(instanceId).table(tableId);
    const rows = [];
    const stream = table.createReadStream(options);
    const { hasMore, cancelled } = await this._collect(queryId, stream, limit, (row) => rows.push(normalizeRow(row)));
    return {
      rows,
      hasMore,
      cancelled,
      lastKey: rows.length ? rows[rows.length - 1].key : null,
      elapsedMs: Date.now() - started,
    };
  }

  /** Reads the full version history of one cell. */
  async readCellHistory(conn, { instanceId, tableId, rowKey, family, qualifier, maxVersions }) {
    const table = this.client(conn).instance(instanceId).table(tableId);
    const limit = Math.min(Number(maxVersions) || MAX_HISTORY, MAX_HISTORY);
    const [rows] = await table.getRows({
      decode: false,
      keys: [toBuffer(rowKey)],
      filter: [
        { family: `^${escapeRegex(family)}$` },
        { column: { name: toBuffer(qualifier) } },
        { column: { cellLimit: limit } },
      ],
    });
    if (!rows.length) return [];
    const row = normalizeRow(rows[0]);
    return row.cells[0]?.versions || [];
  }

  /** Runs a GoogleSQL query against an instance. */
  async executeSql(conn, { queryId, instanceId, sql, limit: rawLimit }) {
    const started = Date.now();
    const limit = Math.min(Math.max(Number(rawLimit) || 1000, 1), MAX_ROWS);
    const instance = this.client(conn).instance(instanceId);
    const [preparedStatement] = await instance.prepareStatement(sql);
    const stream = instance.createExecuteQueryStream({ preparedStatement });
    const rows = [];
    const { hasMore, cancelled } = await this._collect(queryId, stream, limit, (row) =>
      rows.push(normalizeSqlRow(row, rows.length)),
    );
    return { rows, hasMore, cancelled, lastKey: null, elapsedMs: Date.now() - started };
  }
}

// ---------------------------------------------------------------------------
// GoogleSQL result normalization
// ---------------------------------------------------------------------------

const isNamedList = (v) => v && Array.isArray(v.values) && v.fieldMapping && typeof v.get === 'function';
const isMapLike = (v) => v && typeof v.entries === 'function' && typeof v.get === 'function' && !Array.isArray(v) && !isNamedList(v);

function preciseDateToMicros(value) {
  if (typeof value?.getFullTimeString === 'function') return (BigInt(value.getFullTimeString()) / 1000n).toString();
  if (value instanceof Date) return (BigInt(value.getTime()) * 1000n).toString();
  return null;
}

function namedListToObject(list) {
  const obj = {};
  list.values.forEach((v, i) => {
    obj[list.getFieldNameAtIndex(i) ?? `_${i}`] = sqlToPlain(v);
  });
  return obj;
}

/** Converts a SQL value into JSON-compatible data. */
export function sqlToPlain(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array) {
    const text = Buffer.from(value).toString('utf8');
    if (Buffer.from(text, 'utf8').equals(Buffer.from(value))) {
      try {
        const t = text.trim();
        if (t.startsWith('{') || t.startsWith('[')) return JSON.parse(t);
      } catch {
        // fall through
      }
      return text;
    }
    return { $base64: Buffer.from(value).toString('base64') };
  }
  if (typeof value?.getFullTimeString === 'function' || value instanceof Date) return new Date(value.getTime()).toISOString();
  if (value && typeof value === 'object' && 'year' in value && 'month' in value && 'day' in value) {
    return `${String(value.year).padStart(4, '0')}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`;
  }
  if (Array.isArray(value)) return value.map(sqlToPlain);
  if (isNamedList(value)) return namedListToObject(value);
  if (isMapLike(value)) {
    const obj = {};
    for (const [k, v] of value.entries()) obj[k instanceof Uint8Array ? Buffer.from(k).toString('utf8') : String(k)] = sqlToPlain(v);
    return obj;
  }
  return value;
}

function sqlToBytes(value) {
  if (value instanceof Uint8Array) return toUint8(Buffer.from(value));
  if (typeof value === 'string') return utf8Encode(value);
  const plain = sqlToPlain(value);
  return utf8Encode(typeof plain === 'string' ? plain : JSON.stringify(plain));
}

/** True for ARRAY<STRUCT<timestamp, value>> as returned by `with_history => TRUE`. */
function isHistory(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((v) => isNamedList(v) && v.fieldMapping.validFieldNames.has('timestamp') && v.fieldMapping.validFieldNames.has('value'))
  );
}

/**
 * Normalizes a QueryResultRow into the same row/cell shape as ReadRows so the
 * grid, cell inspector and exports work identically for SQL results. Column
 * family maps become family:qualifier cells; other columns become plain cells.
 */
export function normalizeSqlRow(row, index) {
  const cells = [];
  let key = null;
  row.values.forEach((value, i) => {
    const name = row.getFieldNameAtIndex(i) ?? `_${i}`;
    if (name === '_key' && key === null) {
      key = value instanceof Uint8Array ? toUint8(Buffer.from(value)) : utf8Encode(String(value));
      return;
    }
    if (value === null || value === undefined) return;
    if (isMapLike(value)) {
      for (const [qualifier, v] of value.entries()) {
        if (v === null || v === undefined) continue;
        const versions = isHistory(v)
          ? v.map((entry) => ({
              timestampMicros: preciseDateToMicros(entry.get('timestamp')),
              value: sqlToBytes(entry.get('value')),
            }))
          : [{ timestampMicros: null, value: sqlToBytes(v) }];
        versions.sort((a, b) => (BigInt(b.timestampMicros ?? 0) > BigInt(a.timestampMicros ?? 0) ? 1 : -1));
        cells.push({ family: name, qualifier: sqlToBytes(qualifier), versions });
      }
      return;
    }
    cells.push({ family: '', qualifier: utf8Encode(name), versions: [{ timestampMicros: null, value: sqlToBytes(value) }] });
  });
  return { key: key ?? utf8Encode(`#${index + 1}`), cells, synthetic: key === null };
}
