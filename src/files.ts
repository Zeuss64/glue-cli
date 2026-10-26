import { lstatSync, readdirSync } from "node:fs";
import path from "node:path";

const SKIP = new Set(["node_modules", ".git", "dist", "coverage"]);

export function listProjectFiles(root: string, limit = 1500): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length && out.length < limit) {
    const dir = stack.pop() as string;
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (out.length >= limit) break;
      const abs = path.join(dir, name);
      let st;
      try {
        st = lstatSync(abs);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (st.isDirectory()) {
        if (SKIP.has(name) || rel === ".agent/sessions") continue;
        stack.push(abs);
      } else if (st.isFile()) out.push(rel);
    }
  }
  out.sort();
  return out;
}

export function completePath(files: string[], query: string, limit = 8): string[] {
  const q = query.replace(/^\.?\//, "").toLowerCase();
  return files.filter((file) => file.toLowerCase().includes(q)).slice(0, limit);
}
