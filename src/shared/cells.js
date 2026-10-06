// Interpreting cell values: JSON detection, previews and plain-object conversion.
import { toBytes, utf8Decode, toBase64, displayBytes } from './bytes.js';

/**
 * Classifies a cell value.
 * @returns {{kind: 'empty'|'json'|'text'|'binary', size: number, text: string|null, json?: any, int64?: string}}
 */
export function describeValue(value) {
  const bytes = toBytes(value);
  const size = bytes.length;
  if (size === 0) return { kind: 'empty', size, text: '' };
  const text = utf8Decode(bytes);
  if (text !== null) {
    const trimmed = text.trim();
    const first = trimmed[0];
    if (first === '{' || first === '[') {
      try {
        return { kind: 'json', size, text, json: JSON.parse(trimmed) };
      } catch {
        // Not JSON after all, fall through to text.
      }
    }
    // eslint-disable-next-line no-control-regex
    if (!/[\u0000-\u0008\u000e-\u001f]/.test(text)) return { kind: 'text', size, text };
  }
  const result = { kind: 'binary', size, text: null };
  if (size === 8) {
    // Bigtable counters (ReadModifyWrite increments) are 64-bit big-endian integers.
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    result.int64 = view.getBigInt64(0).toString();
  }
  return result;
}

/** One-line preview suitable for a grid cell. */
export function previewValue(desc, max = 160) {
  let text;
  switch (desc.kind) {
    case 'empty':
      return '';
    case 'json':
      text = JSON.stringify(desc.json);
      break;
    case 'text':
      text = desc.text.replace(/\s+/g, ' ');
      break;
    default:
      text = desc.int64 !== undefined ? `${desc.int64} (int64)` : `‹binary ${desc.size} B›`;
  }
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Converts a cell value into something that serializes nicely into JSON exports. */
export function valueToPlain(value) {
  const desc = describeValue(value);
  switch (desc.kind) {
    case 'empty':
      return '';
    case 'json':
      return desc.json;
    case 'text':
      return desc.text;
    default:
      return desc.int64 !== undefined
        ? { $base64: toBase64(value), $int64: desc.int64 }
        : { $base64: toBase64(value) };
  }
}

/** Column identifier used for grouping cells in result grids. */
export function columnId(family, qualifier) {
  return `${family}:${displayBytes(qualifier)}`;
}
