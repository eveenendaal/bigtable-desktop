// Renderer entry point: layout, tab management and app commands.
import { h, icon, iconButton, replaceChildren, toast, popupMenu } from './dom.js';
import { workspace, loadWorkspace, persist, createTab, tabTitle, activeTab, findProject, addProject, defaultSql } from './state.js';
import { initSidebar, renderTree, promptAddProject, discoverProjects, updateTimeZoneToggle, revealTable } from './sidebar.js';
import { QueryView } from './query-view.js';
import { formDialog } from './dialogs.js';

const views = new Map();
let tabbarEl;
let contentEl;
let closedTabs = [];

function viewFor(tab) {
  let view = views.get(tab.id);
  if (!view) {
    view = new QueryView(tab, { onTitleChange: renderTabbar });
    views.set(tab.id, view);
    contentEl.append(view.el);
  }
  return view;
}

function activate(tabId) {
  workspace.activeTabId = tabId;
  persist();
  renderTabbar();
  renderContent();
  renderTree();
}

function renderContent() {
  const tab = activeTab();
  for (const [id, view] of views) view.el.hidden = id !== tab?.id;
  if (!tab) {
    let empty = contentEl.querySelector('.no-tabs');
    if (!empty) {
      empty = h(
        'div',
        { class: 'no-tabs' },
        icon('table', { size: 40 }),
        h('h2', {}, 'Bigtable Desktop'),
        h('p', { class: 'muted' }, 'Choose a table in the sidebar to open a query tab. Tabs and their queries are saved between sessions.'),
        h('button', { type: 'button', class: 'btn primary', onClick: () => newTab() }, 'New query tab'),
      );
      contentEl.append(empty);
    }
    empty.hidden = false;
    return;
  }
  contentEl.querySelector('.no-tabs')?.setAttribute('hidden', '');
  viewFor(tab);
}

function addTab(tab, { activateTab = true } = {}) {
  const index = workspace.tabs.findIndex((t) => t.id === workspace.activeTabId);
  workspace.tabs.splice(index >= 0 ? index + 1 : workspace.tabs.length, 0, tab);
  if (activateTab) activate(tab.id);
  else {
    persist();
    renderTabbar();
  }
  return tab;
}

function newTab() {
  const current = activeTab();
  const target = current?.tableId ? { projectKey: current.projectKey, instanceId: current.instanceId, tableId: current.tableId } : {};
  addTab(createTab(target));
}

function duplicateTab(tab = activeTab()) {
  if (!tab) return;
  const copy = createTab(
    { projectKey: tab.projectKey, instanceId: tab.instanceId, tableId: tab.tableId },
    { mode: tab.mode, query: structuredClone(tab.query), sql: tab.sql, sqlLimit: tab.sqlLimit, title: tab.title ? `${tab.title} (copy)` : '' },
  );
  addTab(copy);
}

function closeTab(tabId = workspace.activeTabId) {
  const index = workspace.tabs.findIndex((t) => t.id === tabId);
  if (index < 0) return;
  const [tab] = workspace.tabs.splice(index, 1);
  const view = views.get(tabId);
  if (view) {
    view.cancel();
    view.el.remove();
    views.delete(tabId);
  }
  closedTabs.push({ tab, index });
  closedTabs = closedTabs.slice(-20);
  if (workspace.activeTabId === tabId) {
    workspace.activeTabId = workspace.tabs[Math.min(index, workspace.tabs.length - 1)]?.id ?? null;
  }
  persist();
  renderTabbar();
  renderContent();
  renderTree();
  toast(`Closed “${tabTitle(tab)}”`, { action: { label: 'Undo', run: reopenClosedTab } });
}

function reopenClosedTab() {
  const entry = closedTabs.pop();
  if (!entry) return;
  workspace.tabs.splice(Math.min(entry.index, workspace.tabs.length), 0, entry.tab);
  activate(entry.tab.id);
}

async function renameTab(tab) {
  const values = await formDialog({
    title: 'Rename tab',
    submitLabel: 'Rename',
    fields: [{ name: 'title', label: 'Title', value: tab.title || tab.tableId || '', placeholder: tab.tableId || 'Query', help: 'Leave empty to use the table name.' }],
  });
  if (!values) return;
  tab.title = values.title === tab.tableId ? '' : values.title;
  persist();
  renderTabbar();
}

function cycleTab(direction) {
  if (!workspace.tabs.length) return;
  const index = workspace.tabs.findIndex((t) => t.id === workspace.activeTabId);
  const next = (index + direction + workspace.tabs.length) % workspace.tabs.length;
  activate(workspace.tabs[next].id);
}

/** Opens a table from the sidebar: reuses the active empty tab, focuses an existing tab, or opens a new one. */
function openTable(target, { newTab: forceNew = false } = {}) {
  const current = activeTab();
  if (!forceNew && current && !current.tableId) {
    Object.assign(current, target, { sql: defaultSql(target.tableId) });
    persist();
    viewFor(current).rebind();
    renderTabbar();
    renderTree();
    return;
  }
  if (!forceNew) {
    const same = (t) => t.projectKey === target.projectKey && t.instanceId === target.instanceId && t.tableId === target.tableId;
    if (current && same(current)) return;
    const existing = workspace.tabs.find(same);
    if (existing) {
      activate(existing.id);
      return;
    }
  }
  addTab(createTab(target));
}

let dragTabId = null;

function renderTabbar() {
  const tabs = workspace.tabs.map((tab) => {
    const active = tab.id === workspace.activeTabId;
    const project = findProject(tab.projectKey);
    const el = h(
      'div',
      {
        class: ['tab', active && 'active'],
        role: 'tab',
        'aria-selected': String(active),
        draggable: true,
        title: tab.tableId ? `${tab.projectKey} / ${tab.instanceId} / ${tab.tableId}${tab.mode === 'sql' ? ' (SQL)' : ''}\nDouble-click to rename` : 'New query',
        onClick: () => activate(tab.id),
        onDblclick: () => renameTab(tab),
        onAuxclick: (event) => {
          if (event.button === 1) closeTab(tab.id);
        },
        onContextmenu: (event) => {
          event.preventDefault();
          popupMenu(event.currentTarget, [
            { label: 'Rename…', onClick: () => renameTab(tab) },
            { label: 'Duplicate', onClick: () => duplicateTab(tab) },
            'separator',
            { label: 'Close', onClick: () => closeTab(tab.id) },
            { label: 'Close other tabs', onClick: () => workspace.tabs.filter((t) => t.id !== tab.id).forEach((t) => closeTab(t.id)) },
          ]);
        },
        onDragstart: (event) => {
          dragTabId = tab.id;
          event.dataTransfer.effectAllowed = 'move';
        },
        onDragover: (event) => {
          if (dragTabId && dragTabId !== tab.id) event.preventDefault();
        },
        onDrop: (event) => {
          event.preventDefault();
          const from = workspace.tabs.findIndex((t) => t.id === dragTabId);
          const to = workspace.tabs.findIndex((t) => t.id === tab.id);
          if (from < 0 || to < 0) return;
          const [moved] = workspace.tabs.splice(from, 1);
          workspace.tabs.splice(to, 0, moved);
          dragTabId = null;
          persist();
          renderTabbar();
        },
      },
      h('span', { class: ['tab-mode', tab.mode === 'sql' && 'sql'] }, tab.mode === 'sql' ? 'SQL' : icon('table', { size: 12 })),
      h('span', { class: 'tab-title' }, tabTitle(tab)),
      project?.emulatorHost ? h('span', { class: 'tab-badge' }, 'emu') : null,
      h(
        'button',
        {
          type: 'button',
          class: 'tab-close',
          title: 'Close tab',
          onClick: (event) => {
            event.stopPropagation();
            closeTab(tab.id);
          },
        },
        icon('x', { size: 11 }),
      ),
    );
    return el;
  });
  replaceChildren(tabbarEl, h('div', { class: 'tabs', role: 'tablist' }, tabs), iconButton('plus', 'New query tab (⌘T)', () => newTab(), { class: 'new-tab' }));
  tabbarEl.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function setTimeZone(tz) {
  workspace.settings.timeZone = tz;
  persist();
  updateTimeZoneToggle();
  for (const view of views.values()) view.refreshTimes();
}

function toggleSidebar() {
  workspace.settings.sidebarHidden = !workspace.settings.sidebarHidden;
  document.body.classList.toggle('sidebar-hidden', workspace.settings.sidebarHidden);
  persist();
}

function runCommand(command) {
  const view = activeTab() ? views.get(workspace.activeTabId) : null;
  switch (command) {
    case 'new-tab':
      return newTab();
    case 'duplicate-tab':
      return duplicateTab();
    case 'close-tab':
      return closeTab();
    case 'run':
      return view?.run();
    case 'cancel':
      return view?.cancel();
    case 'export':
      return view?.result?.rows.length ? view.showExportMenu(view.statusEl.querySelector('.export-btn')) : undefined;
    case 'next-tab':
      return cycleTab(1);
    case 'prev-tab':
      return cycleTab(-1);
    case 'toggle-sidebar':
      return toggleSidebar();
    case 'toggle-timezone':
      return setTimeZone(workspace.settings.timeZone === 'UTC' ? 'local' : 'UTC');
    case 'add-project':
      return promptAddProject();
    case 'discover-projects':
      return discoverProjects();
    default:
      return undefined;
  }
}

async function main() {
  await loadWorkspace();
  document.body.classList.add(`platform-${window.api.platform}`);
  document.body.classList.toggle('sidebar-hidden', Boolean(workspace.settings.sidebarHidden));
  if (workspace.settings.inspectorWidth) document.documentElement.style.setProperty('--inspector-width', workspace.settings.inspectorWidth);

  // Tabs restored from a previous session keep their project even if it was removed.
  for (const tab of workspace.tabs) {
    if (tab.projectKey && !findProject(tab.projectKey)) {
      const [id, emulatorHost] = tab.projectKey.split('@');
      addProject({ id, emulatorHost });
    }
    if (tab.tableId) revealTable(tab);
  }

  const sidebarEl = h('aside', { class: 'sidebar' });
  tabbarEl = h('div', { class: 'tabbar' });
  contentEl = h('div', { class: 'content' });
  replaceChildren(
    document.getElementById('app'),
    sidebarEl,
    h('main', { class: 'workspace' }, h('div', { class: 'tabbar-row' }, iconButton('sidebar', 'Toggle sidebar (⌘B)', toggleSidebar, { class: 'sidebar-toggle' }), tabbarEl), contentEl),
  );
  initSidebar(sidebarEl, { openTable, setTimeZone });
  renderTabbar();
  renderContent();

  window.api.onCommand(runCommand);
  document.addEventListener('keydown', (event) => {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.shiftKey && event.key.toLowerCase() === 't') {
      event.preventDefault();
      reopenClosedTab();
    }
  });
}

main().catch((err) => {
  console.error(err);
  replaceChildren(document.getElementById('app'), h('pre', { class: 'fatal' }, String(err?.stack || err)));
});
