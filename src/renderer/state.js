// Workspace state shared by the renderer modules, persisted through the main process.

export const workspace = {
  projects: [],
  tabs: [],
  activeTabId: null,
  settings: { timeZone: 'local', sidebarHidden: false },
};

const listeners = new Set();
let saveTimer = null;

export async function loadWorkspace() {
  const loaded = await window.api.loadState();
  Object.assign(workspace, loaded);
  workspace.settings = { timeZone: 'local', sidebarHidden: false, ...(loaded.settings || {}) };
  for (const tab of workspace.tabs) normalizeTab(tab);
  if (!workspace.tabs.find((t) => t.id === workspace.activeTabId)) {
    workspace.activeTabId = workspace.tabs[0]?.id ?? null;
  }
}

/** Persists the workspace (debounced). */
export function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 300);
}

export function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const snapshot = {
    ...workspace,
    projects: workspace.projects.map(({ error, loading, ...p }) => ({
      ...p,
      instances: (p.instances || []).map(({ error: e, loading: l, ...i }) => i),
    })),
  };
  return window.api.saveState(snapshot).catch((err) => console.error('Failed to save workspace', err));
}

window.addEventListener('beforeunload', () => {
  if (saveTimer) flush();
});

export function onChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emit(kind, detail) {
  for (const listener of listeners) listener(kind, detail);
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export const projectKey = (p) => (p.emulatorHost ? `${p.id}@${p.emulatorHost}` : p.id);

export function findProject(key) {
  return workspace.projects.find((p) => projectKey(p) === key);
}

export function connFor(project) {
  return {
    projectId: project.id,
    emulatorHost: project.emulatorHost || undefined,
    appProfileId: project.appProfileId || undefined,
  };
}

export function addProject({ id, emulatorHost = '', appProfileId = '' }) {
  const project = { id, emulatorHost: emulatorHost || undefined, appProfileId: appProfileId || undefined, expanded: true, instances: [] };
  const key = projectKey(project);
  const existing = findProject(key);
  if (existing) return existing;
  workspace.projects.push(project);
  workspace.projects.sort((a, b) => projectKey(a).localeCompare(projectKey(b)));
  persist();
  return project;
}

export function removeProject(key) {
  workspace.projects = workspace.projects.filter((p) => projectKey(p) !== key);
  persist();
}

export function ensureInstance(project, instanceId, extra = {}) {
  project.instances ||= [];
  let instance = project.instances.find((i) => i.id === instanceId);
  if (!instance) {
    instance = { id: instanceId, displayName: instanceId, tables: [], clusters: [], ...extra };
    project.instances.push(instance);
    project.instances.sort((a, b) => a.id.localeCompare(b.id));
  }
  return instance;
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export function defaultQuery() {
  return {
    keyMode: 'prefix',
    prefix: '',
    start: '',
    end: '',
    keys: '',
    families: [],
    qualifierRegex: '',
    valueRegex: '',
    versions: 5,
    timeStart: '',
    timeEnd: '',
    limit: 100,
  };
}

export function defaultSql(tableId) {
  return tableId ? `SELECT *\nFROM \`${tableId}\`\nLIMIT 100` : 'SELECT *\nFROM `my-table`\nLIMIT 100';
}

function normalizeTab(tab) {
  tab.query = { ...defaultQuery(), ...(tab.query || {}) };
  tab.mode ||= 'rows';
  tab.sql ??= defaultSql(tab.tableId);
  tab.sqlLimit ??= 1000;
  return tab;
}

let counter = 0;
const newId = () => `tab-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export function createTab(target = {}, overrides = {}) {
  const tab = normalizeTab({
    id: newId(),
    title: '',
    projectKey: target.projectKey ?? null,
    instanceId: target.instanceId ?? null,
    tableId: target.tableId ?? null,
    mode: 'rows',
    createdAt: Date.now(),
    ...overrides,
  });
  if (!overrides.sql) tab.sql = defaultSql(tab.tableId);
  return tab;
}

export function tabTitle(tab) {
  return tab.title || tab.tableId || 'New query';
}

export function activeTab() {
  return workspace.tabs.find((t) => t.id === workspace.activeTabId) || null;
}
