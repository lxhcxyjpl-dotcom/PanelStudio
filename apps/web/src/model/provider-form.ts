import type { AIProviderConfig } from "@panelstudio/contracts";

export type ProviderPreset = "custom" | "deepseek" | "openai" | "openrouter" | "ollama";
export const providerPresets: Record<ProviderPreset, { url: string; model: string; imageInput: boolean; local: boolean }> = {
  custom: { url: "", model: "", imageInput: false, local: false },
  // Official documentation checked 2026-11-13. Presets remain editable.
  deepseek: { url: "https://api.deepseek.com", model: "deepseek-flash", imageInput: true, local: false },
  openai: { url: "https://api.openai.com/v1", model: "", imageInput: false, local: false },
  openrouter: { url: "https://openrouter.ai/api/v1", model: "", imageInput: false, local: false },
  ollama: { url: "http://localhost:11434/v1", model: "", imageInput: false, local: true },
};

export function inferProvider(baseUrl: string): ProviderPreset {
  try {
    const url = new URL(baseUrl);
    if (url.hostname === "api.deepseek.com") return "deepseek";
    if (url.hostname === "api.openai.com") return "openai";
    if (url.hostname === "openrouter.ai") return "openrouter";
    if (["localhost", "127.0.0.1"].includes(url.hostname) && url.port === "11434") return "ollama";
  } catch { /* Incomplete fields are editable. */ }
  return "custom";
}

export function endpointIdentity(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    return url.origin + url.pathname.replace(/\/+$/u, "").replace(/\/chat\/completions$/u, "");
  } catch { return null; }
}

export function addressProblem(value: string, allowLocal: boolean): string | null {
  if (!value.trim()) return "connection.addressRequired";
  if (/^(?:sk-|Bearer\s)/iu.test(value.trim())) return "connection.keyInAddress";
  const identity = endpointIdentity(value);
  if (!identity) return "connection.addressInvalid";
  const url = new URL(identity);
  if (/\/(?:messages|responses)\/?$/u.test(url.pathname)) return "connection.protocolMismatch";
  const host = url.hostname.replace(/^\[|\]$/gu, "");
  const local = host === "localhost" || host === "::1" || host === "0.0.0.0" || host.endsWith(".local") ||
    /^(?:127|10|0)\./u.test(host) || /^192\.168\./u.test(host) || /^172\.(?:1[6-9]|2\d|3[01])\./u.test(host);
  if (local && !allowLocal) return "connection.localDisabled";
  if (!local && url.protocol !== "https:") return "connection.httpsRequired";
  return null;
}

export function knownVision(baseUrl: string, model: string): boolean | undefined {
  if (inferProvider(baseUrl) !== "deepseek") return undefined;
  if (["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"].includes(model.trim())) return true;
  if (model.trim() === "deepseek-v4-pro") return false;
  return undefined;
}

export function defaultProviderForm(): AIProviderConfig {
  return { adapter: "openai-compatible", baseUrl: "", model: "", capabilities: { imageInput: false, structuredOutput: "json_object" }, allowLocalEndpoint: false };
}
