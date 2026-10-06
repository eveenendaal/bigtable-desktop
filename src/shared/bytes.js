// Byte helpers shared by the main process and the renderer.
// Only uses web-standard APIs so it can be loaded in both environments.

const strictDecoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();

export function toBytes(value) {
  if (value == null) return new Uint8Array(0);
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return encoder.encode(String(value));
}

export function utf8Encode(text) {
  return encoder.encode(text);
}

/** Decodes UTF-8, returning null when the bytes are not valid UTF-8. */
export function utf8Decode(bytes) {
  try {
    return strictDecoder.decode(toBytes(bytes));
  } catch {
    return null;
  }
}

export function toHex(bytes, { separator = '' } = {}) {
  return Array.from(toBytes(bytes), (b) => b.toString(16).padStart(2, '0')).join(separator);
}

export function toBase64(bytes) {
  let binary = '';
  const view = toBytes(bytes);
  for (let i = 0; i < view.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, view.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function fromBase64(text) {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// eslint-disable-next-line no-control-regex
const NON_PRINTABLE = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * Human readable rendering of a row key or column qualifier. Printable UTF-8 is
 * shown as-is; anything else is shown with \xNN escapes so binary keys stay
 * readable and unambiguous.
 */
export function displayBytes(bytes) {
  const view = toBytes(bytes);
  const text = utf8Decode(view);
  if (text !== null && !NON_PRINTABLE.test(text)) return text;
  let out = '';
  for (const b of view) {
    out += b >= 0x20 && b < 0x7f && b !== 0x5c ? String.fromCharCode(b) : `\\x${b.toString(16).padStart(2, '0')}`;
  }
  return out;
}

/** Parses a key typed by the user. Supports \xNN escapes for binary bytes. */
export function parseKeyInput(text) {
  if (!text.includes('\\x') && !text.includes('\\\\')) return utf8Encode(text);
  const parts = [];
  let literal = '';
  const flush = () => {
    if (literal) parts.push(...utf8Encode(literal));
    literal = '';
  };
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\' && text[i + 1] === 'x' && /^[0-9a-fA-F]{2}$/.test(text.slice(i + 2, i + 4))) {
      flush();
      parts.push(parseInt(text.slice(i + 2, i + 4), 16));
      i += 3;
    } else if (text[i] === '\\' && text[i + 1] === '\\') {
      literal += '\\';
      i += 1;
    } else {
      literal += text[i];
    }
  }
  flush();
  return Uint8Array.from(parts);
}

/** Smallest key that is greater than every key starting with `prefix`, or null if none. */
export function prefixSuccessor(prefix) {
  const bytes = Array.from(toBytes(prefix));
  while (bytes.length && bytes[bytes.length - 1] === 0xff) bytes.pop();
  if (!bytes.length) return null;
  bytes[bytes.length - 1] += 1;
  return Uint8Array.from(bytes);
}

export function compareBytes(a, b) {
  const x = toBytes(a);
  const y = toBytes(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    if (x[i] !== y[i]) return x[i] - y[i];
  }
  return x.length - y.length;
}

export function formatSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
