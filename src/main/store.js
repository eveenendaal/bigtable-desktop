// Persists the workspace (projects, open query tabs, settings) as JSON on disk.
import fs from 'node:fs';
import path from 'node:path';

export const STATE_VERSION = 1;

export function defaultState() {
  return {
    version: STATE_VERSION,
    projects: [],
    tabs: [],
    activeTabId: null,
    settings: { timeZone: 'local' },
  };
}

export class StateStore {
  constructor(file) {
    this.file = file;
  }

  /** @param {{backupCorrupt?: boolean}} [options] backupCorrupt=false for read-only readers such as the MCP server. */
  load({ backupCorrupt = true } = {}) {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      return { ...defaultState(), ...parsed, settings: { ...defaultState().settings, ...parsed.settings } };
    } catch (err) {
      if (backupCorrupt && err.code !== 'ENOENT') {
        // Keep a copy of an unreadable file instead of silently discarding the user's queries.
        try {
          fs.copyFileSync(this.file, `${this.file}.corrupt-${Date.now()}`);
        } catch {
          // Ignore: nothing more we can do.
        }
      }
      return defaultState();
    }
  }

  save(state) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ ...state, version: STATE_VERSION }, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
