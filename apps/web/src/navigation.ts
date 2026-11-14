import { create } from "zustand";

export type Route = { kind: "home" } | { kind: "editor"; projectId: string | null } | { kind: "missing" };
export function parseRoute(path: string): Route {
  if (path === "/") return { kind: "home" };
  if (path === "/app" || path === "/app/") return { kind: "editor", projectId: null };
  const match = /^\/app\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i.exec(path);
  return match ? { kind: "editor", projectId: match[1]! } : { kind: "missing" };
}
export const projectPath = (id: string) => `/app/${encodeURIComponent(id)}`;
const initialPath = typeof location === "undefined" ? "/" : location.pathname;
export const useNavigation = create<{ path: string; loading: boolean; error: string | null; notice: string | null }>(() => ({
  path: initialPath, loading: true, error: null, notice: null,
}));
type Resolve = (route: Route, isCurrent: () => boolean) => Promise<string | undefined>;
let resolveRoute: Resolve = async () => undefined;
let canLeave: () => Promise<boolean> = async () => true;
let index = 0;
let sequence = 0;
let restoring = false;
const scroll = new Map<number, number>();

function historyEntry(next: number) { return { ...history.state, panelstudioIndex: next }; }
/** Called only after a project has been created or imported successfully. */
export function adoptProjectPath(id: string, replace = false): void {
  commitPath(projectPath(id), replace ? "replace" : "push");
}
export function commitPath(path: string, mode: "push" | "replace" = "push", popIndex?: number): void {
  if (typeof window === "undefined") return;
  scroll.set(index, window.scrollY);
  if (popIndex !== undefined) {
    index = popIndex;
    if (location.pathname !== path) history.replaceState(historyEntry(index), "", path);
  } else if (mode === "replace" || location.pathname === path) {
    history.replaceState(historyEntry(index), "", path);
  } else {
    index += 1;
    history.pushState(historyEntry(index), "", path);
  }
  useNavigation.setState({ path, error: null, notice: null, loading: false });
  requestAnimationFrame(() => window.scrollTo({ top: popIndex === undefined ? 0 : scroll.get(index) ?? 0, behavior: "instant" }));
}
export async function navigate(path: string, options: { replace?: boolean; popIndex?: number; initial?: boolean } = {}): Promise<boolean> {
  const ticket = ++sequence;
  useNavigation.setState({ loading: true, error: null, notice: null });
  try {
    if (!options.initial && !await canLeave()) {
      if (ticket !== sequence) return false;
      if (options.popIndex !== undefined && options.popIndex !== index) {
        restoring = true;
        history.go(index - options.popIndex);
      }
      return false;
    }
    if (ticket !== sequence) return false;
    const canonical = await resolveRoute(parseRoute(path), () => ticket === sequence);
    if (ticket !== sequence) return false;
    commitPath(canonical ?? path, options.replace ? "replace" : "push", options.popIndex);
    return true;
  } catch (error) {
    if (ticket !== sequence) return false;
    commitPath(path, options.replace ? "replace" : "push", options.popIndex);
    useNavigation.setState({ error: error instanceof Error ? error.message : String(error) });
    return false;
  } finally {
    if (ticket === sequence) useNavigation.setState({ loading: false });
  }
}
export function connectNavigation(resolve: Resolve, guard: () => Promise<boolean>): () => void {
  resolveRoute = resolve;
  canLeave = guard;
  index = typeof history.state?.panelstudioIndex === "number" ? history.state.panelstudioIndex : 0;
  history.replaceState(historyEntry(index), "", location.href);
  history.scrollRestoration = "manual";
  const onPop = (event: PopStateEvent) => {
    if (restoring) { restoring = false; return; }
    const target = typeof event.state?.panelstudioIndex === "number" ? event.state.panelstudioIndex : index - 1;
    void navigate(location.pathname, { popIndex: target });
  };
  window.addEventListener("popstate", onPop);
  return () => window.removeEventListener("popstate", onPop);
}
