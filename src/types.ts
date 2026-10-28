export type PermissionMode =
  | "default"
  | "acceptEdits"
  | "plan"
  | "auto"
  | "yolo"
  | "dontAsk"
  | "bypassPermissions";

export interface TokenUsage {
  input: number;
  output: number;
  /** Tokens served from the prompt cache. Absent until the API reports them. */
  cacheRead?: number;
  /** Tokens written into the prompt cache. Absent until the API reports them. */
  cacheWrite?: number;
}

export interface PermissionRules {
  allow: string[];
  deny: string[];
  ask: string[];
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface DiffLine {
  kind: "ctx" | "add" | "del";
  text: string;
  oldNo?: number;
  newNo?: number;
}

export interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface FileSnap {
  path: string;
  content: string | null;
}

export type TranscriptItem =
  | { id: string; type: "user"; text: string; queued?: boolean; attached?: string[]; gap?: boolean }
  | { id: string; type: "assistant"; text: string; streaming?: boolean }
  | { id: string; type: "system"; text: string }
  | { id: string; type: "error"; text: string }
  | {
      id: string;
      type: "tool";
      name: string;
      target: string;
      status: "running" | "ok" | "error" | "denied";
      summary?: string;
      diff?: DiffLine[];
      detail?: string;
      /** Set on a viewport slice. Omitted or true paints the tool name row. */
      showHeader?: boolean;
    };

export interface LlmDelta {
  text?: string;
  toolCall?: { index: number; id?: string; name?: string; arguments?: string };
  usage?: TokenUsage;
  finishReason?: string | null;
}

export interface LlmResult {
  text: string;
  toolCalls: ToolCall[];
  usage: TokenUsage;
  finishReason: string | null;
}
