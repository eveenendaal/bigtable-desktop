// Formatting Bigtable cell timestamps (microseconds since the Unix epoch) for humans.

/** Parses a microsecond timestamp (string | number | bigint) into a BigInt, or null. */
export function toMicros(value) {
  if (value === null || value === undefined || value === '') return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

/** Converts microseconds to a JS Date (millisecond precision). */
export function microsToDate(micros) {
  const m = toMicros(micros);
  if (m === null) return null;
  return new Date(Number(m / 1000n));
}

const pad = (n, width = 2) => String(n).padStart(width, '0');

/** ISO-8601 string in UTC that keeps full microsecond precision. */
export function microsToIso(micros) {
  const m = toMicros(micros);
  if (m === null) return '';
  const date = new Date(Number(m / 1000n));
  if (Number.isNaN(date.getTime())) return '';
  const subMicros = Number(((m % 1_000_000n) + 1_000_000n) % 1_000_000n);
  return `${date.toISOString().slice(0, 19)}.${pad(subMicros, 6)}Z`;
}

const UNITS = [
  ['year', 365 * 24 * 3600 * 1000],
  ['month', 30 * 24 * 3600 * 1000],
  ['week', 7 * 24 * 3600 * 1000],
  ['day', 24 * 3600 * 1000],
  ['hour', 3600 * 1000],
  ['minute', 60 * 1000],
  ['second', 1000],
];

/** "3 minutes ago", "in 2 days", "just now". */
export function formatRelative(ms, now = Date.now()) {
  const diff = ms - now;
  const abs = Math.abs(diff);
  if (abs < 5000) return 'just now';
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, size] of UNITS) {
    if (abs >= size || unit === 'second') {
      return rtf.format(Math.round(diff / size), unit);
    }
  }
  return 'just now';
}

/** Compact duration such as "2h 5m" or "3d 4h" or "850 ms". */
export function formatDuration(ms) {
  const abs = Math.abs(ms);
  if (abs < 1000) return `${Math.round(abs)} ms`;
  const parts = [];
  let rest = Math.floor(abs / 1000);
  const units = [
    ['y', 365 * 86400],
    ['d', 86400],
    ['h', 3600],
    ['m', 60],
    ['s', 1],
  ];
  for (const [label, seconds] of units) {
    if (rest >= seconds) {
      parts.push(`${Math.floor(rest / seconds)}${label}`);
      rest %= seconds;
    }
    if (parts.length === 2) break;
  }
  return parts.join(' ');
}

/**
 * Breaks a timestamp into the pieces the UI shows.
 * @param {string|bigint|number} micros
 * @param {{timeZone?: 'local'|'UTC', now?: number}} [options]
 */
export function formatTimestamp(micros, { timeZone = 'local', now = Date.now() } = {}) {
  const m = toMicros(micros);
  if (m === null) return null;
  const ms = Number(m / 1000n);
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  const tz = timeZone === 'UTC' ? 'UTC' : undefined;
  const subMicros = Number(((m % 1000n) + 1000n) % 1000n);
  const dateText = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: tz,
  }).format(date);
  const timeParts = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
    timeZone: tz,
  }).formatToParts(date);
  const get = (type) => timeParts.find((p) => p.type === type)?.value ?? '';
  const millis = pad(date.getUTCMilliseconds(), 3);
  return {
    micros: m.toString(),
    ms,
    date: dateText,
    time: `${get('hour')}:${get('minute')}:${get('second')}`,
    fraction: `.${millis}`,
    subMillis: subMicros ? pad(subMicros, 3) : '',
    zone: get('timeZoneName'),
    relative: formatRelative(ms, now),
    iso: microsToIso(m),
  };
}

/** Single-line rendering, e.g. "Tue, Oct 6, 2026 14:32:05.123 PDT". */
export function formatTimestampShort(micros, options) {
  const t = formatTimestamp(micros, options);
  if (!t) return '';
  return `${t.date} ${t.time}${t.fraction} ${t.zone}`;
}

/** Converts a value from an <input type="datetime-local"> (local time) to a Date. */
export function parseLocalDateTime(text) {
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}
