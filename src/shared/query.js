// Converts a saved "Rows" query (the form fields persisted with each tab) into
// the request BigtableService.readRows expects.
import { parseKeyInput } from './bytes.js';

export function rowsRequestFromForm(q) {
  return {
    keyMode: q.keyMode,
    prefix: parseKeyInput(q.prefix || ''),
    start: parseKeyInput(q.start || ''),
    end: parseKeyInput(q.end || ''),
    keys: (q.keys || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .map(parseKeyInput),
    families: q.families || [],
    qualifierRegex: q.qualifierRegex,
    valueRegex: q.valueRegex,
    versions: q.versions === '' ? null : q.versions,
    timeStart: q.timeStart ? new Date(q.timeStart).toISOString() : null,
    timeEnd: q.timeEnd ? new Date(q.timeEnd).toISOString() : null,
    limit: q.limit || 100,
  };
}

/** Plain description of a saved query tab, as the MCP server reports it. */
export function describeSavedQuery(tab) {
  const out = {
    id: tab.id,
    title: tab.title || tab.tableId,
    project: tab.projectKey,
    instance: tab.instanceId,
    table: tab.tableId,
    mode: tab.mode === 'sql' ? 'sql' : 'rows',
  };
  if (out.mode === 'sql') {
    out.sql = tab.sql;
  } else {
    const q = tab.query || {};
    const filters = {};
    if (q.keyMode === 'keys') filters.keys = (q.keys || '').split('\n').filter(Boolean);
    else if (q.keyMode === 'range') Object.assign(filters, { start: q.start || undefined, end: q.end || undefined });
    else if (q.prefix) filters.prefix = q.prefix;
    if (q.families?.length) filters.families = q.families;
    if (q.qualifierRegex) filters.qualifierRegex = q.qualifierRegex;
    if (q.valueRegex) filters.valueRegex = q.valueRegex;
    if (q.timeStart) filters.writtenAfter = q.timeStart;
    if (q.timeEnd) filters.writtenBefore = q.timeEnd;
    filters.versions = q.versions || 'all';
    filters.limit = q.limit;
    out.query = filters;
  }
  return out;
}

function summarizeFilters(query) {
  const parts = [];
  if (query.keys) parts.push(`keys ${query.keys.map((k) => JSON.stringify(k)).join(', ')}`);
  if (query.prefix !== undefined) parts.push(`prefix ${JSON.stringify(query.prefix)}`);
  if (query.start || query.end) parts.push(`range ${JSON.stringify(query.start ?? '')} → ${JSON.stringify(query.end ?? '')}`);
  if (!query.keys && query.prefix === undefined && !query.start && !query.end) parts.push('full table scan');
  if (query.families) parts.push(`families ${query.families.join(', ')}`);
  if (query.qualifierRegex) parts.push(`qualifier ~ /${query.qualifierRegex}/`);
  if (query.valueRegex) parts.push(`value ~ /${query.valueRegex}/`);
  if (query.writtenAfter) parts.push(`written after ${query.writtenAfter}`);
  if (query.writtenBefore) parts.push(`written before ${query.writtenBefore}`);
  parts.push(query.versions === 'all' ? 'all versions' : `${query.versions} version${query.versions === 1 ? '' : 's'} per cell`);
  if (query.limit) parts.push(`limit ${query.limit}`);
  return parts.join(' · ');
}

/**
 * Text to paste into Claude Code that points it at a saved query and the
 * results snapshot the user is looking at, via the bigtable-desktop MCP server.
 * @param {object} tab
 * @param {{rowCount: number, capturedAt: string} | null} snapshot
 */
export function mcpReferenceText(tab, snapshot) {
  const d = describeSavedQuery(tab);
  const id = JSON.stringify({ id: d.id });
  const lines = [`Bigtable Desktop query "${d.title}" (via the bigtable-desktop MCP server):`];
  if (snapshot) {
    lines.push(`- Results I'm looking at: get_query_results ${id} (${snapshot.rowCount} row${snapshot.rowCount === 1 ? '' : 's'}, captured ${snapshot.capturedAt})`);
  }
  lines.push(`- Re-run it: run_saved_query ${id}`);
  lines.push(`- Table: ${d.project} / ${d.instance} / ${d.table}`);
  if (d.mode === 'sql') {
    lines.push('- GoogleSQL:', '```sql', d.sql.trim(), '```');
  } else {
    lines.push(`- Query: ${summarizeFilters(d.query)}`);
  }
  return lines.join('\n');
}
