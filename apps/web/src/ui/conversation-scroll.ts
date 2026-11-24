export type VersionPosition = {
  view: string;
  group: string;
  offset: number;
  action: "previous-version" | "next-version" | null;
};

export function atLatest(log: HTMLElement) {
  return log.scrollHeight - log.clientHeight - log.scrollTop < 32;
}

function versionControls(log: HTMLElement, group: string) {
  return log.querySelector<HTMLElement>(`[data-version-group="${CSS.escape(group)}"] .message-versions`);
}

export function rememberVersionPosition(log: HTMLElement | null, view: string, group: string): VersionPosition | null {
  const controls = log && versionControls(log, group);
  if (!log || !controls) return null;
  const focused = controls.contains(document.activeElement) && document.activeElement?.getAttribute("data-action");
  return {
    view,
    group,
    offset: controls.getBoundingClientRect().top - log.getBoundingClientRect().top,
    action: focused === "previous-version" || focused === "next-version" ? focused : null,
  };
}

export function restoreVersionPosition(log: HTMLElement, position: VersionPosition) {
  const controls = versionControls(log, position.group);
  if (!controls) return false;
  const offset = Math.max(0, Math.min(position.offset, log.clientHeight - controls.offsetHeight));
  log.scrollTop += controls.getBoundingClientRect().top - log.getBoundingClientRect().top - offset;
  if (position.action) requestAnimationFrame(() => {
    if (!controls.isConnected || (document.activeElement !== document.body && !controls.contains(document.activeElement))) return;
    const button = controls.querySelector<HTMLButtonElement>(`[data-action="${position.action}"]:enabled`) ??
      controls.querySelector<HTMLButtonElement>("button:enabled");
    button?.focus({ preventScroll: true });
  });
  return true;
}
