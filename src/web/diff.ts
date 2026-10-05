// A small line diff for previews (LCS). Large files fall back to "replace everything".

export type DiffLine = { kind: 'same' | 'add' | 'del'; text: string };
export type DiffRow = DiffLine | { kind: 'gap'; count: number };

const LIMIT = 4_000_000;

function lines(text: string | null): string[] {
  if (!text) return [];
  const split = text.replace(/\r\n/g, '\n').split('\n');
  if (split.at(-1) === '') split.pop();
  return split;
}

export function diffLines(
  before: string | null,
  after: string | null,
): DiffLine[] {
  const a = lines(before);
  const b = lines(after);
  if (a.length * b.length > LIMIT) {
    return [
      ...a.map((text) => ({ kind: 'del' as const, text })),
      ...b.map((text) => ({ kind: 'add' as const, text })),
    ];
  }
  // lcs[i][j]: longest common subsequence of a[i..] and b[j..].
  const lcs = Array.from(
    { length: a.length + 1 },
    () => new Uint32Array(b.length + 1),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] =
        a[i] === b[j]
          ? lcs[i + 1]![j + 1]! + 1
          : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ kind: 'del', text: a[i++]! });
    } else {
      out.push({ kind: 'add', text: b[j++]! });
    }
  }
  while (i < a.length) out.push({ kind: 'del', text: a[i++]! });
  while (j < b.length) out.push({ kind: 'add', text: b[j++]! });
  return out;
}

/** Keeps `context` unchanged lines around each change and folds the rest into gaps. */
export function withContext(diff: DiffLine[], context = 3): DiffRow[] {
  const keep = diff.map(() => false);
  diff.forEach((line, index) => {
    if (line.kind === 'same') return;
    for (let k = index - context; k <= index + context; k++) {
      if (k >= 0 && k < diff.length) keep[k] = true;
    }
  });
  const rows: DiffRow[] = [];
  let gap = 0;
  diff.forEach((line, index) => {
    if (keep[index]) {
      if (gap) rows.push({ kind: 'gap', count: gap });
      gap = 0;
      rows.push(line);
    } else gap++;
  });
  if (gap) rows.push({ kind: 'gap', count: gap });
  return rows;
}
