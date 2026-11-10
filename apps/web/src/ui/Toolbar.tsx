import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { RESOURCE_LIMITS } from "@panelstudio/contracts";
import { fitCamera } from "../model/view";
import { writeProjectId } from "../prefs";
import {
  cancelCrop,
  commitCrop,
  ensureProject,
  importFiles,
  importPackage,
  redo,
  reloadFromServer,
  renameTitle,
  requestLayout,
  undo,
} from "../state/session";
import { patch, useWorkspace } from "../state/store";
import { candidatesStale } from "../state/types";
import { cropInvalid } from "../model/document-ui";
import { Button, Icon } from "./widgets";

export function Toolbar() {
  const { t } = useTranslation();
  const state = useWorkspace();
  const count = state.confirmed?.document.panelOrder.length ?? 0;
  const importPrimary = count === 0;
  const layoutReason = !state.confirmed
    ? t("app.noProject")
    : count < RESOURCE_LIMITS.minAutoLayoutPanels || count > RESOURCE_LIMITS.maxAutoLayoutPanels
      ? t("layout.needPanels")
      : state.draft
        ? t("save.failed")
        : undefined;
  const undoReason = !state.confirmed ? t("app.noProject") : state.confirmed.history.canUndo ? undefined : t("history.undoEmpty");
  const redoReason = !state.confirmed ? t("app.noProject") : state.confirmed.history.canRedo ? undefined : t("history.redoEmpty");
  const cropInvalidNow = state.crop ? cropInvalid(state.crop.crop) : false;
  return (
    <header className="toolbar" data-testid="toolbar">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button action="project-menu" aria-label={t("toolbar.projectMenu")}>
            <Icon name="more" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="menu" align="start" sideOffset={4}>
            <DropdownMenu.Item className="menu-item" onSelect={() => void newProject()}>
              {t("toolbar.newProject")}
            </DropdownMenu.Item>
            <DropdownMenu.Item className="menu-item" onSelect={() => document.getElementById("package-input")?.click()}>
              {t("toolbar.importPackage")}
            </DropdownMenu.Item>
            <DropdownMenu.Item className="menu-item" disabled={!state.projectId} onSelect={() => void reloadFromServer()}>
              {t("toolbar.reload")}
            </DropdownMenu.Item>
            <DropdownMenu.Item className="menu-item" onSelect={() => patch({ dialog: "shortcuts" })}>
              {t("toolbar.shortcuts")}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <ProjectName />
      <span className="save-status" data-testid="save-status">
        {saveLabel(state.saveState, state.backend, t)}
      </span>
      <Button action="undo" aria-label={t("toolbar.undo")} disabledReason={undoReason} onClick={() => void undo()}>
        <Icon name="undo" />
      </Button>
      <Button action="redo" aria-label={t("toolbar.redo")} disabledReason={redoReason} onClick={() => void redo()}>
        <Icon name="redo" />
      </Button>
      <Button action="import" variant={importPrimary ? "primary" : "default"} onClick={() => document.getElementById("import-input")?.click()}>
        <Icon name="import" />
        {t("toolbar.import")}
      </Button>
      <Button action="auto-layout" data-testid="layout-button" disabledReason={layoutReason} onClick={() => void requestLayout()}>
        <Icon name="layout" />
        {t("toolbar.autoLayout")}
      </Button>
      <span className="toolbar-spacer" />
      {state.crop ? (
        <>
          <Button action="crop-done" variant="primary" disabledReason={cropInvalidNow ? t("crop.invalid") : undefined} onClick={() => void commitCrop()}>
            {t("crop.done")}
          </Button>
          <Button action="crop-cancel" onClick={cancelCrop}>
            {t("crop.cancel")}
          </Button>
        </>
      ) : null}
      <Button action="zoom-out" aria-label={t("canvas.zoomOut")} onClick={() => zoomBy(1 / 1.1)}>
        −
      </Button>
      <span className="zoom-readout">{Math.round(state.camera.zoom * 100)}%</span>
      <Button action="zoom-in" aria-label={t("canvas.zoomIn")} onClick={() => zoomBy(1.1)}>
        +
      </Button>
      <Button action="fit" onClick={fit}>{t("canvas.fit")}</Button>
      <Button action="actual-size" className="secondary" onClick={actual}>{t("canvas.actual")}</Button>
      <Button action="drawer-assets" className="drawer-toggle" onClick={() => patch({ leftOpen: !state.leftOpen })}>
        {t("assets.tab")}
      </Button>
      <Button action="drawer-inspector" className="drawer-toggle" onClick={() => patch({ rightOpen: !state.rightOpen })}>
        {t("inspector.tab")}
      </Button>
      <Button action="settings" className="settings-button" aria-label={t("toolbar.settings")} onClick={() => patch({ dialog: "settings" })}>
        <Icon name="settings" />
      </Button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button action="more" className="more-button" aria-label={t("toolbar.more")}>
            <Icon name="more" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="menu" align="end" sideOffset={4}>
            <DropdownMenu.Item className="menu-item" onSelect={() => patch({ dialog: "settings" })}>
              {t("toolbar.settings")}
            </DropdownMenu.Item>
            <DropdownMenu.Item className="menu-item" onSelect={() => patch({ dialog: "shortcuts" })}>
              {t("toolbar.shortcuts")}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <Button
        action="export"
        data-testid="export-button"
        variant={importPrimary ? "default" : "primary"}
        disabledReason={state.confirmed ? undefined : t("app.noProject")}
        onClick={() => patch({ dialog: "export", exportState: null })}
      >
        <Icon name="export" />
        {t("toolbar.export")}
      </Button>
      <input
        id="import-input"
        data-testid="import-input"
        className="hidden-input"
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          void importFiles(files);
        }}
      />
      <input
        id="package-input"
        className="hidden-input"
        type="file"
        accept=".figurezip,application/zip"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void importPackage(file);
        }}
      />
      {state.activeCandidateId && !candidatesStale(state) ? (
        <span className="sr-only">{t("layout.preview")}</span>
      ) : null}
    </header>
  );
}

function ProjectName() {
  const { t } = useTranslation();
  const title = useWorkspace((state) => state.title);
  const projectId = useWorkspace((state) => state.projectId);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(title);
  useEffect(() => setText(title), [title]);
  if (!projectId) return <span className="project-name muted">{t("app.noProject")}</span>;
  return (
    <input
      className="project-name"
      aria-label={t("panels.name")}
      value={editing ? text : title}
      title={title}
      onFocus={() => {
        setEditing(true);
        setText(title);
      }}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        setEditing(false);
        if (text.trim() && text !== title) void renameTitle(text.trim()).catch((error: unknown) => patch({ liveMessage: error instanceof Error ? error.message : t("errors.generic") }));
        else setText(title);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setText(title);
          setEditing(false);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function saveLabel(saveState: string, backend: string, t: (key: string) => string): string {
  if (backend === "down" || saveState === "offline") return t("save.offline");
  if (saveState === "saving") return t("save.saving");
  if (saveState === "failed") return t("save.failed");
  if (saveState === "conflict") return t("save.conflict");
  if (saveState === "saved") return t("save.saved");
  return t("app.noProject");
}

function zoomBy(factor: number): void {
  const { camera, viewport } = useWorkspace.getState();
  const origin = { x: viewport.width / 2, y: viewport.height / 2 };
  const zoom = Math.min(4, Math.max(0.1, camera.zoom * factor));
  const worldX = (origin.x - camera.panX) / camera.zoom;
  const worldY = (origin.y - camera.panY) / camera.zoom;
  patch({ camera: { zoom, panX: origin.x - worldX * zoom, panY: origin.y - worldY * zoom } });
}

function fit(): void {
  const state = useWorkspace.getState();
  const document = state.confirmed?.document;
  if (!document) return;
  patch({ camera: fitCamera(state.viewport, { width: document.canvas.widthMm, height: document.canvas.heightMm }) });
}

function actual(): void {
  const { camera, viewport } = useWorkspace.getState();
  const origin = { x: viewport.width / 2, y: viewport.height / 2 };
  const worldX = (origin.x - camera.panX) / camera.zoom;
  const worldY = (origin.y - camera.panY) / camera.zoom;
  patch({ camera: { zoom: 1, panX: origin.x - worldX, panY: origin.y - worldY } });
}

async function newProject(): Promise<void> {
  writeProjectId(null);
  patch({
    projectId: null,
    confirmed: null,
    title: "",
    draft: null,
    cards: [],
    activeCandidateId: null,
    selection: { kind: "none" },
    imports: [],
  });
  await ensureProject();
}
