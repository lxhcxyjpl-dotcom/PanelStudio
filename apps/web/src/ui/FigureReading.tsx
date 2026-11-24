import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { figureKindLabel, type FigureReading } from "@panelstudio/contracts";
import { useWorkspace } from "../state/store";
import { api, contentUrl } from "../api/client";
import {
  preferredReadingMode,
  setReadingPreference,
  useReadingPreference,
} from "../state/reading-preference";
import { answerImageQuestion, reviseImageReading } from "../state/wish";
import { changeWish, type IdentityQuestion } from "../state/wish-session";
import { Button } from "./widgets";
import { useDictation } from "./useDictation";
import { QuestionCard } from "./QuestionCard";

export function ReadingSwitch({
  disabled = false,
  compact = false,
}: {
  disabled?: boolean;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const { data } = useQuery({ queryKey: ["ai-provider"], queryFn: api.providerSettings });
  useReadingPreference((s) => s.enabled);
  if (!data?.hasSecret || !data.config) return null;
  const enabled = preferredReadingMode(data) !== "local";
  const label = t(data.config.capabilities.imageInput ? "reading.sendVisual" : "reading.sendText", {
    model: data.config.model,
  });
  return (
    <label className={"wish-model reading-switch" + (compact ? " model-chip" : "")} title={label}>
      <input
        type="checkbox"
        data-testid="use-image-model"
        checked={enabled}
        aria-label={label}
        disabled={disabled}
        onChange={(ev) => {
          setReadingPreference(ev.target.checked);
        }}
      />
      {compact ? (
        <>
          <span className="model-dot" aria-hidden="true" />
          <span>
            {enabled
              ? t(data.config.capabilities.imageInput ? "chat.modelVision" : "chat.modelText", {
                  model: data.config.model,
                })
              : t("chat.local")}
          </span>
        </>
      ) : (
        label
      )}
    </label>
  );
}
export function FigureIdentityCheck({
  item,
  project,
  busy,
  onInspect,
}: {
  item: IdentityQuestion;
  project: string;
  busy: boolean;
  onInspect: () => void;
}) {
  const { t } = useTranslation();
  const [edit, setEdit] = useState(false),
    [value, setValue] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const voice = useDictation(input, setValue, project + "/" + item.id, busy || !edit);
  return (
    <QuestionCard
      testId="figure-identity"
      question={t("reading.which", { name: item.filename })}
      artwork={
        <button
          type="button"
          className="figure-check-image"
          data-action="inspect-conflict"
          onClick={onInspect}
          aria-label={t("wish.inspect", { name: item.filename })}
        >
          <img src={contentUrl(project, item.id)} alt="" />
        </button>
      }
      detail={
        <p className="figure-check-clues">
          {t("reading.contrast", { name: item.nameQuote, image: item.imageQuote })}
        </p>
      }
      aside={
        <button
          type="button"
          data-action="postpone-identity"
          className="figure-check-later"
          disabled={busy}
          onClick={() => changeWish({ identity: null, ...(item.swap ? {} : { input: item.resume?.text ?? "" }), reply: "" })}
        >
          {t("reading.later")}
        </button>
      }
      disabled={busy}
      choices={[
        { label: t("reading.useImage"), value: "image", action: "identity-image" },
        { label: t("reading.useName"), value: "filename", action: "identity-filename" },
      ]}
      onChoose={(value) => {
        voice.cancel();
        if (value === "image") void answerImageQuestion("image", item.imageQuote);
        else void answerImageQuestion("filename", item.nameQuote);
      }}
    >
      {edit ? (
        <form
          className="wish-line"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && !voice.active && value.trim()) { voice.cancel(); void answerImageQuestion("custom", value); }
          }}
        >
          <input
            ref={input}
            autoFocus
            aria-label={t("reading.own")}
            placeholder={t("chat.custom")}
            maxLength={300}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" && (ev.nativeEvent.isComposing || ev.nativeEvent.keyCode === 229))
                ev.preventDefault();
            }}
          />
          {voice.mic}
          <Button action="identity-save" type="submit" disabled={busy || voice.active || !value.trim()}>
            {t("reading.confirm")}
          </Button>
          {voice.feedback}
        </form>
      ) : (
        <button
          type="button"
          className="custom-trigger"
          data-action="identity-custom"
          disabled={busy}
          onClick={() => setEdit(true)}
        >
          {t("reading.own")}
        </button>
      )}
    </QuestionCard>
  );
}
export function ReadingDetails({
  assetId,
  known,
  onEdit,
}: {
  assetId: string;
  known?: FigureReading;
  onEdit?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const projectId = useWorkspace((s) => s.projectId);
  const result = useQuery({
    queryKey: ["inspected-figure", projectId, assetId, i18n.language],
    enabled: !known && Boolean(projectId),
    queryFn: () =>
      api.readFigures(projectId!, {
        assetIds: [assetId],
        locale: i18n.language.startsWith("zh") ? "zh-CN" : "en-US",
        vision: false,
        preferSaved: true,
      }),
  });
  const reading = known ?? result.data?.items[0];
  if (!reading) return null;
  const words = [...new Set([...reading.local.svgText, ...reading.local.ocrText, ...reading.text])];
  return (
    <details className="figure-reading-details">
      <summary>
        {t(reading.source === "vision" ? "reading.modelResult" : "reading.localResult")} ·{" "}
        {figureKindLabel(reading.category, i18n.language)}
      </summary>
      {reading.observation && <p>{reading.observation}</p>}
      <p>
        {words.length
          ? words.join(" · ")
          : t(reading.local.ocrStatus === "unavailable" ? "reading.ocrUnavailable" : "reading.noWords")}
      </p>
      {reading.decision && (
        <p>
          {t("reading.authorChoice", { value: reading.decision.value })}
          {reading.conflict && onEdit && (
            <Button
              variant="quiet"
              action="revise-identity"
              onClick={() => {
                onEdit();
                reviseImageReading(reading);
              }}
            >
              {t("reading.correct")}
            </Button>
          )}
        </p>
      )}
    </details>
  );
}
