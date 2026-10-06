// Workspace and result snapshot file locations.
import path from 'node:path';

export const STATE_FILE = 'workspace.json';

/** Directory for result snapshots ("Copy MCP reference"), next to the workspace file. */
export function resultsDir(statePath) {
  return path.join(path.dirname(statePath), 'results');
}

export function snapshotPath(statePath, tabId) {
  if (!/^[\w-]+$/.test(tabId)) throw new Error(`Invalid query id: ${tabId}`);
  return path.join(resultsDir(statePath), `${tabId}.json`);
}
