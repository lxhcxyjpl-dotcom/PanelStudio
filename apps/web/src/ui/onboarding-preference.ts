import { useSyncExternalStore } from "react";

const KEY = "panelstudio.onboarding.v1";
const EVENT = "panelstudio-onboarding-change";
function seen() {
  try { return localStorage.getItem(KEY) === "seen"; } catch { return false; }
}
function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback);
  return () => { window.removeEventListener(EVENT, callback); window.removeEventListener("storage", callback); };
}
export function useOnboardingSeen() { return useSyncExternalStore(subscribe, seen, () => false); }
export function markOnboardingSeen() {
  try { localStorage.setItem(KEY, "seen"); } catch { /* The guide remains usable without storage. */ }
  window.dispatchEvent(new Event(EVENT));
}
