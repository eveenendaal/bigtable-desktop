#!/usr/bin/env node
// Entry point for the Bigtable Desktop MCP server over stdio.
//
// Packaged app: run the app binary with ELECTRON_RUN_AS_NODE=1 and this file
// (inside app.asar) as the script. The app's "Connect to Claude Code" dialog
// and the Homebrew `bigtable-desktop-mcp` command do that for you.
// From source: node src/mcp/stdio.js
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BigtableService } from '../main/bigtable.js';
import { StateStore } from '../main/store.js';
import fs from 'node:fs';
import { defaultStatePath, snapshotPath } from '../main/paths.js';
import { createServer } from './server.js';

// stdout carries the protocol; route stray console output to stderr.
console.log = console.error;
console.info = console.error;

const statePath = defaultStatePath();
const store = new StateStore(statePath);

function loadSnapshot(id) {
  try {
    return JSON.parse(fs.readFileSync(snapshotPath(statePath, id), 'utf8'));
  } catch {
    return null;
  }
}

// Read the workspace on every call so changes made in the app show up immediately.
const server = createServer({ service: new BigtableService(), loadState: () => store.load({ backupCorrupt: false }), loadSnapshot });
await server.connect(new StdioServerTransport());
