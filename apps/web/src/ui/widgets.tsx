import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useEffect, useState } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  action: string;
  disabledReason?: string;
  variant?: "default" | "primary" | "quiet";
};

export function Button({ action, disabledReason, variant = "default", className, title, disabled, type, ...props }: ButtonProps) {
  const isDisabled = Boolean(disabled || disabledReason);
  return (
    <button
      {...props}
      type={type ?? "button"}
      data-action={action}
      className={["button", variant === "primary" ? "primary" : "", variant === "quiet" ? "quiet" : "", className ?? ""].filter(Boolean).join(" ")}
      disabled={isDisabled}
      aria-description={isDisabled ? disabledReason : props["aria-description"]}
      title={isDisabled ? disabledReason : title}
    />
  );
}

export function NumberField(props: {
  label: string;
  value: number | "mixed";
  onCommit: (value: number) => void;
  disabled?: boolean;
  disabledReason?: string;
  testId?: string;
  min?: number;
  mixedLabel?: string;
}) {
  const shown = props.value === "mixed" ? "" : trimNumber(props.value);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  function commit() {
    if (props.disabled || props.disabledReason) return;
    if (text.trim() === "") {
      setText(shown);
      return;
    }
    const value = Number(text);
    if (!Number.isFinite(value)) {
      setText(shown);
      return;
    }
    if (props.min !== undefined && value < props.min) {
      setText(shown);
      return;
    }
    if (props.value !== "mixed" && value === props.value) return;
    props.onCommit(value);
  }
  return (
    <label className="field numeric">
      <span>{props.label}</span>
      <input
        data-testid={props.testId}
        value={text}
        placeholder={props.value === "mixed" ? props.mixedLabel : undefined}
        disabled={props.disabled || Boolean(props.disabledReason)}
        title={props.disabledReason}
        inputMode="decimal"
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setText(shown);
          }
        }}
      />
    </label>
  );
}

export function TextField(props: {
  label: string;
  value: string;
  placeholder?: string;
  onCommit: (value: string) => void;
  disabled?: boolean;
  disabledReason?: string;
  testId?: string;
}) {
  const [text, setText] = useState(props.value);
  useEffect(() => setText(props.value), [props.value]);
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        data-testid={props.testId}
        placeholder={props.placeholder}
        value={text}
        disabled={props.disabled || Boolean(props.disabledReason)}
        title={props.disabledReason}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          if (text !== props.value) props.onCommit(text);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setText(props.value);
          }
        }}
      />
    </label>
  );
}

export function SelectField(props: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <select
        value={props.value}
        disabled={props.disabled || Boolean(props.disabledReason)}
        title={props.disabledReason}
        onChange={(event) => props.onChange(event.target.value)}
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Icon({ name }: { name: string }) {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      {paths[name] ?? null}
    </svg>
  );
}

export function TabBar<T extends string>({ id, value, items, onChange, label }: {
  id: string; value: T; items: Array<{ value: T; label: string; action: string; disabled?: boolean }>; onChange: (value: T) => void; label: string;
}) {
  return <div className="tabs" role="tablist" aria-label={label} onKeyDown={event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const enabled = items.filter(item => !item.disabled);
    const at = enabled.findIndex(item => item.value === value);
    const next = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1 : (at + (event.key === "ArrowLeft" ? -1 : 1) + enabled.length) % enabled.length;
    const item = enabled[next];
    if (!item) return;
    event.preventDefault(); event.stopPropagation();
    onChange(item.value);
    document.getElementById(`${id}-${item.value}`)?.focus();
  }}>{items.map(item => <button key={item.value} type="button" id={`${id}-${item.value}`} role="tab" data-action={item.action} disabled={item.disabled}
    aria-selected={value === item.value} aria-controls={`${id}-panel`} tabIndex={value === item.value ? 0 : -1} onClick={() => onChange(item.value)}>{item.label}</button>)}</div>;
}

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

const paths: Record<string, ReactNode> = {
  play: <path {...stroke} d="m5 3 8 5-8 5Z" />,
  pause: <path {...stroke} d="M5 3v10M11 3v10" />,
  arrowLeft: <path {...stroke} d="M13.5 8h-10m4-4-4 4 4 4" />,
  trash: <path {...stroke} d="M2.5 4h11M6 2h4M4 4l.5 10h7L12 4M6.5 7v4M9.5 7v4" />,
  arrowUp: <path {...stroke} d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />,
  spark: <path {...stroke} d="m9 1.5 1.7 4.8 4.8 1.7-4.8 1.7L9 14.5 7.3 9.7 2.5 8l4.8-1.7L9 1.5ZM2 1v3M.5 2.5h3" />,
  book: <path {...stroke} d="M8 4C6 2.5 4 2.5 1.5 3v9c2.5-.5 4.5-.5 6.5 1 2-1.5 4-1.5 6.5-1V3C12 2.5 10 2.5 8 4Zm0 0v9" />,
  chat: <path {...stroke} d="M3 2.5h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6l-3.5 2v-2A1 1 0 0 1 2 10.5v-7a1 1 0 0 1 1-1ZM5 6h6M5 8.5h4" />,
  stop: <rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" />,
  edit: <path {...stroke} d="m10.5 2.5 3 3M3 10l8-8 3 3-8 8-4 1 1-4Z" />,
  plus: <path {...stroke} d="M8 3v10M3 8h10" />,
  minus: <path {...stroke} d="M3 8h10" />,
  close: <path {...stroke} d="m4 4 8 8m0-8-8 8" />,
  arrowRight: <path {...stroke} d="M2.5 8h10m-4-4 4 4-4 4" />,
  sheets: <path {...stroke} d="M5.5 2.5h7v9h-7zM3 5.5v8h7" />,
  reference: <path {...stroke} d="M2.5 3h11v10h-11zM7.3 3v10M7.5 8.1h5.8" />,
  image: <path {...stroke} d="M2 3h12v10H2zM3 11l3.2-3 2.4 2L11 7.8l2 1.8M10.6 5.6h.1" />,
  sliders: <path {...stroke} d="M2 5h5m3 0h4M2 11h2m3 0h7M7 3.5v3M5 9.5v3" />,
  layers: <path {...stroke} d="m2 6 6-3.5L14 6l-6 3.5L2 6Zm.5 3.2L8 12.4l5.5-3.2" />,
  fit: <path {...stroke} d="M2.5 6V2.5H6m4 0h3.5V6m0 4v3.5H10m-4 0H2.5V10" />,
  check: <path {...stroke} d="m3 8 3 3 7-7" />,
  undo: <path {...stroke} d="M6 4 3 7l3 3M3.5 7H10a3 3 0 1 1 0 6H8" />,
  redo: <path {...stroke} d="M10 4l3 3-3 3M12.5 7H6a3 3 0 1 0 0 6h2" />,
  import: <path {...stroke} d="M8 2v7M5.5 6.5 8 9l2.5-2.5M3 12.5h10" />,
  layout: <path {...stroke} d="M2.5 3.5h4v4h-4zM9.5 3.5h4v4h-4zM2.5 9.5h4v3h-4zM9.5 9.5h4v3h-4z" />,
  export: <path {...stroke} d="M8 10V3M5.5 5.5 8 3l2.5 2.5M3 12.5h10" />,
  settings: <g {...stroke}><path d="m6.7 2 .4-.6h1.8l.5 1.5 1 .6 1.5-.3.9 1.6-1 1.1v1.4l1 1.1-.9 1.6-1.5-.3-1 .6-.5 1.5H7.1l-.5-1.5-1-.6-1.5.3-.9-1.6 1-1.1V6.5l-1-1.1.9-1.6 1.5.3 1-.6z" transform="translate(0 .8)" /><circle cx="8" cy="8" r="1.8" /></g>,
  lock: <path {...stroke} d="M5 7V5.5a3 3 0 0 1 6 0V7M4 7h8v6H4z" />,
  unlock: <path {...stroke} d="M7 7V5.5a3 3 0 0 1 5.2-2M4 7h8v6H4z" />,
  more: <path {...stroke} d="M3 8h.01M8 8h.01M13 8h.01" />,
  chevron: <path {...stroke} d="m4 6 4 4 4-4" />,
};

function trimNumber(value: number): string {
  const text = String(Math.round(value * 1000) / 1000);
  return text;
}
