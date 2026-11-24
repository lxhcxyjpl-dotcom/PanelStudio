import { create } from "zustand";
import type { AIProviderSettings } from "@panelstudio/contracts";
import { queryClient } from "./query";
import type { ReadingMode } from "./wish-session";

const key = "panelstudio.visual-reading";
function readPreference(): boolean | null {
  try {
    const value = localStorage.getItem(key);
    return value === "off" ? false : value === "on" ? true : null;
  } catch {
    return null;
  }
}
export const useReadingPreference = create<{ enabled: boolean | null }>(() => ({
  enabled: readPreference(),
}));
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === key || event.key === null) useReadingPreference.setState({ enabled: readPreference() });
  });
}
export function setReadingPreference(enabled: boolean) {
  useReadingPreference.setState({ enabled });
  try {
    localStorage.setItem(key, enabled ? "on" : "off");
  } catch {
    /* The choice still applies to this session. */
  }
}
export function cachedReadingProvider() {
  return queryClient.getQueryData<AIProviderSettings>(["ai-provider"]);
}
export function preferredReadingMode(provider = cachedReadingProvider()): ReadingMode {
  if (!provider?.hasSecret || !provider.config) return "local";
  const visual = provider.config.capabilities.imageInput;
  if (!(useReadingPreference.getState().enabled ?? visual)) return "local";
  return visual ? "thumbnails" : "text";
}
