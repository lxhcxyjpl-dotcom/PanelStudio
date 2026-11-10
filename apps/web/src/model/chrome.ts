import { metrics, motion } from "@panelstudio/ui";

export type WorkspaceMode = "full" | "compact" | "drawer" | "phone";

export function workspaceMode(width: number): WorkspaceMode {
  if (width >= metrics.breakpointsPx.full) return "full";
  if (width >= metrics.breakpointsPx.compact) return "compact";
  if (width >= metrics.breakpointsPx.drawer) return "drawer";
  return "phone";
}

export function sidebarWidth(side: "left" | "right", mode: WorkspaceMode, preferred: number): number {
  if (mode === "compact") return side === "left" ? metrics.leftSidebarPx.min : metrics.rightSidebarPx.min;
  if (mode === "drawer" || mode === "phone") {
    return side === "left" ? metrics.leftSidebarPx.default : metrics.rightSidebarPx.default;
  }
  const limits = side === "left" ? metrics.leftSidebarPx : metrics.rightSidebarPx;
  return Math.min(limits.max, Math.max(limits.min, preferred));
}

export function localizedSummary(summary: string, locale: string): string {
  if (locale.startsWith("zh")) return summary;
  if (summary.startsWith("均衡分行")) return `Balanced rows${summary.slice("均衡分行".length)}`;
  if (summary.startsWith("主图在左")) return `Primary on the left${summary.slice("主图在左".length)}`;
  if (summary.startsWith("主图在上")) return `Primary on top${summary.slice("主图在上".length)}`;
  return summary;
}

export function motionDurations(reduced: boolean): { spatial: string; opacity: string; ease: string } {
  if (reduced) {
    return {
      spatial: `${motion.reducedMotion.spatialDurationMs}ms`,
      opacity: `${motion.reducedMotion.maxOpacityDurationMs}ms`,
      ease: motion.easing,
    };
  }
  return {
    spatial: `${motion.durationMs.layoutCandidate}ms`,
    opacity: `${motion.durationMs.dialog}ms`,
    ease: motion.easing,
  };
}
