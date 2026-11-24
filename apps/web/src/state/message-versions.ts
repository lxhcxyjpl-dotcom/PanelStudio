import { create } from "zustand";
import { api, newKey } from "../api/client";
import type { MessageBranchRequest } from "@panelstudio/contracts";

export type VersionRef = { group: string; id: string };
export type VersionLink = VersionRef & { project: string; job?: string; at: number };
const prefix = "panelstudio.message-version.";
function readLinks(): VersionLink[] {
  const links: VersionLink[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(prefix)) continue;
      const item = JSON.parse(localStorage.getItem(key) ?? "null") as VersionLink | null;
      if (item && typeof item.id === "string" && typeof item.group === "string" && typeof item.project === "string" && Number.isFinite(item.at)) links.push(item);
    }
  } catch { /* Edits can still be used in this tab. */ }
  return links;
}
export const useVersionLinks = create<{links: VersionLink[]}>(() => ({ links: readLinks() }));
if (typeof window !== "undefined") window.addEventListener("storage", event => {
  if (!event.key || event.key.startsWith(prefix)) useVersionLinks.setState({ links: readLinks() });
});
export function registerVersion(item: VersionLink) {
  const previous = useVersionLinks.getState().links;
  if (previous.some(link => link.id === item.id)) return;
  try { localStorage.setItem(prefix + item.id, JSON.stringify(item)); } catch { /* Keep the in-memory link. */ }
  useVersionLinks.setState({links:[...previous,item]});
}
export function versionChoices(links: VersionLink[], ref: VersionRef) {
  const group = links.filter(item => item.group === ref.group).sort((a,b) => a.at - b.at || a.id.localeCompare(b.id));
  return { variants:group.map((item,i) => ({id:item.id,number:i+1})), current:group.findIndex(item => item.id === ref.id)+1 || 1 };
}
export function firstVersion(): VersionRef {
  const id = newKey();
  return { group:id, id };
}
// A lost response can be retried without creating a second project.
let pending: { signature: string; key: string } | undefined;
export async function createMessageBranch(source: string, request: MessageBranchRequest) {
  const signature = JSON.stringify([source,request]);
  if (pending?.signature !== signature) pending = { signature, key:newKey() };
  const result = await api.branchMessage(source,request,pending.key);
  if (pending?.signature === signature) pending = undefined;
  return result;
}
