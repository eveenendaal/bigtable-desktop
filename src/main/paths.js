// Location of the persisted workspace, computed without Electron so the MCP
// server (which runs as plain Node) finds the same file as the app.
import os from 'node:os';
import path from 'node:path';

// Must match Electron's app.name, which comes from productName in package.json.
export const APP_NAME = 'Bigtable Desktop';
export const STATE_FILE = 'workspace.json';

/** Mirrors Electron's app.getPath('appData'). */
export function appDataDir(platform = process.platform, env = process.env, home = os.homedir()) {
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support');
  if (platform === 'win32') return env.APPDATA || path.join(home, 'AppData', 'Roaming');
  return env.XDG_CONFIG_HOME || path.join(home, '.config');
}

export function defaultStatePath(env = process.env) {
  return env.BIGTABLE_DESKTOP_STATE || path.join(appDataDir(), APP_NAME, STATE_FILE);
}

/** Directory for result snapshots ("Copy MCP reference"), next to the workspace file. */
export function resultsDir(statePath) {
  return path.join(path.dirname(statePath), 'results');
}

export function snapshotPath(statePath, tabId) {
  if (!/^[\w-]+$/.test(tabId)) throw new Error(`Invalid query id: ${tabId}`);
  return path.join(resultsDir(statePath), `${tabId}.json`);
}
