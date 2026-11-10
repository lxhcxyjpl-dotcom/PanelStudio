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
    if (text.trim() === "" && props.value === "mixed") return;
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
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
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
        value={text}
        disabled={props.disabled || Boolean(props.disabledReason)}
        title={props.disabledReason}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          if (text !== props.value) props.onCommit(text);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (text !== props.value) props.onCommit(text);
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

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

const paths: Record<string, ReactNode> = {
  undo: <path {...stroke} d="M6 4 3 7l3 3M3.5 7H10a3 3 0 1 1 0 6H8" />,
  redo: <path {...stroke} d="M10 4l3 3-3 3M12.5 7H6a3 3 0 1 0 0 6h2" />,
  import: <path {...stroke} d="M8 2v7M5.5 6.5 8 9l2.5-2.5M3 12.5h10" />,
  layout: <path {...stroke} d="M2.5 3.5h4v4h-4zM9.5 3.5h4v4h-4zM2.5 9.5h4v3h-4zM9.5 9.5h4v3h-4z" />,
  export: <path {...stroke} d="M8 10V3M5.5 5.5 8 3l2.5 2.5M3 12.5h10" />,
  settings: <path {...stroke} d="M3 5h10M3 11h10M6 5v.01M11 11v.01" />,
  lock: <path {...stroke} d="M5 7V5.5a3 3 0 0 1 6 0V7M4 7h8v6H4z" />,
  unlock: <path {...stroke} d="M7 7V5.5a3 3 0 0 1 5.2-2M4 7h8v6H4z" />,
  more: <path {...stroke} d="M3 8h.01M8 8h.01M13 8h.01" />,
  chevron: <path {...stroke} d="m4 6 4 4 4-4" />,
};

function trimNumber(value: number): string {
  const text = String(Math.round(value * 1000) / 1000);
  return text;
}
