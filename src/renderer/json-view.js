// JSON rendering: syntax-highlighted pretty text and a collapsible tree.
import { h } from './dom.js';

const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

/** Highlights one line of pretty-printed JSON. */
export function highlightJsonLine(line) {
  const nodes = [];
  let last = 0;
  for (const match of line.matchAll(TOKEN)) {
    if (match.index > last) nodes.push(line.slice(last, match.index));
    if (match[1]) {
      nodes.push(h('span', { class: match[2] ? 'j-key' : 'j-str' }, match[1]));
      if (match[2]) nodes.push(match[2]);
    } else if (match[3]) {
      nodes.push(h('span', { class: match[3] === 'null' ? 'j-null' : 'j-bool' }, match[3]));
    } else {
      nodes.push(h('span', { class: 'j-num' }, match[4]));
    }
    last = match.index + match[0].length;
  }
  if (last < line.length) nodes.push(line.slice(last));
  return nodes;
}

export function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

/** <pre> with syntax highlighting and line numbers. */
export function renderJsonText(value) {
  const lines = prettyJson(value).split('\n');
  return h(
    'pre',
    { class: 'code json-text' },
    lines.map((line, i) => h('div', { class: 'code-line' }, h('span', { class: 'ln' }, String(i + 1)), h('span', { class: 'lc' }, highlightJsonLine(line)))),
  );
}

function scalar(value) {
  if (value === null) return h('span', { class: 'j-null' }, 'null');
  switch (typeof value) {
    case 'string':
      return h('span', { class: 'j-str' }, JSON.stringify(value));
    case 'number':
      return h('span', { class: 'j-num' }, String(value));
    case 'boolean':
      return h('span', { class: 'j-bool' }, String(value));
    default:
      return h('span', {}, String(value));
  }
}

function summary(value) {
  if (Array.isArray(value)) return `[ ${value.length} item${value.length === 1 ? '' : 's'} ]`;
  const n = Object.keys(value).length;
  return `{ ${n} key${n === 1 ? '' : 's'} }`;
}

function treeNode(key, value, depth, expandDepth) {
  const label = key === null ? null : h('span', { class: 'j-key' }, typeof key === 'number' ? String(key) : JSON.stringify(key), ': ');
  if (value === null || typeof value !== 'object') {
    return h('div', { class: 'jt-leaf' }, label, scalar(value));
  }
  const entries = Array.isArray(value) ? value.map((v, i) => [i, v]) : Object.entries(value);
  if (!entries.length) return h('div', { class: 'jt-leaf' }, label, h('span', { class: 'j-punct' }, Array.isArray(value) ? '[]' : '{}'));
  const details = h('details', { class: 'jt-node', open: depth < expandDepth });
  const body = h('div', { class: 'jt-children' });
  let rendered = false;
  const renderChildren = () => {
    if (rendered) return;
    rendered = true;
    for (const [k, v] of entries) body.append(treeNode(k, v, depth + 1, expandDepth));
  };
  details.append(h('summary', {}, label, h('span', { class: 'jt-summary' }, summary(value))), body);
  // Render lazily so huge documents stay fast.
  if (details.open) renderChildren();
  details.addEventListener('toggle', renderChildren);
  return details;
}

export function renderJsonTree(value, { expandDepth = 2 } = {}) {
  return h('div', { class: 'json-tree code' }, treeNode(null, value, 0, expandDepth));
}
