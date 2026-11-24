import { useLayoutEffect, useRef, type KeyboardEvent, type RefObject, type TextareaHTMLAttributes } from "react";

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onSend: () => void;
  sendModifiedEnter?: boolean;
};
export function ChatInput({ inputRef, onSend, value, sendModifiedEnter = false, ...props }: Props) {
  const lastWidth = useRef(0);
  function fit() {
    const el = inputRef.current;
    if (!el?.clientWidth) return;
    el.style.height = "0px";
    el.style.height = (el.scrollHeight + el.offsetHeight - el.clientHeight) + "px";
  }
  useLayoutEffect(fit, [value, props.rows]);
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    let frame = 0;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.borderBoxSize?.[0]?.inlineSize ?? el.getBoundingClientRect().width;
      if (width === lastWidth.current) return;
      lastWidth.current = width;
      cancelAnimationFrame(frame);
      // Resize after observer delivery so the same field cannot trigger a nested layout notification.
      frame = requestAnimationFrame(fit);
    });
    observer.observe(el);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [inputRef]);
  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (!event.shiftKey || (sendModifiedEnter && (event.ctrlKey || event.metaKey))) && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
      event.preventDefault();
      if (!event.repeat) onSend();
    }
  }
  return <textarea {...props} ref={inputRef} value={value} onKeyDown={keyDown} />;
}
