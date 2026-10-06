// Spawns the stdio MCP server against a temporary workspace and drives it with
// the official MCP client. Emulator-backed tests need BIGTABLE_EMULATOR_HOST.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { BigtableService } from '../src/main/bigtable.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = process.env.BIGTABLE_EMULATOR_HOST;
const skip = !host && 'BIGTABLE_EMULATOR_HOST not set';
const projectKey = `mcp-project@${host || 'localhost:1'}`;
const instanceId = 'mcp-instance';
const tableId = `mcp${Date.now()}`;

let dir;
let client;

const call = async (name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content[0].text;
  return { isError: Boolean(result.isError), text, data: result.isError ? null : JSON.parse(text) };
};

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-mcp-'));
  const state = {
    version: 1,
    projects: [{ id: 'mcp-project', emulatorHost: host || 'localhost:1', instances: [{ id: instanceId, tables: [tableId] }] }],
    tabs: [
      {
        id: 'tab-rows',
        title: 'Recent docs',
        projectKey,
        instanceId,
        tableId,
        mode: 'rows',
        query: { keyMode: 'prefix', prefix: 'row#0', families: ['cf'], versions: 2, limit: 3 },
      },
      { id: 'tab-sql', projectKey, instanceId, tableId, mode: 'sql', sql: 'SELECT 1', sqlLimit: 10 },
      { id: 'tab-empty', projectKey: null, instanceId: null, tableId: null, mode: 'rows' },
    ],
    settings: {},
  };
  fs.writeFileSync(path.join(dir, 'workspace.json'), JSON.stringify(state));
  fs.mkdirSync(path.join(dir, 'results'));
  fs.writeFileSync(
    path.join(dir, 'results', 'tab-rows.json'),
    JSON.stringify({
      id: 'tab-rows',
      capturedAt: '2026-10-06T07:00:00.000Z',
      rowCount: 3,
      hasMore: false,
      rows: [1, 2, 3].map((i) => ({ rowKey: `k${i}`, columns: { 'cf:doc': [{ value: { i } }] } })),
    }),
  );

  if (host) {
    const table = new BigtableService().client({ projectId: 'mcp-project', emulatorHost: host }).instance(instanceId).table(tableId);
    await table.create({ families: ['cf'] });
    const base = Date.now() - 3_600_000;
    for (let i = 0; i < 6; i++) {
      for (let v = 0; v < 3; v++) {
        await table.insert({ key: `row#${i}`, data: { cf: { doc: { value: JSON.stringify({ i, v }), timestamp: new Date(base + v * 60_000) } } } });
      }
    }
  }

  client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.join(root, 'src/mcp/stdio.js')],
      env: { ...process.env, BIGTABLE_DESKTOP_STATE: path.join(dir, 'workspace.json') },
      stderr: 'ignore',
    }),
  );
});

after(async () => {
  await client?.close();
  if (host) {
    await new BigtableService().client({ projectId: 'mcp-project', emulatorHost: host }).instance(instanceId).table(tableId).delete();
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('advertises read-only tools', async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    'execute_sql',
    'get_query_results',
    'list_clusters',
    'list_column_families',
    'list_instances',
    'list_projects',
    'list_saved_queries',
    'list_tables',
    'read_cell_history',
    'read_rows',
    'run_saved_query',
  ]);
  assert.ok(tools.every((t) => t.annotations?.readOnlyHint === true && t.annotations?.destructiveHint === false));
  assert.match(client.getInstructions(), /Read-only access/);
});

test('list_projects returns projects configured in the app', async () => {
  const { data } = await call('list_projects');
  assert.equal(data.configured[0].project, projectKey);
  assert.deepEqual(data.configured[0].instances, [{ id: instanceId, tables: [tableId] }]);
});

test('list_saved_queries describes the open tabs', async () => {
  const { data } = await call('list_saved_queries');
  assert.deepEqual(
    data.queries.map((q) => [q.id, q.mode]),
    [
      ['tab-rows', 'rows'],
      ['tab-sql', 'sql'],
    ],
  );
  assert.deepEqual(data.queries[0].query, { prefix: 'row#0', families: ['cf'], versions: 2, limit: 3 });
  assert.equal(data.queries[1].sql, 'SELECT 1');
});

test('get_query_results returns the captured snapshot with paging', async () => {
  const page = await call('get_query_results', { id: 'tab-rows', limit: 2 });
  assert.equal(page.data.capturedAt, '2026-10-06T07:00:00.000Z');
  assert.equal(page.data.rowCount, 3);
  assert.deepEqual(page.data.rows.map((r) => r.rowKey), ['k1', 'k2']);
  assert.equal(page.data.nextOffset, 2);
  const rest = await call('get_query_results', { id: 'tab-rows', offset: 2 });
  assert.deepEqual(rest.data.rows.map((r) => r.rowKey), ['k3']);
  assert.equal(rest.data.nextOffset, undefined);
  assert.equal((await call('get_query_results', { id: 'tab-sql' })).isError, true);
  assert.equal((await call('get_query_results', { id: '../workspace' })).isError, true);
  const { data } = await call('list_saved_queries');
  assert.deepEqual(data.queries[0].resultsSnapshot, { rowCount: 3, capturedAt: '2026-10-06T07:00:00.000Z' });
  assert.equal(data.queries[1].resultsSnapshot, undefined);
});

test('errors are reported as tool errors', async () => {
  const missing = await call('run_saved_query', { id: 'nope' });
  assert.equal(missing.isError, true);
  assert.match(missing.text, /No saved query/);
  const badColumn = await call('read_cell_history', { project: projectKey, instance: instanceId, table: tableId, row_key: 'x', column: 'nofamily' });
  assert.equal(badColumn.isError, true);
});

test('read_rows returns parsed JSON values with timestamps and pages', { skip }, async () => {
  const first = await call('read_rows', { project: projectKey, instance: instanceId, table: tableId, prefix: 'row#', limit: 4 });
  assert.equal(first.data.rowCount, 4);
  assert.equal(first.data.hasMore, true);
  assert.equal(first.data.nextStartAfter, 'row#3');
  const cell = first.data.rows[0].columns['cf:doc'];
  assert.equal(cell.length, 1);
  assert.deepEqual(cell[0].value, { i: 0, v: 2 });
  assert.match(cell[0].timestamp, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/);

  const next = await call('read_rows', { project: projectKey, instance: instanceId, table: tableId, prefix: 'row#', start_after: first.data.nextStartAfter });
  assert.deepEqual(next.data.rows.map((r) => r.rowKey), ['row#4', 'row#5']);
  assert.equal(next.data.hasMore, undefined);
});

test('read_rows supports exact keys and version counts', { skip }, async () => {
  const { data } = await call('read_rows', { project: projectKey, instance: instanceId, table: tableId, keys: ['row#2', 'row#5'], versions: 3 });
  assert.deepEqual(data.rows.map((r) => r.rowKey), ['row#2', 'row#5']);
  assert.equal(data.rows[0].columns['cf:doc'].length, 3);
});

test('read_cell_history returns every version newest first', { skip }, async () => {
  const { data } = await call('read_cell_history', { project: projectKey, instance: instanceId, table: tableId, row_key: 'row#1', column: 'cf:doc' });
  assert.deepEqual(data.versions.map((v) => v.value.v), [2, 1, 0]);
});

test('run_saved_query runs a saved Rows tab', { skip }, async () => {
  const { data } = await call('run_saved_query', { id: 'tab-rows' });
  assert.deepEqual(data.rows.map((r) => r.rowKey), ['row#0']);
  assert.equal(data.rows[0].columns['cf:doc'].length, 2);
});

test('list_tables and list_column_families hit Bigtable', { skip }, async () => {
  assert.ok((await call('list_tables', { project: projectKey, instance: instanceId })).data.includes(tableId));
  assert.deepEqual((await call('list_column_families', { project: projectKey, instance: instanceId, table: tableId })).data, ['cf']);
});
