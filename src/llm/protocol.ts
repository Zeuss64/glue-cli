export type ApiProtocol = "openai" | "anthropic";

export interface ApiClientOptions {
  baseURL: string;
  apiKey?: string;
  model: string;
  temperature: number;
  maxTokens: number;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
  protocol?: ApiProtocol;
}

/** Explicit `openai` or `anthropic` wins. Otherwise infer from a URL that names one style. */
export function resolveProtocol(explicit: string | undefined, baseURL: string): ApiProtocol {
  const named = normalizeProtocol(explicit);
  if (named) return named;
  return inferProtocol(baseURL) ?? "openai";
}

export function normalizeProtocol(value: string | undefined): ApiProtocol | undefined {
  if (!value?.trim()) return undefined;
  const name = value.trim().toLowerCase();
  if (name === "openai" || name === "chat" || name === "chat-completions") return "openai";
  if (name === "anthropic" || name === "messages") return "anthropic";
  throw new Error(`Unknown API protocol ${value}. Use openai or anthropic.`);
}

export function inferProtocol(baseURL: string): ApiProtocol | undefined {
  let url: URL;
  try {
    url = new URL(baseURL);
  } catch {
    return undefined;
  }
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase().replace(/\/+$/, "");
  if (host === "api.anthropic.com" || host.endsWith(".anthropic.com")) return "anthropic";
  if (path.includes("/chat/completions")) return "openai";
  if (path.endsWith("/messages")) return "anthropic";
  return undefined;
}

export function messagesEndpoint(baseURL: string): string {
  const trimmed = baseURL.trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    if (trimmed.endsWith("/messages")) return trimmed;
    if (trimmed.endsWith("/v1")) return `${trimmed}/messages`;
    return `${trimmed}/v1/messages`;
  }
  const path = url.pathname.replace(/\/+$/, "") || "";
  if (path.endsWith("/messages")) return stringify(url);
  url.pathname = path.endsWith("/v1") ? `${path}/messages` : `${path}/v1/messages`;
  return stringify(url);
}

function stringify(url: URL): string {
  const text = url.toString();
  return text.endsWith("/") ? text.slice(0, -1) : text;
}
