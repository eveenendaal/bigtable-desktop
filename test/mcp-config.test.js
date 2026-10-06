import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchConfig, claudeAddArgs, claudeAddCommand, mcpServersJson, shellQuote, findClaude } from '../src/main/mcp-config.js';
import { appDataDir, defaultStatePath } from '../src/main/paths.js';

const config = launchConfig({
  execPath: '/Applications/Bigtable Desktop.app/Contents/MacOS/Bigtable Desktop',
  scriptPath: '/Applications/Bigtable Desktop.app/Contents/Resources/app.asar/src/mcp/stdio.js',
});

test('launchConfig runs the app binary in Node mode', () => {
  assert.equal(config.env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(config.args.length, 1);
});

test('claudeAddArgs registers the server at user scope', () => {
  assert.deepEqual(claudeAddArgs(config), [
    'mcp',
    'add',
    'bigtable-desktop',
    '--scope',
    'user',
    '-e',
    'ELECTRON_RUN_AS_NODE=1',
    '--',
    config.command,
    config.args[0],
  ]);
});

test('claudeAddCommand quotes paths with spaces', () => {
  assert.equal(
    claudeAddCommand(config),
    "claude mcp add bigtable-desktop --scope user -e ELECTRON_RUN_AS_NODE=1 -- '/Applications/Bigtable Desktop.app/Contents/MacOS/Bigtable Desktop' '/Applications/Bigtable Desktop.app/Contents/Resources/app.asar/src/mcp/stdio.js'",
  );
  assert.equal(shellQuote("it's"), `'it'\\''s'`);
});

test('mcpServersJson produces a stdio server entry', () => {
  const parsed = JSON.parse(mcpServersJson(config));
  assert.deepEqual(parsed.mcpServers['bigtable-desktop'], { type: 'stdio', ...config });
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

test('workspace path matches Electron userData', () => {
  assert.equal(appDataDir('darwin', {}, '/Users/me'), '/Users/me/Library/Application Support');
  assert.equal(appDataDir('linux', {}, '/home/me'), '/home/me/.config');
  assert.equal(appDataDir('linux', { XDG_CONFIG_HOME: '/x' }, '/home/me'), '/x');
  assert.equal(defaultStatePath({ BIGTABLE_DESKTOP_STATE: '/tmp/w.json' }), '/tmp/w.json');
});
