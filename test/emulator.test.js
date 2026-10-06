// Integration tests against the Bigtable emulator. Skipped unless
// BIGTABLE_EMULATOR_HOST is set, e.g.:
//   gcloud beta emulators bigtable start --host-port=localhost:8086 &
//   BIGTABLE_EMULATOR_HOST=localhost:8086 npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BigtableService } from '../src/main/bigtable.js';
import { utf8Encode, displayBytes } from '../src/shared/bytes.js';

const host = process.env.BIGTABLE_EMULATOR_HOST;
const conn = { projectId: 'test-project', emulatorHost: host };
const instanceId = 'test-instance';
const tableId = `t${Date.now()}`;
const service = new BigtableService();

const skip = !host && 'BIGTABLE_EMULATOR_HOST not set';

before(async () => {
  if (skip) return;
  const table = service.client(conn).instance(instanceId).table(tableId);
  await table.create({ families: ['cf', 'other'] });
  const base = Date.now() - 3_600_000;
  for (let i = 0; i < 12; i++) {
    const key = `row#${String(i).padStart(2, '0')}`;
    for (let v = 0; v < 3; v++) {
      await table.insert({ key, data: { cf: { doc: { value: JSON.stringify({ i, v }), timestamp: new Date(base + v * 60_000) } } } });
    }
    await table.insert({ key, data: { other: { tag: { value: i % 2 ? 'odd' : 'even', timestamp: new Date(base) } } } });
  }
  await table.insert({ key: Buffer.from([0x00, 0xff]), data: { cf: { doc: { value: Buffer.from([1, 2, 3]) } } } });
});

after(async () => {
  if (skip) return;
  await service.client(conn).instance(instanceId).table(tableId).delete();
});

const baseQuery = { keyMode: 'prefix', prefix: utf8Encode('row#'), versions: 2, limit: 5 };

test('lists tables and families', { skip }, async () => {
  assert.ok((await service.listTables(conn, instanceId)).includes(tableId));
  assert.deepEqual(await service.listFamilies(conn, instanceId, tableId), ['cf', 'other']);
});

test('reads rows by prefix with a version limit and paginates', { skip }, async () => {
  const first = await service.readRows(conn, { queryId: 'a', instanceId, tableId, query: baseQuery });
  assert.equal(first.rows.length, 5);
  assert.equal(first.hasMore, true);
  assert.equal(displayBytes(first.rows[0].key), 'row#00');
  const doc = first.rows[0].cells.find((c) => c.family === 'cf');
  assert.equal(doc.versions.length, 2);
  assert.ok(BigInt(doc.versions[0].timestampMicros) > BigInt(doc.versions[1].timestampMicros));

  const second = await service.readRows(conn, { queryId: 'b', instanceId, tableId, query: baseQuery, afterKey: first.lastKey });
  assert.equal(displayBytes(second.rows[0].key), 'row#05');

  const last = await service.readRows(conn, { queryId: 'c', instanceId, tableId, query: { ...baseQuery, limit: 100 }, afterKey: second.lastKey });
  assert.equal(last.rows.length, 2);
  assert.equal(last.hasMore, false);
});

test('filters by family, qualifier and value', { skip }, async () => {
  const res = await service.readRows(conn, {
    instanceId,
    tableId,
    query: { ...baseQuery, limit: 100, families: ['other'], valueRegex: 'odd' },
  });
  assert.equal(res.rows.length, 6);
  assert.ok(res.rows.every((r) => r.cells.length === 1 && r.cells[0].family === 'other'));
});

test('reads exact keys including binary keys', { skip }, async () => {
  const res = await service.readRows(conn, {
    instanceId,
    tableId,
    query: { keyMode: 'keys', keys: [Uint8Array.from([0x00, 0xff]), utf8Encode('row#03')], versions: 1, limit: 10 },
  });
  assert.deepEqual(res.rows.map((r) => displayBytes(r.key)), ['\\x00\\xff', 'row#03']);
});

test('reads the full history of a cell', { skip }, async () => {
  const versions = await service.readCellHistory(conn, { instanceId, tableId, rowKey: utf8Encode('row#01'), family: 'cf', qualifier: utf8Encode('doc') });
  assert.equal(versions.length, 3);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(versions[0].value)), { i: 1, v: 2 });
});
