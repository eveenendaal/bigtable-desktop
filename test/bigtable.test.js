import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildFilter, buildRowSet, normalizeRow, normalizeSqlRow, escapeRegex, sqlToPlain } from '../src/main/bigtable.js';
import { utf8Encode, displayBytes } from '../src/shared/bytes.js';

const require = createRequire(import.meta.url);
const { QueryResultRow, Struct, EncodedKeyMap } = require('@google-cloud/bigtable/build/src/execute-query/values.js');
const { PreciseDate } = require('@google-cloud/precise-date');

const resultRow = (tuples) => {
  const struct = Struct.fromTuples(tuples);
  return new QueryResultRow(struct.values, struct.fieldMapping);
};

test('buildFilter chains filters with the version limit last', () => {
  assert.equal(buildFilter({}), undefined);
  const filter = buildFilter({
    families: ['a', 'b.c'],
    qualifierRegex: '^x',
    valueRegex: 'v',
    timeStart: '2026-01-01T00:00:00.000Z',
    versions: 3,
  });
  assert.deepEqual(filter[0], { family: '^(?:a|b\\.c)$' });
  assert.deepEqual(filter[1], { column: { name: '^x' } });
  assert.deepEqual(filter[2], { value: 'v' });
  assert.ok(filter[3].time.start instanceof Date);
  assert.deepEqual(filter[4], { column: { cellLimit: 3 } });
});

test('buildRowSet handles prefix, range, keys and pagination', () => {
  assert.deepEqual(buildRowSet({ keyMode: 'prefix', prefix: new Uint8Array() }, null), {});
  const prefix = buildRowSet({ keyMode: 'prefix', prefix: utf8Encode('ab') }, null);
  assert.equal(prefix.ranges[0].start.value.toString(), 'ab');
  assert.equal(prefix.ranges[0].start.inclusive, true);
  assert.equal(prefix.ranges[0].end.value.toString(), 'ac');

  const next = buildRowSet({ keyMode: 'prefix', prefix: utf8Encode('ab') }, utf8Encode('ab5'));
  assert.equal(next.ranges[0].start.value.toString(), 'ab5');
  assert.equal(next.ranges[0].start.inclusive, false);
  assert.equal(buildRowSet({ keyMode: 'range', end: utf8Encode('m') }, utf8Encode('z')), null);

  const keys = buildRowSet({ keyMode: 'keys', keys: [utf8Encode('c'), utf8Encode('a'), utf8Encode('b')] }, utf8Encode('a'));
  assert.deepEqual(keys.keys.map(String), ['b', 'c']);
  assert.equal(buildRowSet({ keyMode: 'keys', keys: [utf8Encode('a')] }, utf8Encode('a')), null);
});

test('escapeRegex', () => {
  assert.equal(escapeRegex('a.b*c'), 'a\\.b\\*c');
});

test('normalizeRow converts client rows and restores int64 counters', () => {
  const row = normalizeRow({
    id: Buffer.from('k1'),
    data: { cf: { q: [{ value: Buffer.from('{"a":1}'), timestamp: '123', labels: [] }, { value: 42, timestamp: '100', labels: [] }] } },
  });
  assert.equal(displayBytes(row.key), 'k1');
  assert.equal(row.cells[0].family, 'cf');
  assert.equal(displayBytes(row.cells[0].qualifier), 'q');
  assert.equal(new TextDecoder().decode(row.cells[0].versions[0].value), '{"a":1}');
  const counter = row.cells[0].versions[1].value;
  assert.equal(counter.length, 8);
  assert.equal(new DataView(counter.buffer, counter.byteOffset).getBigInt64(0), 42n);
});

test('normalizeSqlRow maps column families to cells and keeps history timestamps', () => {
  const history = [
    Struct.fromTuples([['timestamp', new PreciseDate('2026-10-06T06:00:00.000123Z')], ['value', Buffer.from('{"v":1}')]]),
    Struct.fromTuples([['timestamp', new PreciseDate('2026-10-06T07:00:00Z')], ['value', Buffer.from('{"v":2}')]]),
  ];
  const row = resultRow([
    ['_key', Buffer.from('user#1')],
    ['profile', new EncodedKeyMap([[Buffer.from('json'), history]])],
    ['prefs', new EncodedKeyMap([[Buffer.from('theme'), Buffer.from('dark')]])],
    ['n', 7n],
    ['missing', null],
  ]);
  const normalized = normalizeSqlRow(row, 0);
  assert.equal(displayBytes(normalized.key), 'user#1');
  assert.equal(normalized.synthetic, false);
  const [json, theme, n] = normalized.cells;
  assert.equal(json.family, 'profile');
  assert.equal(displayBytes(json.qualifier), 'json');
  assert.equal(json.versions.length, 2);
  assert.equal(json.versions[0].timestampMicros, String(Date.parse('2026-10-06T07:00:00Z') * 1000)); // newest first
  assert.equal(json.versions[1].timestampMicros, String(Date.parse('2026-10-06T06:00:00Z') * 1000 + 123));
  assert.equal(theme.versions[0].timestampMicros, null);
  assert.equal(new TextDecoder().decode(theme.versions[0].value), 'dark');
  assert.equal(n.family, '');
  assert.equal(new TextDecoder().decode(n.versions[0].value), '7');
  assert.equal(normalized.cells.length, 3);
});

test('normalizeSqlRow without _key uses a synthetic row number', () => {
  const row = resultRow([['count', 3n]]);
  const normalized = normalizeSqlRow(row, 4);
  assert.equal(displayBytes(normalized.key), '#5');
  assert.equal(normalized.synthetic, true);
});

test('sqlToPlain converts nested SQL values', () => {
  const value = Struct.fromTuples([
    ['a', [1n, 2n]],
    ['b', Buffer.from('{"x":true}')],
    ['c', new EncodedKeyMap([['k', 'v']])],
  ]);
  assert.deepEqual(sqlToPlain(value), { a: ['1', '2'], b: { x: true }, c: { k: 'v' } });
});
