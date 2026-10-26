import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.dirname(path.dirname(fileURLToPath(import.meta.url)));
}

export function shortPath(target: string, home = process.env.HOME ?? ""): string {
  if (home && (target === home || target.startsWith(home + path.sep))) {
    return "~" + target.slice(home.length);
  }
  return target;
}
