import type { FileSnap } from "./types.js";

/** First before-image of each path from `fromIndex` onward wins. */
export function snapsToRestore(checkpoints: Array<{ files: FileSnap[] }>, fromIndex: number): FileSnap[] {
  const map = new Map<string, string | null>();
  for (let i = Math.max(0, fromIndex); i < checkpoints.length; i++) {
    for (const file of checkpoints[i]?.files ?? []) {
      if (!map.has(file.path)) map.set(file.path, file.content);
    }
  }
  return [...map.entries()].map(([filePath, content]) => ({ path: filePath, content }));
}
