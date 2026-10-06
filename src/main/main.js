import { app, BrowserWindow, ipcMain, dialog, Menu, protocol, net, shell, clipboard } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BigtableService } from './bigtable.js';
import { StateStore } from './store.js';
import { describeError } from './errors.js';
import { STATE_FILE, resultsDir, snapshotPath } from './paths.js';
import { launchConfig, claudeAddCommand, mcpServersJson, shellEnv, findClaude, installInClaude } from './mcp-config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, '..');
const isMac = process.platform === 'darwin';

// The renderer is served from a custom privileged scheme so ES modules load
// with a proper origin instead of file://.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const service = new BigtableService();
let store;
let mainWindow;

function serveAppProtocol() {
  const allowed = [path.join(srcRoot, 'renderer') + path.sep, path.join(srcRoot, 'shared') + path.sep];
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const file = path.normalize(path.join(srcRoot, decodeURIComponent(pathname)));
    if (!allowed.some((dir) => file.startsWith(dir))) {
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(file).toString());
  });
}

/** Wraps an IPC handler so errors arrive in the renderer as data with a helpful hint. */
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (err) {
      return { ok: false, error: describeError(err) };
    }
  });
}

function registerIpc() {
  handle('state:load', () => store.load());
  handle('state:save', (state) => store.save(state));

  handle('bt:listProjects', () => service.listProjects());
  handle('bt:listInstances', (conn) => service.listInstances(conn));
  handle('bt:listClusters', (conn, instanceId) => service.listClusters(conn, instanceId));
  handle('bt:listTables', (conn, instanceId) => service.listTables(conn, instanceId));
  handle('bt:listFamilies', (conn, instanceId, tableId) => service.listFamilies(conn, instanceId, tableId));
  handle('bt:readRows', (conn, request) => service.readRows(conn, request));
  handle('bt:readCellHistory', (conn, request) => service.readCellHistory(conn, request));
  handle('bt:executeSql', (conn, request) => service.executeSql(conn, request));
  handle('bt:cancel', (queryId) => service.cancel(queryId));

  handle('file:save', async ({ defaultPath, content, filters }) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: path.join(app.getPath('downloads'), defaultPath),
      filters,
    });
    if (result.canceled || !result.filePath) return null;
    await fs.writeFile(result.filePath, content, 'utf8');
    return result.filePath;
  });
  handle('file:reveal', (filePath) => shell.showItemInFolder(filePath));
  handle('clipboard:write', (text) => clipboard.writeText(text));
  handle('shell:openExternal', (url) => {
    if (/^https:\/\//.test(url)) return shell.openExternal(url);
    return null;
  });

  // MCP server: the app binary in Node mode runs src/mcp/stdio.js (inside app.asar when packaged).
  const mcpLaunch = () => launchConfig({ execPath: process.execPath, scriptPath: path.join(srcRoot, 'mcp', 'stdio.js') });
  handle('mcp:config', async () => {
    const config = mcpLaunch();
    return {
      config,
      command: claudeAddCommand(config),
      json: mcpServersJson(config),
      claudePath: findClaude(await shellEnv()),
    };
  });
  handle('mcp:install', () => installInClaude(mcpLaunch()));

  // Result snapshots for "Copy MCP reference": the MCP server's get_query_results reads them.
  handle('results:snapshot', async (tabId, snapshot) => {
    const file = snapshotPath(store.file, tabId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(`${file}.tmp`, JSON.stringify(snapshot));
    await fs.rename(`${file}.tmp`, file);
    return file;
  });
}

/** Deletes result snapshots whose tab no longer exists. */
function pruneSnapshots() {
  const dir = resultsDir(store.file);
  const tabIds = new Set((store.load().tabs || []).map((t) => t.id));
  let files = [];
  try {
    files = fsSync.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of files) {
    if (name.endsWith('.json') && !tabIds.has(name.slice(0, -5))) fsSync.rmSync(path.join(dir, name), { force: true });
  }
}

function sendCommand(command) {
  mainWindow?.webContents.send('menu:command', command);
}

function buildMenu() {
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Query Tab', accelerator: 'CmdOrCtrl+T', click: () => sendCommand('new-tab') },
        { label: 'Duplicate Tab', accelerator: 'CmdOrCtrl+Shift+D', click: () => sendCommand('duplicate-tab') },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => sendCommand('close-tab') },
        { type: 'separator' },
        { label: 'Export Results…', accelerator: 'CmdOrCtrl+E', click: () => sendCommand('export') },
        { type: 'separator' },
        { label: 'Add Project…', click: () => sendCommand('add-project') },
        { label: 'Discover Projects…', click: () => sendCommand('discover-projects') },
        { type: 'separator' },
        { label: 'Connect to Claude Code…', click: () => sendCommand('connect-claude') },
        ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit' }]),
      ],
    },
    { role: 'editMenu' },
    {
      label: 'Query',
      submenu: [
        { label: 'Run Query', accelerator: 'CmdOrCtrl+Enter', click: () => sendCommand('run') },
        { label: 'Cancel Query', accelerator: 'CmdOrCtrl+.', click: () => sendCommand('cancel') },
        { type: 'separator' },
        { label: 'Next Tab', accelerator: 'CmdOrCtrl+Alt+Right', click: () => sendCommand('next-tab') },
        { label: 'Previous Tab', accelerator: 'CmdOrCtrl+Alt+Left', click: () => sendCommand('prev-tab') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+B', click: () => sendCommand('toggle-sidebar') },
        { label: 'Toggle UTC / Local Time', accelerator: 'CmdOrCtrl+Shift+U', click: () => sendCommand('toggle-timezone') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Bigtable Desktop',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    backgroundColor: '#1b1d22',
    show: false,
    webPreferences: {
      preload: path.join(srcRoot, 'preload', 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('app://')) event.preventDefault();
  });
  mainWindow.loadURL('app://bundle/renderer/index.html');
}

app.whenReady().then(() => {
  // Packaged builds get their icon from the bundle; show it in the Dock during development too.
  if (isMac && !app.isPackaged) app.dock.setIcon(path.join(srcRoot, '..', 'build', 'icon.png'));
  store = new StateStore(process.env.BIGTABLE_DESKTOP_STATE || path.join(app.getPath('userData'), STATE_FILE));
  pruneSnapshots();
  serveAppProtocol();
  registerIpc();
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
