import { useId, type ReactNode } from "react";
import { Icon } from "./widgets";
import "./chat.css";

type Choice = { label: string; value: string; action?: string };
export function QuestionCard({
  question,
  choices,
  onChoose,
  disabled = false,
  children,
  artwork,
  detail,
  aside,
  testId,
  promptId,
  compact = false,
}: {
  question: string;
  choices: Choice[];
  onChoose: (choice: string) => void;
  disabled?: boolean;
  children?: ReactNode;
  artwork?: ReactNode;
  detail?: ReactNode;
  aside?: ReactNode;
  testId?: string;
  promptId?: string;
  compact?: boolean;
}) {
  const generatedId = useId();
  const id = promptId ?? generatedId;
  return (
    <section
      className={compact ? "chat-question chat-question-compact" : "chat-question"}
      role="group"
      aria-labelledby={id}
      data-testid={testId ?? "question-card"}
    >
      <div className="chat-question-head">
        {artwork}
        <div>
          <p id={id} className="chat-question-prompt">
            {question}
          </p>
          {detail}
        </div>
        {aside}
      </div>
      {choices.length > 0 && (
        <div className="chat-answers">
          {choices.map((choice) => (
            <button
              type="button"
              className="chat-answer"
              key={choice.value}
              disabled={disabled}
              data-action={choice.action ?? "question-option"}
              onClick={() => onChoose(choice.value)}
            >
              <span>{choice.label}</span>
              <Icon name="arrowRight" />
            </button>
          ))}
        </div>
      )}
      {children && <div className="chat-custom">{children}</div>}
    </section>
  );
}
export function answerChoices(values: readonly string[]) {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))].map((value) => ({ value, label: value }));
}
