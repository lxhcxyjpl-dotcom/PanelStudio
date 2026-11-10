import type { PointerEvent as ReactPointerEvent } from "react";

type Gestures = {
  drag: (event: PointerEvent) => void;
  finish: (event: PointerEvent, dragged: boolean) => void;
  cancel: () => void;
};
let cancelActive: (() => void) | null = null;

export function cancelGesture(): boolean {
  if (!cancelActive) return false;
  cancelActive();
  return true;
}

/** Use a screen-space threshold so zoom cannot turn a click into a document edit. */
export function trackGesture(start: ReactPointerEvent, handlers: Gestures) {
  cancelGesture();
  const element = start.currentTarget as HTMLElement;
  const { pointerId, clientX, clientY } = start;
  const threshold = (event: PointerEvent) => Math.hypot(event.clientX - clientX, event.clientY - clientY) >= 4;
  let dragged = false;
  element.setPointerCapture(pointerId);
  function clean() {
    cancelActive = null;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", interrupted);
    window.removeEventListener("blur", cancel);
    element.removeEventListener("lostpointercapture", interrupted);
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
  }
  function move(event: PointerEvent) {
    if (event.pointerId !== pointerId) return;
    dragged ||= threshold(event);
    if (dragged) handlers.drag(event);
  }
  function finish(event: PointerEvent) {
    if (event.pointerId !== pointerId) return;
    clean();
    handlers.finish(event, dragged || threshold(event));
  }
  function interrupted(event: Event) {
    if (event instanceof PointerEvent && event.pointerId === pointerId) cancel();
  }
  function cancel() { clean(); handlers.cancel(); }
  cancelActive = cancel;
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", interrupted);
  window.addEventListener("blur", cancel);
  element.addEventListener("lostpointercapture", interrupted);
}
