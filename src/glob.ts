function escapeReg(value: string): string {
  return value.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

/** Compile a workspace glob. A pattern with no slash matches in any directory. */
export function compileGlob(pattern: string): RegExp {
  let p = pattern.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!p.includes("/")) p = `**/${p}`;
  const segments = p.split("/");
  let re = "^";
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i] ?? "";
    const last = i === segments.length - 1;
    if (seg === "**") {
      re += last ? "(?:.+/)?" : "(?:(?:[^/]+/)*)";
    } else {
      re += escapeReg(seg).replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]");
      if (!last) re += "/";
    }
  }
  re += "$";
  return new RegExp(re);
}

export function globMatch(pattern: string, relPath: string): boolean {
  const rel = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
  return compileGlob(pattern).test(rel);
}
