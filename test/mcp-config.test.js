import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claudeAddArgs, claudeAddCommand, mcpServersJson, shellQuote, findClaude } from '../src/main/mcp-config.js';
import { mcpUrl } from '../src/mcp/http.js';

const url = mcpUrl(8487);

test('mcpUrl points at localhost', () => {
  assert.equal(url, 'http://localhost:8487/mcp');
});

test('claudeAddArgs registers the HTTP server at user scope', () => {
  assert.deepEqual(claudeAddArgs(url), ['mcp', 'add', '--transport', 'http', '--scope', 'user', 'bigtable-desktop', url]);
});

test('claudeAddCommand is one copy-pasteable line', () => {
  assert.equal(claudeAddCommand(url), 'claude mcp add --transport http --scope user bigtable-desktop http://localhost:8487/mcp');
  assert.equal(shellQuote("it's"), `'it'\\''s'`);
});

test('mcpServersJson produces an http server entry', () => {
  const parsed = JSON.parse(mcpServersJson(url));
  assert.deepEqual(parsed.mcpServers['bigtable-desktop'], { type: 'http', url });
});

test('findClaude searches PATH and the default install locations', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-home-'));
  try {
    assert.equal(findClaude({ PATH: '' }, home), null);
    const local = path.join(home, '.local', 'bin');
    fs.mkdirSync(local, { recursive: true });
    fs.writeFileSync(path.join(local, 'claude'), '#!/bin/sh\n', { mode: 0o755 });
    assert.equal(findClaude({ PATH: '' }, home), path.join(local, 'claude'));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
