import type { KeyIn } from "./editor.js";

/**
 * Bytes from the console, before Ink labels them.
 *
 * Ink's parser maps both Backspace (`\x7f` on Windows Terminal and on conhost
 * once virtual-terminal input is on) and the Delete key (`CSI 3 ~`) to
 * `key.delete`, then clears `input`. Forward-delete at the end of the line
 * is a no-op, which is why Backspace looks dead until Ctrl+A moves the cursor
 * to the start. Windows also delivers a typed character and the following
 * Backspace in one read while an IME is committing; parsing that chunk as a
 * single key inserts the backspace instead of applying it.
 */
export interface DecodeState {
  pending: string;
  paste: string | null;
}

export function emptyDecodeState(): DecodeState {
  return { pending: "", paste: null };
}

export function pushConsoleChunk(state: DecodeState, chunk: string): { state: DecodeState; keys: KeyIn[] } {
  const keys: KeyIn[] = [];
  const text = state.pending + chunk;
  let paste = state.paste;
  let i = 0;

  while (i < text.length) {
    if (paste !== null) {
      const end = text.indexOf("\x1b[201~", i);
      if (end === -1) {
        const tail = suffixPrefix(text.slice(i), "\x1b[201~");
        paste += text.slice(i, text.length - tail.length);
        return { state: { pending: tail, paste }, keys };
      }
      paste += text.slice(i, end);
      push(keys, { ...blankKey(), input: paste });
      paste = null;
      i = end + "\x1b[201~".length;
      continue;
    }

    const ch = text[i] ?? "";
    if (ch === "\x1b") {
      const rest = text.slice(i);
      if (rest.startsWith("\x1b[200~")) {
        paste = "";
        i += "\x1b[200~".length;
        continue;
      }
      const parsed = parseEscape(rest);
      if (parsed.incomplete) return { state: { pending: rest, paste }, keys };
      if (parsed.key) push(keys, parsed.key);
      i += parsed.length;
      continue;
    }
    if (ch === "\x7f" || ch === "\b") {
      push(keys, { ...blankKey(), backspace: true });
      i += 1;
      continue;
    }
    if (ch === "\r") {
      push(keys, { ...blankKey(), return: true });
      i += 1;
      if (text[i] === "\n") i += 1;
      continue;
    }
    if (ch === "\n") {
      push(keys, { ...blankKey(), return: true });
      i += 1;
      continue;
    }
    if (ch === "\t") {
      push(keys, { ...blankKey(), tab: true });
      i += 1;
      continue;
    }
    if (ch === "\x00" || ch === "\xe0") {
      if (i + 1 >= text.length) return { state: { pending: text.slice(i), paste }, keys };
      const legacy = legacyKey(text[i + 1] ?? "");
      if (legacy) push(keys, legacy);
      i += 2;
      continue;
    }
    const code = text.charCodeAt(i);
    if (code >= 1 && code <= 26) {
      push(keys, { ...blankKey(), ctrl: true, input: String.fromCharCode(code + 96) });
      i += 1;
      continue;
    }

    let j = i + 1;
    while (j < text.length && isPrintable(text, j)) j += 1;
    push(keys, { ...blankKey(), input: text.slice(i, j) });
    i = j;
  }

  return { state: { pending: "", paste }, keys };
}

export function blankKey(): KeyIn {
  return {
    input: "",
    ctrl: false,
    meta: false,
    shift: false,
    return: false,
    escape: false,
    tab: false,
    backspace: false,
    delete: false,
    up: false,
    down: false,
    left: false,
    right: false,
    pageUp: false,
    pageDown: false,
    home: false,
    end: false,
    wheelUp: false,
    wheelDown: false,
  };
}

function push(keys: KeyIn[], key: KeyIn): void {
  if (key.input || key.ctrl || key.meta || key.return || key.escape || key.tab || key.backspace || key.delete || key.up || key.down || key.left || key.right || key.pageUp || key.pageDown || key.home || key.end || key.wheelUp || key.wheelDown) {
    keys.push(key);
  }
}

function isPrintable(text: string, index: number): boolean {
  const ch = text[index] ?? "";
  if (ch === "\x1b" || ch === "\x7f" || ch === "\b" || ch === "\r" || ch === "\n" || ch === "\t" || ch === "\x00" || ch === "\xe0") return false;
  const code = text.charCodeAt(index);
  return code > 26;
}

function parseEscape(text: string): { incomplete: boolean; length: number; key?: KeyIn } {
  if (text.length < 2) return { incomplete: false, length: 1, key: { ...blankKey(), escape: true } };
  const second = text[1] ?? "";

  if (second === "O" || second === "N") {
    if (text.length < 3) return { incomplete: true, length: 0 };
    const letter = text[2] ?? "";
    const key = arrowFromLetter(letter);
    if (letter >= "a" && letter <= "d") key.ctrl = true;
    return { incomplete: false, length: 3, key };
  }

  if (second === "[") {
    let n = 2;
    while (n < text.length && n - 2 <= 48) {
      const code = text.charCodeAt(n);
      if (code >= 0x40 && code <= 0x7e) {
        return { incomplete: false, length: n + 1, key: csiKey(text.slice(2, n), text[n] ?? "") };
      }
      if (code < 0x20 || code > 0x3f) break;
      n += 1;
    }
    if (n >= text.length && text.length < 48) return { incomplete: true, length: 0 };
    return { incomplete: false, length: 1, key: { ...blankKey(), escape: true } };
  }

  if (second === "\x7f" || second === "\b") {
    return { incomplete: false, length: 2, key: { ...blankKey(), backspace: true, meta: true } };
  }

  if (second === "\x1b") return { incomplete: false, length: 1, key: { ...blankKey(), escape: true } };

  const codePoint = text.codePointAt(1);
  if (codePoint === undefined) return { incomplete: true, length: 0 };
  const ch = String.fromCodePoint(codePoint);
  if (1 + ch.length > text.length) return { incomplete: true, length: 0 };
  const key = blankKey();
  key.meta = true;
  key.shift = ch >= "A" && ch <= "Z";
  key.input = ch;
  return { incomplete: false, length: 1 + ch.length, key };
}

function csiKey(body: string, final: string): KeyIn {
  const key = blankKey();
  if (body.startsWith("<")) return mouseKey(body, final);
  if (final === "Z") {
    key.tab = true;
    key.shift = true;
    return key;
  }
  const numbers = body.split(";").map((part) => part.replace(/[^\d]/g, "")).filter((part) => part.length > 0).map((part) => Number(part));
  const primary = numbers[0] ?? 0;
  applyModifier(key, numbers.length > 1 ? (numbers[1] ?? 1) : 1);
  if (final === "u") return kittyKey(key, primary);
  if (final === "~" && primary === 27) return modifyOtherKeys(key, numbers);
  if (final === "A" || final === "a") key.up = true;
  else if (final === "B" || final === "b") key.down = true;
  else if (final === "C" || final === "c") key.right = true;
  else if (final === "D" || final === "d") key.left = true;
  else if (final === "H") key.home = true;
  else if (final === "F") key.end = true;
  else if (final === "~") {
    if (primary === 1 || primary === 7) key.home = true;
    else if (primary === 3) key.delete = true;
    else if (primary === 4 || primary === 8) key.end = true;
    else if (primary === 5) key.pageUp = true;
    else if (primary === 6) key.pageDown = true;
  }
  if (final >= "a" && final <= "d") key.shift = true;
  return key;
}

/** Scan codes from legacy conhost when virtual-terminal input is off (`\x00` or `\xE0` plus a byte). */
function legacyKey(scan: string): KeyIn | undefined {
  const key = blankKey();
  switch (scan) {
    case "H":
      key.up = true;
      break;
    case "P":
      key.down = true;
      break;
    case "K":
      key.left = true;
      break;
    case "M":
      key.right = true;
      break;
    case "G":
      key.home = true;
      break;
    case "O":
      key.end = true;
      break;
    case "I":
      key.pageUp = true;
      break;
    case "Q":
      key.pageDown = true;
      break;
    case "S":
      key.delete = true;
      break;
    case "\x0f":
      key.tab = true;
      key.shift = true;
      break;
    default:
      return undefined;
  }
  return key;
}

/** SGR mouse: `\x1b[<button;x;yM`. Wheel is button 64 (up) and 65 (down). */
function mouseKey(body: string, final: string): KeyIn {
  const key = blankKey();
  if (final !== "M" && final !== "m") return key;
  const parts = body.slice(1).split(";");
  const button = Number(parts[0] ?? "");
  if (!Number.isFinite(button)) return key;
  const base = button & ~0b11100;
  if (base === 64) key.wheelUp = true;
  else if (base === 65) key.wheelDown = true;
  return key;
}

/** Kitty keyboard protocol. Tab is code point 9 (`CSI 9 u`). */
function kittyKey(key: KeyIn, code: number): KeyIn {
  if (code === 9) {
    key.tab = true;
    key.input = "";
    return key;
  }
  if (code === 13) {
    key.return = true;
    key.input = "";
    return key;
  }
  if (code === 27) {
    key.escape = true;
    key.input = "";
    return key;
  }
  if (code >= 32) key.input = String.fromCodePoint(code);
  return key;
}

/** xterm modifyOtherKeys: `CSI 27 ; modifier ; key ~`. Tab is key 9. */
function modifyOtherKeys(key: KeyIn, numbers: number[]): KeyIn {
  const code = numbers[2] ?? 0;
  if (code === 9) {
    key.tab = true;
    key.input = "";
    return key;
  }
  if (code === 13) {
    key.return = true;
    key.input = "";
    return key;
  }
  return key;
}

function arrowFromLetter(letter: string): KeyIn {
  const key = blankKey();
  if (letter === "A" || letter === "a") key.up = true;
  else if (letter === "B" || letter === "b") key.down = true;
  else if (letter === "C" || letter === "c") key.right = true;
  else if (letter === "D" || letter === "d") key.left = true;
  else if (letter === "H") key.home = true;
  else if (letter === "F") key.end = true;
  return key;
}

function applyModifier(key: KeyIn, modifier: number): void {
  const bits = Math.max(0, modifier - 1);
  key.shift = Boolean(bits & 1);
  key.meta = Boolean(bits & 2);
  key.ctrl = Boolean(bits & 4);
}

function suffixPrefix(text: string, marker: string): string {
  const max = Math.min(text.length, marker.length - 1);
  for (let length = max; length > 0; length -= 1) {
    if (marker.startsWith(text.slice(text.length - length))) return text.slice(text.length - length);
  }
  return "";
}
