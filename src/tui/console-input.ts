import { useEffect, useRef } from "react";
import { useStdin } from "ink";
import type { KeyIn } from "./editor.js";
import { emptyDecodeState, pushConsoleChunk, type DecodeState } from "./keys.js";

/**
 * Read raw stdin chunks and split them into keys.
 * Ink collapses a whole `read()` into one key, which drops Windows backspace
 * when it arrives as DEL or in the same chunk as an IME commit.
 */
export function useConsoleInput(onKey: (key: KeyIn) => void): void {
  const onKeyRef = useRef(onKey);
  onKeyRef.current = onKey;
  const decodeRef = useRef<DecodeState>(emptyDecodeState());
  const { setRawMode, internal_eventEmitter } = useStdin();

  useEffect(() => {
    setRawMode(true);
    const onInput = (chunk: string | Buffer) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      const parsed = pushConsoleChunk(decodeRef.current, text);
      decodeRef.current = parsed.state;
      for (const key of parsed.keys) onKeyRef.current(key);
    };
    internal_eventEmitter.on("input", onInput);
    return () => {
      internal_eventEmitter.off("input", onInput);
      setRawMode(false);
    };
  }, [internal_eventEmitter, setRawMode]);
}
