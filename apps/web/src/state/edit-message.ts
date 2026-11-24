import type { AIHistoryTurn, MessageBranchRequest } from "@panelstudio/contracts";
import { api, newKey } from "../api/client";
import { i18n } from "../i18n";
import { belongsToProject, followEditedAi, openHistoryTurn, projectEpoch, refreshAiHistory, setPrompt } from "./candidate-session";
import { createMessageBranch, registerVersion, useVersionLinks, versionChoices, type VersionLink, type VersionRef } from "./message-versions";
import { figureHandoff } from "./opening";
import { preferredReadingMode } from "./reading-preference";
import { openListedProject, prepareNavigation } from "./session";
import { patch, useWorkspace } from "./store";
import { seedMessageBranch, submitWish } from "./wish";
import { useWish } from "./wish-session";

let creating = false;
function branchTitle(title: string, ref: VersionRef) {
  const count = versionChoices(useVersionLinks.getState().links, ref).variants.length;
  return i18n.t("chat.branchTitle", { title:title.slice(0,95), number:Math.max(1,count)+1 }).slice(0,120);
}
type AiTurnRef = Pick<AIHistoryTurn,"jobId" | "projectId">;
export function aiVersion(links: VersionLink[], turn: AiTurnRef): VersionRef {
  return links.find(item => item.job === turn.jobId) ?? {group:turn.jobId,id:turn.jobId};
}
export async function visitVersion(id: string) {
  const item = useVersionLinks.getState().links.find(link => link.id === id);
  if (!item) return;
  await openListedProject(item.project);
  if (useWorkspace.getState().projectId !== item.project) return;
  if (item.job) {
    patch({inspectorMode:"ai",rightOpen:true});
    await refreshAiHistory();
    const turn = useWorkspace.getState().aiHistory.find(turn => turn.jobId === item.job);
    if (turn && !turn.isStale) await openHistoryTurn(turn);
  }
}
async function branch<T>(work: (id: string, epoch: number) => Promise<T>) {
  const id = useWorkspace.getState().projectId, epoch = projectEpoch();
  if (!id || creating) throw new Error(i18n.t("wish.wait"));
  creating = true;
  try {
    if (!await prepareNavigation() || !belongsToProject(id,epoch)) throw new Error(i18n.t("wish.finishEdit"));
    await work(id,epoch);
  } finally { creating = false; }
}
export async function editAiMessage(turn: AiTurnRef, text: string, includeImage: boolean, review: boolean) {
  await branch(async (id,epoch) => {
    if (useWorkspace.getState().aiStatus.phase === "running") throw new Error(i18n.t("wish.wait"));
    const ref = aiVersion(useVersionLinks.getState().links,turn);
    const draft = useWorkspace.getState().aiPrompt;
    const result = await createMessageBranch(turn.projectId,{kind:"ai",jobId:turn.jobId,prompt:text,
      title:branchTitle(useWorkspace.getState().title,ref),replyLocale:useWorkspace.getState().locale,includePreviewImage:includeImage,visualReview:review});
    if (!result.jobId) throw new Error(i18n.t("errors.AI_CONTEXT_INVALID"));
    registerVersion({...ref,project:turn.projectId,job:turn.jobId,at:0});
    registerVersion({group:ref.group,id:result.jobId,project:result.projectId,job:result.jobId,at:Date.now()});
    if (!belongsToProject(id,epoch)) return;
    await openListedProject(result.projectId);
    if (useWorkspace.getState().projectId === result.projectId) {
      if (draft) setPrompt(draft);
      await showEditedJob(result.projectId,result.jobId,text);
    }
  });
}
async function showEditedJob(projectId: string, jobId: string, text: string) {
  const turn = (await api.aiHistory(projectId)).items.find(item => item.jobId === jobId);
  if (turn && useWorkspace.getState().projectId === projectId)
    await followEditedAi(jobId,text,{scope:turn.scope,selectedPanelIds:turn.resolvedSelectedPanelIds});
}
export async function editWishMessage(index: number, text: string) {
  await branch(async (id,epoch) => {
    const state = useWish.getState(), point = state.checkpoints[index];
    if (state.projectId !== id || state.busy || !point) return;
    const title = branchTitle(useWorkspace.getState().title,point.version);
    const model = preferredReadingMode();
    const request: MessageBranchRequest = point.aiJob ? {kind:"ai",title,jobId:point.aiJob,prompt:text,
      replyLocale:useWorkspace.getState().locale,includePreviewImage:model === "thumbnails",visualReview:false} :
      {kind:"figure", title, revision:point.revision,assetIds:point.assets,identities:point.identities};
    const result = await createMessageBranch(point.source,request);
    const ref = {group:point.version.group,id:newKey()};
    registerVersion({...point.version,project:id,at:0});
    registerVersion({...ref,project:result.projectId,at:Date.now()});
    const opening = state.opening?.path;
    const handoff = point.fileTurn && opening ? figureHandoff(opening,opening.turns,text,point.assets.length) : undefined;
    if (handoff && model !== "thumbnails") handoff.curate = false;
    seedMessageBranch(result.projectId,state,index,point,ref,text,result.jobId,handoff);
    if (!belongsToProject(id,epoch)) return;
    await openListedProject(result.projectId);
    if (useWorkspace.getState().projectId !== result.projectId) return;
    const valid = point.panelIds.filter(panel => useWorkspace.getState().confirmed?.document.panels[panel]);
    patch({selection:valid.length ? {kind:"panels",ids:valid} : {kind:"none"}});
    if (result.jobId) {
      await showEditedJob(result.projectId,result.jobId,text);
    } else {
      await submitWish(handoff?.instruction ?? text,point.action,model,false,ref);
    }
  });
}
