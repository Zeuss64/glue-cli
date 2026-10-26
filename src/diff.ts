import type { DiffLine } from "./types.js";

const MAX_LINES = 800;

/**
 * Line diff of two snippets. Used to show an edit the way a terminal coding
 * agent does: removed lines, added lines, and a little unchanged context.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);
  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    return [
      ...a.slice(0, 40).map((text, i) => ({ kind: "del" as const, text, oldNo: i + 1 })),
      ...b.slice(0, 40).map((text, i) => ({ kind: "add" as const, text, newNo: i + 1 })),
    ];
  }
  const lcs = buildLcs(a, b);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let oldNo = 1;
  let newNo = 1;
  for (const [ai, bj] of lcs) {
    while (i < ai) {
      out.push({ kind: "del", text: a[i] ?? "", oldNo });
      i++;
      oldNo++;
    }
    while (j < bj) {
      out.push({ kind: "add", text: b[j] ?? "", newNo });
      j++;
      newNo++;
    }
    out.push({ kind: "ctx", text: a[i] ?? "", oldNo, newNo });
    i++;
    j++;
    oldNo++;
    newNo++;
  }
  while (i < a.length) {
    out.push({ kind: "del", text: a[i] ?? "", oldNo });
    i++;
    oldNo++;
  }
  while (j < b.length) {
    out.push({ kind: "add", text: b[j] ?? "", newNo });
    j++;
    newNo++;
  }
  return out;
}

export function diffStats(lines: DiffLine[]): { add: number; del: number } {
  let add = 0;
  let del = 0;
  for (const line of lines) {
    if (line.kind === "add") add++;
    else if (line.kind === "del") del++;
  }
  return { add, del };
}

/** Keep changed lines plus a little context, for the transcript. */
export function compactDiff(lines: DiffLine[], context = 2, limit = 24): DiffLine[] {
  const interesting = new Set<number>();
  lines.forEach((line, index) => {
    if (line.kind === "ctx") return;
    for (let i = Math.max(0, index - context); i <= Math.min(lines.length - 1, index + context); i++) {
      interesting.add(i);
    }
  });
  const kept: DiffLine[] = [];
  let skipped = false;
  for (let i = 0; i < lines.length; i++) {
    if (!interesting.has(i)) {
      skipped = true;
      continue;
    }
    if (skipped && kept.length) {
      kept.push({ kind: "ctx", text: "…" });
    }
    skipped = false;
    kept.push(lines[i] as DiffLine);
    if (kept.length >= limit) {
      if (i < lines.length - 1) kept.push({ kind: "ctx", text: "…" });
      break;
    }
  }
  return kept;
}

function splitLines(value: string): string[] {
  if (value === "") return [];
  const parts = value.split("\n");
  if (parts[parts.length - 1] === "") parts.pop();
  return parts;
}

function buildLcs(a: string[], b: string[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? (dp[i + 1]?.[j + 1] ?? 0) + 1 : Math.max(dp[i + 1]?.[j] ?? 0, dp[i]?.[j + 1] ?? 0);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) i++;
    else j++;
  }
  return pairs;
}
