import { lstatSync, realpathSync, existsSync } from "node:fs";
import path from "node:path";

export class SandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxError";
  }
}

/**
 * File access is limited to one or more workspace roots. Each existing path
 * segment is realpath'd so a symlink cannot point a tool outside the roots.
 */
export class Sandbox {
  readonly roots: string[];

  constructor(roots: string[]) {
    if (roots.length === 0) throw new SandboxError("Sandbox needs at least one root.");
    const resolved: string[] = [];
    for (const root of roots) {
      const abs = path.resolve(root);
      if (!existsSync(abs)) throw new SandboxError(`Workspace root does not exist: ${abs}`);
      const real = realpathSync(abs);
      if (!resolved.includes(real)) resolved.push(real);
    }
    this.roots = resolved;
  }

  get primary(): string {
    return this.roots[0] as string;
  }

  resolve(userPath: string): string {
    if (userPath.includes("\0")) throw new SandboxError("Path contains a null byte.");
    const raw = userPath.trim();
    if (!raw) throw new SandboxError("Path is empty.");
    const candidate = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(this.primary, raw);
    let real: string;
    try {
      real = existingReal(candidate);
    } catch (error) {
      if (error instanceof SandboxError) {
        throw new SandboxError(`Path is outside the workspace: ${userPath}`);
      }
      throw error;
    }
    if (!this.inside(real)) throw new SandboxError(`Path is outside the workspace: ${userPath}`);
    return real;
  }

  relative(absPath: string): string {
    const real = this.inside(absPath) ? absPath : existingReal(absPath);
    for (const root of this.roots) {
      if (real === root) return ".";
      const rel = path.relative(root, real);
      if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) return rel.split(path.sep).join("/");
    }
    return real;
  }

  inside(absPath: string): boolean {
    return this.roots.some((root) => absPath === root || absPath.startsWith(root + path.sep));
  }

  isProtected(absPath: string): boolean {
    return isProtectedRel(this.relative(absPath));
  }
}

export function isProtectedRel(rel: string): boolean {
  const n = rel.replace(/\\/g, "/");
  if (n === ".git" || n.startsWith(".git/")) return true;
  if (n.includes("/.git/") || n.endsWith("/.git")) return true;
  if (n === ".agent/sessions" || n.startsWith(".agent/sessions/")) return true;
  return false;
}

function existingReal(candidate: string): string {
  const parsed = path.parse(candidate);
  const parts = candidate.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root ? mustReal(parsed.root) : parsed.root;
  const pending: string[] = [];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") {
      if (pending.length) pending.pop();
      else current = path.dirname(current);
      continue;
    }
    const next = path.join(current, ...pending, part);
    if (linkOrExists(next)) {
      current = mustReal(next);
      pending.length = 0;
    } else {
      pending.push(part);
    }
  }
  return pending.length ? path.resolve(current, ...pending) : current;
}

function linkOrExists(target: string): boolean {
  try {
    lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

function mustReal(target: string): string {
  try {
    return realpathSync(target);
  } catch {
    throw new SandboxError(`Refusing to follow an unresolvable path: ${target}`);
  }
}
