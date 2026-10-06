// Exposes a narrow, promise-based API to the renderer.
const { contextBridge, ipcRenderer } = require('electron');

// Rejects with a plain {message, code, hint} object: Error subclasses lose their
// extra properties when crossing the context bridge.
async function call(channel, ...args) {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw { ...result.error };
  return result.value;
}

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  loadState: () => call('state:load'),
  saveState: (state) => call('state:save', state),

  listProjects: () => call('bt:listProjects'),
  listInstances: (conn) => call('bt:listInstances', conn),
  listClusters: (conn, instanceId) => call('bt:listClusters', conn, instanceId),
  listTables: (conn, instanceId) => call('bt:listTables', conn, instanceId),
  listFamilies: (conn, instanceId, tableId) => call('bt:listFamilies', conn, instanceId, tableId),
  readRows: (conn, request) => call('bt:readRows', conn, request),
  readCellHistory: (conn, request) => call('bt:readCellHistory', conn, request),
  executeSql: (conn, request) => call('bt:executeSql', conn, request),
  cancel: (queryId) => call('bt:cancel', queryId),

  saveFile: (options) => call('file:save', options),
  revealFile: (filePath) => call('file:reveal', filePath),
  copyText: (text) => call('clipboard:write', text),
  openExternal: (url) => call('shell:openExternal', url),

  mcpConfig: () => call('mcp:config'),
  setMcpPort: (port) => call('mcp:setPort', port),
  installMcp: () => call('mcp:install'),
  saveResultSnapshot: (tabId, snapshot) => call('results:snapshot', tabId, snapshot),

  onCommand: (listener) => {
    const wrapped = (_event, command) => listener(command);
    ipcRenderer.on('menu:command', wrapped);
    return () => ipcRenderer.removeListener('menu:command', wrapped);
  },
});
