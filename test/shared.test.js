import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayBytes, parseKeyInput, prefixSuccessor, compareBytes, utf8Encode, toBase64, fromBase64 } from '../src/shared/bytes.js';
import { describeValue, previewValue, valueToPlain, columnId } from '../src/shared/cells.js';
import { formatTimestamp, microsToIso, formatDuration, formatRelative, toMicros } from '../src/shared/time.js';
import { diffLines, diffStats } from '../src/shared/diff.js';
import { toJSON, toCSV, toNDJSON, cellToJSON } from '../src/shared/export.js';

test('displayBytes keeps printable text and escapes binary', () => {
  assert.equal(displayBytes(utf8Encode('user#1')), 'user#1');
  assert.equal(displayBytes(Uint8Array.from([0x61, 0x00, 0xff])), 'a\\x00\\xff');
  assert.equal(displayBytes(utf8Encode('héllo')), 'héllo');
});

test('parseKeyInput understands \\xNN escapes and round-trips with displayBytes', () => {
  assert.deepEqual([...parseKeyInput('a\\x00\\xff')], [0x61, 0x00, 0xff]);
  assert.deepEqual([...parseKeyInput('plain')], [...utf8Encode('plain')]);
  const bytes = Uint8Array.from([1, 2, 0x5c, 0x41]);
  assert.deepEqual([...parseKeyInput(displayBytes(bytes))], [...bytes]);
});

test('prefixSuccessor', () => {
  assert.deepEqual([...prefixSuccessor(utf8Encode('abc'))], [...utf8Encode('abd')]);
  assert.deepEqual([...prefixSuccessor(Uint8Array.from([0x61, 0xff]))], [0x62]);
  assert.equal(prefixSuccessor(Uint8Array.from([0xff, 0xff])), null);
});

test('compareBytes orders lexicographically', () => {
  assert.ok(compareBytes(utf8Encode('a'), utf8Encode('b')) < 0);
  assert.ok(compareBytes(utf8Encode('ab'), utf8Encode('a')) > 0);
  assert.equal(compareBytes(utf8Encode('x'), utf8Encode('x')), 0);
});

test('base64 round trip', () => {
  const bytes = Uint8Array.from({ length: 300 }, (_, i) => i % 256);
  assert.deepEqual([...fromBase64(toBase64(bytes))], [...bytes]);
});

test('describeValue detects JSON, text, binary and int64 counters', () => {
  const json = describeValue(utf8Encode(' {"a": [1, 2]} '));
  assert.equal(json.kind, 'json');
  assert.deepEqual(json.json, { a: [1, 2] });
  assert.equal(describeValue(utf8Encode('{not json')).kind, 'text');
  assert.equal(describeValue(utf8Encode('hello')).kind, 'text');
  assert.equal(describeValue(new Uint8Array()).kind, 'empty');
  const counter = new Uint8Array(8);
  new DataView(counter.buffer).setBigInt64(0, 42n);
  const bin = describeValue(counter);
  assert.equal(bin.kind, 'binary');
  assert.equal(bin.int64, '42');
  assert.equal(previewValue(bin), '42 (int64)');
  assert.deepEqual(valueToPlain(Uint8Array.from([0xff, 0xfe])), { $base64: '//4=' });
});

test('columnId', () => {
  assert.equal(columnId('cf', utf8Encode('q')), 'cf:q');
});

test('microsToIso keeps microsecond precision', () => {
  assert.equal(microsToIso('1791268040720123'), '2026-10-06T06:27:20.720123Z');
  assert.equal(microsToIso(null), '');
  assert.equal(toMicros('abc'), null);
});

test('formatTimestamp produces readable parts in UTC', () => {
  const now = Date.UTC(2026, 9, 6, 9, 27, 20);
  const t = formatTimestamp('1791268040720123', { timeZone: 'UTC', now });
  assert.equal(t.date, 'Tue, Oct 6, 2026');
  assert.equal(t.time, '06:27:20');
  assert.equal(t.fraction, '.720');
  assert.equal(t.subMillis, '123');
  assert.equal(t.zone, 'UTC');
  assert.equal(t.relative, '3 hours ago');
});

test('formatDuration and formatRelative', () => {
  assert.equal(formatDuration(500), '500 ms');
  assert.equal(formatDuration((26 * 3600 + 5 * 60) * 1000), '1d 2h');
  assert.equal(formatDuration(-90_000), '1m 30s');
  assert.equal(formatRelative(1000, 2000), 'just now');
  assert.equal(formatRelative(0, 2 * 86400_000), '2 days ago');
});

test('diffLines finds changed lines', () => {
  const entries = diffLines('a\nb\nc', 'a\nB\nc\nd');
  assert.deepEqual(
    entries.map((e) => `${e.type}:${e.text}`),
    ['same:a', 'del:b', 'add:B', 'same:c', 'add:d'],
  );
  assert.deepEqual(diffStats(entries), { added: 2, removed: 1 });
  assert.deepEqual(diffStats(diffLines('x', 'x')), { added: 0, removed: 0 });
});

const result = {
  rows: [
    {
      key: utf8Encode('row1'),
      cells: [
        {
          family: 'cf',
          qualifier: utf8Encode('doc'),
          versions: [
            { timestampMicros: '2000000', value: utf8Encode('{"v":2}') },
            { timestampMicros: '1000000', value: utf8Encode('{"v":1}') },
          ],
        },
        { family: 'cf', qualifier: utf8Encode('note'), versions: [{ timestampMicros: '1000000', value: utf8Encode('hi, "there"') }] },
      ],
    },
    { key: utf8Encode('row2'), cells: [{ family: 'cf', qualifier: utf8Encode('doc'), versions: [{ timestampMicros: '3000000', value: utf8Encode('{"v":3}') }] }] },
  ],
};

test('toJSON exports all versions with ISO timestamps and parsed JSON', () => {
  const parsed = JSON.parse(toJSON(result, { allVersions: true }));
  assert.equal(parsed[0].rowKey, 'row1');
  assert.deepEqual(parsed[0].columns['cf:doc'], [
    { timestamp: '1970-01-01T00:00:02.000000Z', timestampMicros: '2000000', value: { v: 2 } },
    { timestamp: '1970-01-01T00:00:01.000000Z', timestampMicros: '1000000', value: { v: 1 } },
  ]);
  const latest = JSON.parse(toJSON(result, { allVersions: false }));
  assert.deepEqual(latest[0].columns, { 'cf:doc': { v: 2 }, 'cf:note': 'hi, "there"' });
});

test('toNDJSON emits one line per row', () => {
  const lines = toNDJSON(result).trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[1]).rowKey, 'row2');
});

test('toCSV uses latest values and escapes', () => {
  const csv = toCSV(result).split('\r\n');
  assert.equal(csv[0], 'row_key,cf:doc,cf:note');
  assert.equal(csv[1], 'row1,"{""v"":2}","hi, ""there"""');
  assert.equal(csv[2], 'row2,"{""v"":3}",');
  const withTs = toCSV(result, { includeTimestamps: true }).split('\r\n');
  assert.equal(withTs[0], 'row_key,cf:doc,cf:doc @timestamp,cf:note,cf:note @timestamp');
});

test('cellToJSON includes the full history', () => {
  const parsed = JSON.parse(cellToJSON(result.rows[0].key, result.rows[0].cells[0]));
  assert.equal(parsed.column, 'cf:doc');
  assert.equal(parsed.versions.length, 2);
});
