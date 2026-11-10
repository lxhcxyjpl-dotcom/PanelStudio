import type { DomainCommand, FigureDocumentV1 } from "@panelstudio/contracts";

export type RecoveryDraft = {
  projectId: string;
  baseRevision: number;
  document: FigureDocumentV1;
  pendingCommands: DomainCommand[];
  savedAt: string;
  kind: "recovery-draft";
  includesSourceAssets: false;
  purpose: string;
};

const DB_NAME = "panelstudio";
const STORE = "drafts";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function writeRecovery(draft: RecoveryDraft): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(draft, draft.projectId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function readRecovery(projectId: string): Promise<RecoveryDraft | null> {
  const db = await openDb();
  const value = await new Promise<RecoveryDraft | null>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).get(projectId);
    request.onsuccess = () => resolve((request.result as RecoveryDraft | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return value;
}

export async function clearRecovery(projectId: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(projectId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
