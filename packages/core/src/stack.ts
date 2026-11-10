import type { DomainCommand, FigureDocumentV1 } from "@panelstudio/contracts";
import { DocumentCommandError } from "./errors.js";

/** Handbook stack menu: front paints above, back paints below. */
export type StackMove = "front" | "forward" | "backward" | "back";

export function movedStackOrder(stackOrder: readonly string[], panelId: string, move: StackMove): string[] {
  const index = stackOrder.indexOf(panelId);
  const id = stackOrder[index];
  if (index < 0 || id === undefined) {
    throw new DocumentCommandError("DOCUMENT_INVALID", "The panel does not exist.", { panelIds: [panelId] });
  }
  const next = [...stackOrder];
  next.splice(index, 1);
  if (move === "front") next.push(id);
  else if (move === "back") next.unshift(id);
  else if (move === "forward") next.splice(Math.min(index + 1, next.length), 0, id);
  else next.splice(Math.max(index - 1, 0), 0, id);
  return next;
}

/** One panel.setStackOrder. Label order is not part of the command. */
export function stackOrderCommand(
  document: FigureDocumentV1,
  panelId: string,
  move: StackMove,
): DomainCommand {
  return { type: "panel.setStackOrder", stackOrder: movedStackOrder(document.stackOrder, panelId, move) };
}
