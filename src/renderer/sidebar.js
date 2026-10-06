// Project / instance / cluster / table explorer.
import { h, icon, iconButton, replaceChildren, toast } from './dom.js';
import { formDialog, confirmDialog, discoverProjectsDialog } from './dialogs.js';
import {
  workspace,
  persist,
  projectKey,
  findProject,
  connFor,
  addProject,
  removeProject,
  ensureInstance,
  activeTab,
} from './state.js';

let root;
let treeEl;
let filterInput;
let handlers;

export function initSidebar(container, options) {
  root = container;
  handlers = options;
  filterInput = h('input', {
    type: 'search',
    class: 'sidebar-filter',
    placeholder: 'Filter tables…',
    spellcheck: false,
    onInput: () => renderTree(),
  });
  treeEl = h('div', { class: 'tree', role: 'tree' });
  const tzToggle = h(
    'div',
    { class: 'segmented small', title: 'Show cell timestamps in local time or UTC' },
    ['local', 'UTC'].map((tz) =>
      h(
        'button',
        {
          type: 'button',
          class: workspace.settings.timeZone === tz ? 'active' : '',
          dataset: { tz },
          onClick: () => handlers.setTimeZone(tz),
        },
        tz === 'local' ? 'Local' : 'UTC',
      ),
    ),
  );
  replaceChildren(
    root,
    h(
      'div',
      { class: 'sidebar-header' },
      h('div', { class: 'sidebar-title' }, 'Projects'),
      iconButton('search', 'Discover projects', () => discoverProjects()),
      iconButton('plus', 'Add project by ID', () => promptAddProject()),
    ),
    filterInput,
    treeEl,
    h('div', { class: 'sidebar-footer' }, h('span', { class: 'muted' }, 'Timestamps'), tzToggle),
  );
  renderTree();
  for (const project of workspace.projects) {
    if (!project.expanded) continue;
    if (!project.instancesLoadedAt) loadInstances(project);
    else loadExpandedInstances(project);
  }
}

function loadExpandedInstances(project) {
  for (const instance of project.instances || []) {
    if (instance.expanded && !instance.tablesLoadedAt && !instance.loading) loadInstanceDetails(project, instance);
  }
}

export function updateTimeZoneToggle() {
  root?.querySelectorAll('[data-tz]').forEach((b) => b.classList.toggle('active', b.dataset.tz === workspace.settings.timeZone));
}

export async function promptAddProject() {
  const values = await formDialog({
    title: 'Add project',
    description: 'Add a Google Cloud project by ID. Uses Application Default Credentials.',
    submitLabel: 'Add project',
    fields: [
      { name: 'id', label: 'Project ID', placeholder: 'my-gcp-project', required: true },
      {
        name: 'emulatorHost',
        label: 'Emulator host (optional)',
        placeholder: 'localhost:8086',
        help: 'Connect to a local Bigtable emulator instead of Google Cloud.',
      },
      { name: 'appProfileId', label: 'App profile (optional)', placeholder: 'default', help: 'Routes reads through a specific app profile / cluster.' },
    ],
  });
  if (!values?.id) return;
  const project = addProject(values);
  project.expanded = true;
  renderTree();
  loadInstances(project);
}

export async function discoverProjects() {
  const existing = new Set(workspace.projects.filter((p) => !p.emulatorHost).map((p) => p.id));
  const ids = await discoverProjectsDialog(existing);
  if (!ids?.length) return;
  for (const id of ids) addProject({ id });
  renderTree();
  toast(`Added ${ids.length} project${ids.length > 1 ? 's' : ''}`);
}

async function loadInstances(project) {
  project.loading = true;
  project.error = null;
  renderTree();
  try {
    const { instances, failedLocations } = await window.api.listInstances(connFor(project));
    const previous = new Map((project.instances || []).map((i) => [i.id, i]));
    const next = instances.map((i) => ({ ...previous.get(i.id), ...i, manual: false, tables: previous.get(i.id)?.tables || [] }));
    for (const old of previous.values()) {
      if (old.manual && !next.find((i) => i.id === old.id)) next.push(old);
    }
    next.sort((a, b) => a.id.localeCompare(b.id));
    project.instances = next;
    project.instancesLoadedAt = Date.now();
    if (failedLocations.length) toast(`Some locations could not be listed: ${failedLocations.join(', ')}`, { kind: 'warn' });
    if (next.length === 1) next[0].expanded = true;
    loadExpandedInstances(project);
  } catch (err) {
    project.error = err;
  } finally {
    project.loading = false;
    persist();
    renderTree();
  }
}

async function loadInstanceDetails(project, instance) {
  instance.loading = true;
  instance.error = null;
  renderTree();
  const conn = connFor(project);
  const [tables, clusters] = await Promise.allSettled([
    window.api.listTables(conn, instance.id),
    window.api.listClusters(conn, instance.id),
  ]);
  if (tables.status === 'fulfilled') {
    instance.tables = tables.value;
    instance.tablesLoadedAt = Date.now();
  } else {
    instance.error = tables.reason;
  }
  // Clusters are informational; the emulator does not implement them.
  instance.clusters = clusters.status === 'fulfilled' ? clusters.value : instance.clusters || [];
  instance.loading = false;
  persist();
  renderTree();
}

async function promptAddInstance(project) {
  const values = await formDialog({
    title: `Add instance to ${project.id}`,
    description: 'Use this when you can read data but not list instances.',
    submitLabel: 'Add instance',
    fields: [{ name: 'id', label: 'Instance ID', placeholder: 'my-instance', required: true }],
  });
  if (!values?.id) return;
  const instance = ensureInstance(project, values.id, { manual: true });
  project.expanded = true;
  instance.expanded = true;
  persist();
  loadInstanceDetails(project, instance);
}

async function promptAddTable(project, instance) {
  const values = await formDialog({
    title: `Add table to ${instance.id}`,
    description: 'Use this when you can read a table but not list tables.',
    submitLabel: 'Add table',
    fields: [{ name: 'id', label: 'Table ID', placeholder: 'my-table', required: true }],
  });
  if (!values?.id) return;
  instance.manualTables = [...new Set([...(instance.manualTables || []), values.id])].sort();
  instance.expanded = true;
  persist();
  renderTree();
}

async function confirmRemoveProject(project) {
  const ok = await confirmDialog({
    title: 'Remove project?',
    message: `Remove ${projectKey(project)} from the sidebar? Open query tabs are kept.`,
    confirmLabel: 'Remove',
    danger: true,
  });
  if (!ok) return;
  removeProject(projectKey(project));
  renderTree();
}

function toggleProject(project) {
  project.expanded = !project.expanded;
  persist();
  if (project.expanded && !project.instancesLoadedAt && !project.loading) loadInstances(project);
  else renderTree();
}

function toggleInstance(project, instance) {
  instance.expanded = !instance.expanded;
  persist();
  if (instance.expanded && !instance.tablesLoadedAt && !instance.loading) loadInstanceDetails(project, instance);
  else renderTree();
}

function tablesOf(instance) {
  return [...new Set([...(instance.tables || []), ...(instance.manualTables || [])])].sort((a, b) => a.localeCompare(b));
}

function clusterLabel(cluster) {
  const parts = [cluster.location];
  if (cluster.serveNodes) parts.push(`${cluster.serveNodes} node${cluster.serveNodes === 1 ? '' : 's'}${cluster.autoscaling ? ' (autoscaling)' : ''}`);
  if (cluster.storageType && cluster.storageType !== 'STORAGE_TYPE_UNSPECIFIED') parts.push(cluster.storageType);
  return parts.filter(Boolean).join(' · ');
}

function row({ depth, expanded, iconName, label, sublabel, onClick, actions = [], active = false, className, title, pill }) {
  return h(
    'div',
    {
      class: ['tree-row', className, active && 'active'],
      style: { paddingLeft: `${8 + depth * 14}px` },
      role: 'treeitem',
      tabIndex: 0,
      title,
      onClick,
      onKeydown: (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick?.(event);
        }
      },
    },
    expanded === undefined ? h('span', { class: 'twisty-space' }) : icon('chevron', { size: 12, className: ['twisty', expanded && 'open'].filter(Boolean).join(' ') }),
    icon(iconName, { size: 14, className: 'tree-icon' }),
    h('span', { class: 'tree-label' }, label, sublabel ? h('span', { class: 'tree-sublabel' }, sublabel) : null),
    pill ? h('span', { class: 'pill' }, pill) : null,
    actions.length
      ? h(
          'span',
          { class: 'tree-actions', onClick: (event) => event.stopPropagation() },
          actions.map(([name, label, fn]) => iconButton(name, label, fn, { size: 13 })),
        )
      : null,
  );
}

export function renderTree() {
  if (!treeEl) return;
  const filter = filterInput.value.trim().toLowerCase();
  const current = activeTab();
  const nodes = [];

  if (!workspace.projects.length) {
    nodes.push(
      h(
        'div',
        { class: 'tree-empty' },
        h('p', {}, 'No projects yet.'),
        h('button', { type: 'button', class: 'btn primary', onClick: () => discoverProjects() }, 'Discover projects'),
        h('button', { type: 'button', class: 'btn', onClick: () => promptAddProject() }, 'Add project by ID'),
      ),
    );
  }

  for (const project of workspace.projects) {
    const key = projectKey(project);
    const instances = project.instances || [];
    const matches = (instance) => !filter || instance.id.toLowerCase().includes(filter) || tablesOf(instance).some((t) => t.toLowerCase().includes(filter));
    if (filter && !key.toLowerCase().includes(filter) && !instances.some(matches)) continue;
    const projectOpen = filter ? true : project.expanded;

    nodes.push(
      row({
        depth: 0,
        expanded: projectOpen,
        iconName: 'project',
        label: project.id,
        pill: project.emulatorHost ? 'emulator' : null,
        title: project.emulatorHost ? `${project.id} (emulator at ${project.emulatorHost})` : project.id,
        onClick: () => toggleProject(project),
        className: 'project-row',
        actions: [
          ['refresh', 'Refresh instances', () => loadInstances(project)],
          ['plus', 'Add instance by ID', () => promptAddInstance(project)],
          ['trash', 'Remove project', () => confirmRemoveProject(project)],
        ],
      }),
    );
    if (!projectOpen) continue;

    if (project.loading) nodes.push(h('div', { class: 'tree-note', style: { paddingLeft: '36px' } }, 'Loading instances…'));
    if (project.error) {
      nodes.push(
        h(
          'div',
          { class: 'tree-note error', style: { paddingLeft: '36px' }, title: project.error.hint || '' },
          project.error.message,
          project.error.hint ? h('div', { class: 'tree-hint' }, project.error.hint) : null,
        ),
      );
    }
    if (!project.loading && !project.error && project.instancesLoadedAt && !instances.length) {
      nodes.push(h('div', { class: 'tree-note', style: { paddingLeft: '36px' } }, 'No Bigtable instances.'));
    }

    for (const instance of instances) {
      if (filter && !key.toLowerCase().includes(filter) && !matches(instance)) continue;
      const open = filter ? true : instance.expanded;
      nodes.push(
        row({
          depth: 1,
          expanded: open,
          iconName: 'instance',
          label: instance.displayName && instance.displayName !== instance.id ? instance.displayName : instance.id,
          sublabel: instance.displayName && instance.displayName !== instance.id ? instance.id : null,
          pill: instance.type === 'DEVELOPMENT' ? 'dev' : null,
          onClick: () => toggleInstance(project, instance),
          actions: [
            ['refresh', 'Refresh tables and clusters', () => loadInstanceDetails(project, instance)],
            ['plus', 'Add table by ID', () => promptAddTable(project, instance)],
          ],
        }),
      );
      if (!open) continue;
      if (instance.loading) nodes.push(h('div', { class: 'tree-note', style: { paddingLeft: '50px' } }, 'Loading tables…'));
      if (instance.error) {
        nodes.push(
          h(
            'div',
            { class: 'tree-note error', style: { paddingLeft: '50px' } },
            instance.error.message,
            instance.error.hint ? h('div', { class: 'tree-hint' }, instance.error.hint) : null,
          ),
        );
      }
      for (const cluster of instance.clusters || []) {
        nodes.push(
          row({
            depth: 2,
            iconName: 'cluster',
            label: cluster.id,
            sublabel: clusterLabel(cluster),
            className: 'cluster-row',
            title: `Cluster ${cluster.id}\n${clusterLabel(cluster)}${cluster.state ? `\nState: ${cluster.state}` : ''}`,
          }),
        );
      }
      const tables = tablesOf(instance).filter((t) => !filter || t.toLowerCase().includes(filter) || instance.id.toLowerCase().includes(filter) || key.toLowerCase().includes(filter));
      if (!instance.loading && !instance.error && instance.tablesLoadedAt && !tables.length && !filter) {
        nodes.push(h('div', { class: 'tree-note', style: { paddingLeft: '50px' } }, 'No tables.'));
      }
      for (const tableId of tables) {
        const isActive = current && current.projectKey === key && current.instanceId === instance.id && current.tableId === tableId;
        nodes.push(
          row({
            depth: 2,
            iconName: 'table',
            label: tableId,
            active: isActive,
            className: 'table-row',
            title: `${key} / ${instance.id} / ${tableId}\nClick to open · ⌥-click for a new tab`,
            onClick: (event) => handlers.openTable({ projectKey: key, instanceId: instance.id, tableId }, { newTab: event.altKey }),
            actions: [['plus', 'Open in new tab', () => handlers.openTable({ projectKey: key, instanceId: instance.id, tableId }, { newTab: true })]],
          }),
        );
      }
    }
  }
  replaceChildren(treeEl, nodes);
}

/** Makes sure a tab's table appears in the tree (e.g. a tab restored from a removed project). */
export function revealTable({ projectKey: key, instanceId, tableId }) {
  const project = findProject(key);
  if (!project || !instanceId) return;
  const instance = ensureInstance(project, instanceId, { manual: true });
  if (tableId && !tablesOf(instance).includes(tableId)) {
    instance.manualTables = [...(instance.manualTables || []), tableId].sort();
    persist();
  }
}
