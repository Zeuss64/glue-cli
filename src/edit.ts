import { diffLines } from "./diff.js";
import type { DiffLine } from "./types.js";

export interface EditOutcome {
  content: string;
  replacements: number;
  diff: DiffLine[];
}

export class EditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditError";
  }
}

/**
 * Exact search/replace. `oldString` must match the file text and, unless
 * `replaceAll` is set, must match exactly once.
 */
export function applyEdit(
  original: string,
  oldString: string,
  newString: string,
  replaceAll = false,
): EditOutcome {
  if (oldString === "") {
    throw new EditError("old_string is empty. Use write_file to create a file.");
  }
  if (oldString === newString) {
    throw new EditError("old_string and new_string are identical.");
  }
  try {
    return replaceOnce(original, oldString, newString, replaceAll);
  } catch (error) {
    if (!(error instanceof EditError) || !error.message.includes("not found")) throw error;
  }
  if (original.includes("\r\n") && oldString.includes("\n")) {
    return replaceOnce(
      original,
      oldString.replace(/\n/g, "\r\n"),
      newString.replace(/\n/g, "\r\n"),
      replaceAll,
    );
  }
  throw new EditError("old_string was not found. Read the file and copy the exact text, including whitespace.");
}

function replaceOnce(original: string, oldString: string, newString: string, replaceAll: boolean): EditOutcome {
  const count = countOf(original, oldString);
  if (count === 0) {
    throw new EditError("old_string was not found. Read the file and copy the exact text, including whitespace.");
  }
  if (count > 1 && !replaceAll) {
    throw new EditError(
      `old_string matched ${count} times. Add surrounding lines so it is unique, or set replace_all.`,
    );
  }
  const content = replaceAll ? original.split(oldString).join(newString) : original.replace(oldString, newString);
  if (content === original) throw new EditError("The edit did not change the file.");
  return { content, replacements: replaceAll ? count : 1, diff: diffLines(oldString, newString) };
}

function countOf(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  while (from <= haystack.length) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    count++;
    from = at + needle.length;
  }
  return count;
}
