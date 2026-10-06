// MCP server exposing Bigtable Desktop's read-only functionality: discovery,
// row reads, cell history, GoogleSQL and the queries saved in the app's tabs.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { parseKeyInput, displayBytes } from '../shared/bytes.js';
import { rowToPlain, versionToPlain } from '../shared/export.js';
import { rowsRequestFromForm, describeSavedQuery } from '../shared/query.js';
import { describeError } from '../main/errors.js';

export const SERVER_NAME = 'bigtable-desktop';
const DEFAULT_ROW_LIMIT = 25;
const MAX_ROW_LIMIT = 1000;
const MAX_OUTPUT_CHARS = 100_000;

const INSTRUCTIONS = `Read-only access to Google Cloud Bigtable through Bigtable Desktop.
- "project" is a GCP project ID, or "project@host:port" for a Bigtable emulator. Projects configured in the app (see list_projects) reuse their emulator host and app profile.
- Cell values that are JSON are returned parsed; text is returned as strings; other bytes as {"$base64": ...} (8-byte counters also include "$int64").
- Every version carries "timestamp" (ISO-8601, microsecond precision, UTC) and "timestampMicros". Versions are newest first.
- Row keys accept \\xNN escapes for binary bytes.
- list_saved_queries / run_saved_query use the query tabs the user has open in the app. get_query_results returns the results the user was looking at when they copied an "MCP reference" from the app.`;

const project = z.string().describe('GCP project ID, or "project@host:port" for an emulator');
const instance = z.string().describe('Bigtable instance ID');
const table = z.string().describe('Table ID');
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

/**
 * Builds the MCP server.
 * @param {{service: import('../main/bigtable.js').BigtableService, loadState: () => object,
 *          loadSnapshot: (id: string) => object|null}} deps
 */
export function createServer({ service, loadState, loadSnapshot }) {
  const server = new McpServer({ name: SERVER_NAME, version: '1.0.0' }, { instructions: INSTRUCTIONS });

  /** Resolves a project argument to a connection, reusing settings saved in the app. */
  const connFor = (key) => {
    const saved = (loadState().projects || []).find((p) => (p.emulatorHost ? `${p.id}@${p.emulatorHost}` : p.id) === key);
    if (saved) return { projectId: saved.id, emulatorHost: saved.emulatorHost || undefined, appProfileId: saved.appProfileId || undefined };
    const [projectId, emulatorHost] = key.split('@');
    return { projectId, emulatorHost: emulatorHost || undefined };
  };

  const tool = (name, config, handler) =>
    server.registerTool(name, { annotations: READ_ONLY, ...config }, async (args) => {
      try {
        return json(await handler(args));
      } catch (err) {
        const { message, code, hint } = describeError(err);
        return { isError: true, content: [{ type: 'text', text: [code && `${code}:`, message, hint].filter(Boolean).join(' ') }] };
      }
    });

  tool(
    'list_projects',
    {
      title: 'List projects',
      description:
        'Lists the projects configured in Bigtable Desktop, with the instances and tables the app has already discovered. Set discover=true to also list every project the signed-in account can see (Cloud Resource Manager).',
      inputSchema: { discover: z.boolean().optional().describe('Also query Cloud Resource Manager') },
    },
    async ({ discover }) => {
      const configured = (loadState().projects || []).map((p) => ({
        project: p.emulatorHost ? `${p.id}@${p.emulatorHost}` : p.id,
        emulatorHost: p.emulatorHost,
        appProfileId: p.appProfileId,
        instances: (p.instances || []).map((i) => ({
          id: i.id,
          tables: [...new Set([...(i.tables || []), ...(i.manualTables || [])])].sort(),
        })),
      }));
      const result = { configured };
      if (discover) result.discovered = await service.listProjects();
      return result;
    },
  );

  tool(
    'list_instances',
    { title: 'List instances', description: 'Lists the Bigtable instances in a project.', inputSchema: { project } },
    ({ project: p }) => service.listInstances(connFor(p)),
  );

  tool(
    'list_clusters',
    {
      title: 'List clusters',
      description: "Lists an instance's clusters with location, node count and storage type.",
      inputSchema: { project, instance },
    },
    ({ project: p, instance: i }) => service.listClusters(connFor(p), i),
  );

  tool(
    'list_tables',
    { title: 'List tables', description: 'Lists the tables in an instance.', inputSchema: { project, instance } },
    ({ project: p, instance: i }) => service.listTables(connFor(p), i),
  );

  tool(
    'list_column_families',
    { title: 'List column families', description: "Lists a table's column families.", inputSchema: { project, instance, table } },
    ({ project: p, instance: i, table: t }) => service.listFamilies(connFor(p), i, t),
  );

  tool(
    'read_rows',
    {
      title: 'Read rows',
      description:
        'Reads rows from a table by key prefix, key range or exact keys, with optional column and value filters. Returns each cell with its versions and timestamps. Use start_after with the returned nextStartAfter to page.',
      inputSchema: {
        project,
        instance,
        table,
        prefix: z.string().optional().describe('Row key prefix'),
        start: z.string().optional().describe('Start row key (inclusive); use with end for a range'),
        end: z.string().optional().describe('End row key (exclusive)'),
        keys: z.array(z.string()).optional().describe('Exact row keys to read'),
        families: z.array(z.string()).optional().describe('Only these column families'),
        qualifier_regex: z.string().optional().describe('RE2 regex on column qualifiers'),
        value_regex: z.string().optional().describe('RE2 regex on cell values'),
        versions: z.number().int().min(1).max(1000).optional().describe('Versions per cell (default 1)'),
        written_after: z.string().optional().describe('Only cells written at or after this ISO-8601 time'),
        written_before: z.string().optional().describe('Only cells written before this ISO-8601 time'),
        limit: z.number().int().min(1).max(MAX_ROW_LIMIT).optional().describe(`Maximum rows (default ${DEFAULT_ROW_LIMIT})`),
        start_after: z.string().optional().describe('Continue after this row key (from nextStartAfter)'),
      },
    },
    async (a) => {
      const keyMode = a.keys?.length ? 'keys' : a.start || a.end ? 'range' : 'prefix';
      const query = {
        keyMode,
        prefix: parseKeyInput(a.prefix || ''),
        start: parseKeyInput(a.start || ''),
        end: parseKeyInput(a.end || ''),
        keys: (a.keys || []).map(parseKeyInput),
        families: a.families || [],
        qualifierRegex: a.qualifier_regex,
        valueRegex: a.value_regex,
        versions: a.versions ?? 1,
        timeStart: a.written_after ? isoTime(a.written_after) : null,
        timeEnd: a.written_before ? isoTime(a.written_before) : null,
        limit: a.limit ?? DEFAULT_ROW_LIMIT,
      };
      const afterKey = a.start_after ? parseKeyInput(a.start_after) : null;
      const result = await service.readRows(connFor(a.project), { instanceId: a.instance, tableId: a.table, query, afterKey });
      return rowsResult(result);
    },
  );

  tool(
    'read_cell_history',
    {
      title: 'Read cell history',
      description: 'Returns every stored version of one cell, newest first, with timestamps.',
      inputSchema: {
        project,
        instance,
        table,
        row_key: z.string().describe('Row key'),
        column: z.string().describe('Column as "family:qualifier"'),
        max_versions: z.number().int().min(1).max(1000).optional().describe('Maximum versions (default 100)'),
      },
    },
    async (a) => {
      const sep = a.column.indexOf(':');
      if (sep <= 0) throw new Error('column must be "family:qualifier"');
      const versions = await service.readCellHistory(connFor(a.project), {
        instanceId: a.instance,
        tableId: a.table,
        rowKey: parseKeyInput(a.row_key),
        family: a.column.slice(0, sep),
        qualifier: parseKeyInput(a.column.slice(sep + 1)),
        maxVersions: a.max_versions ?? 100,
      });
      return { rowKey: a.row_key, column: a.column, versions: versions.map(versionToPlain) };
    },
  );

  tool(
    'execute_sql',
    {
      title: 'Run GoogleSQL',
      description:
        'Runs a GoogleSQL for Bigtable query against an instance, e.g. SELECT _key, cf FROM `table` LIMIT 10. Column families come back as family:qualifier columns; use `table`(with_history => TRUE) for versions with timestamps.',
      inputSchema: {
        project,
        instance,
        sql: z.string().describe('GoogleSQL query'),
        limit: z.number().int().min(1).max(MAX_ROW_LIMIT).optional().describe(`Maximum rows (default 100)`),
      },
    },
    async (a) => rowsResult(await service.executeSql(connFor(a.project), { instanceId: a.instance, sql: a.sql, limit: a.limit ?? 100 })),
  );

  tool(
    'list_saved_queries',
    {
      title: 'List saved queries',
      description: 'Lists the query tabs the user has open in Bigtable Desktop, with their table and query.',
      inputSchema: {},
      annotations: { ...READ_ONLY, openWorldHint: false },
    },
    async () => ({
      queries: (loadState().tabs || [])
        .filter((t) => t.tableId)
        .map((tab) => {
          const snapshot = loadSnapshot(tab.id);
          return snapshot ? { ...describeSavedQuery(tab), resultsSnapshot: { rowCount: snapshot.rowCount, capturedAt: snapshot.capturedAt } } : describeSavedQuery(tab);
        }),
    }),
  );

  tool(
    'run_saved_query',
    {
      title: 'Run saved query',
      description: 'Runs one of the queries saved in Bigtable Desktop (see list_saved_queries) and returns its rows.',
      inputSchema: {
        id: z.string().describe('Query id from list_saved_queries'),
        limit: z.number().int().min(1).max(MAX_ROW_LIMIT).optional().describe('Override the saved row limit'),
      },
    },
    async ({ id, limit }) => {
      const tab = (loadState().tabs || []).find((t) => t.id === id);
      if (!tab?.tableId) throw new Error(`No saved query with id ${id}. Call list_saved_queries for valid ids.`);
      const conn = connFor(tab.projectKey);
      if (tab.mode === 'sql') {
        return rowsResult(await service.executeSql(conn, { instanceId: tab.instanceId, sql: tab.sql, limit: limit ?? tab.sqlLimit ?? 100 }));
      }
      const query = rowsRequestFromForm({ ...tab.query, limit: limit ?? tab.query?.limit });
      return rowsResult(await service.readRows(conn, { instanceId: tab.instanceId, tableId: tab.tableId, query }));
    },
  );

  tool(
    'get_query_results',
    {
      title: 'Get query results',
      description:
        'Returns the results the user was looking at in Bigtable Desktop when they used "Copy MCP reference": the rows shown in that query tab, including every loaded version, without re-querying Bigtable.',
      inputSchema: {
        id: z.string().describe('Query id from the MCP reference or list_saved_queries'),
        offset: z.number().int().min(0).optional().describe('Skip this many rows (default 0)'),
        limit: z.number().int().min(1).max(MAX_ROW_LIMIT).optional().describe('Maximum rows (default 100)'),
      },
      annotations: { ...READ_ONLY, openWorldHint: false },
    },
    async ({ id, offset = 0, limit = 100 }) => {
      const snapshot = loadSnapshot(id);
      if (!snapshot) throw new Error(`No captured results for query ${id}. Ask the user to use "Copy MCP reference" in Bigtable Desktop, or call run_saved_query.`);
      let rows = snapshot.rows.slice(offset, offset + limit);
      while (rows.length > 1 && JSON.stringify(rows).length > MAX_OUTPUT_CHARS) rows = rows.slice(0, Math.ceil(rows.length / 2));
      const next = offset + rows.length;
      const { rows: _all, ...meta } = snapshot;
      return { ...meta, offset, returned: rows.length, ...(next < snapshot.rows.length ? { nextOffset: next } : {}), rows };
    },
  );

  return server;
}

function isoTime(text) {
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid time: ${text}`);
  return date.toISOString();
}

/** Converts service rows to plain JSON, trimming rows so the response stays a reasonable size. */
function rowsResult(result) {
  let rows = result.rows.map((row) => rowToPlain(row));
  let truncated = false;
  while (rows.length > 1 && JSON.stringify(rows).length > MAX_OUTPUT_CHARS) {
    rows = rows.slice(0, Math.ceil(rows.length / 2));
    truncated = true;
  }
  const out = { rowCount: rows.length, rows };
  const hasMore = result.hasMore || truncated;
  if (hasMore) {
    out.hasMore = true;
    const lastKey = truncated ? result.rows[rows.length - 1]?.key : result.lastKey;
    if (lastKey && !result.rows[0]?.synthetic) out.nextStartAfter = displayBytes(lastKey);
    if (truncated) out.note = 'Output was trimmed to keep the response small; page with start_after or lower the limit.';
  }
  return out;
}

function json(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

