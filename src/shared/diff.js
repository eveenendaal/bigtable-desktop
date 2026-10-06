// Minimal line diff used to compare two versions of a cell.

const MAX_CELLS = 4_000_000; // Upper bound on the LCS table size.

/**
 * Returns a list of {type: 'same'|'add'|'del', text} entries describing how to
 * turn `before` into `after`.
 */
export function diffLines(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');

  // Trim common prefix/suffix to keep the table small.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const out = a.slice(0, start).map((text) => ({ type: 'same', text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  if (midA.length * midB.length > MAX_CELLS) {
    for (const text of midA) out.push({ type: 'del', text });
    for (const text of midB) out.push({ type: 'add', text });
  } else {
    const n = midA.length;
    const m = midB.length;
    const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i][j] = midA[i] === midB[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        out.push({ type: 'same', text: midA[i] });
        i++;
        j++;
      } else if (table[i + 1][j] >= table[i][j + 1]) {
        out.push({ type: 'del', text: midA[i++] });
      } else {
        out.push({ type: 'add', text: midB[j++] });
      }
    }
    while (i < n) out.push({ type: 'del', text: midA[i++] });
    while (j < m) out.push({ type: 'add', text: midB[j++] });
  }

  for (const text of a.slice(endA)) out.push({ type: 'same', text });
  return out;
}

export function diffStats(entries) {
  let added = 0;
  let removed = 0;
  for (const e of entries) {
    if (e.type === 'add') added++;
    else if (e.type === 'del') removed++;
  }
  return { added, removed };
}
