import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RESOURCE_LIMITS } from "@panelstudio/contracts";
import {
  newProject,
  renameTitle,
  requestLayout,
  returnToStart,
} from "../state/session";
import { patch, useWorkspace, useWorkspaceFields } from "../state/store";
import { Button, Icon } from "./widgets";

export function Toolbar({ inert }: { inert: boolean }) {
  const { t } = useTranslation();
  const state = useWorkspaceFields(
    "projectId", "confirmed", "draft", "backend", "saveState", "mode", "exportState", "compareMode",
  );
  const count = state.confirmed?.document.panelOrder.length ?? 0;
  const importPrimary = count === 0;
  const layoutReason = !state.confirmed
    ? t("app.noProject")
    : count < RESOURCE_LIMITS.minAutoLayoutPanels || count > RESOURCE_LIMITS.maxAutoLayoutPanels
      ? t("layout.needPanels")
      : state.draft
        ? t("save.failed")
        : undefined;
  return (
    <header className="toolbar" data-testid="toolbar" data-editor={Boolean(state.projectId)} inert={inert}>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button action="project-menu" variant="quiet" className="studio-brand" aria-label={t("toolbar.projectMenu")} title={t("toolbar.projectMenu")}>
            <span className="studio-mark" aria-hidden="true"><i /><i /><i /></span><span className="wordmark">PanelStudio</span><Icon name="chevron" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="menu" align="start" sideOffset={4}>
            {state.projectId && <DropdownMenu.Item className="menu-item" data-action="return-home" onSelect={() => void returnToStart()}>
              {t("toolbar.home")}
            </DropdownMenu.Item>}
            <DropdownMenu.Item className="menu-item" onSelect={() => void newProject().catch((error: unknown) => patch({ liveMessage: error instanceof Error ? error.message : t("errors.generic") }))}>
              {t("toolbar.newProject")}
            </DropdownMenu.Item>
            <DropdownMenu.Item className="menu-item" data-action="all-projects" onSelect={() => patch({ dialog: "projects" })}>
              {t("brand.allProjects")}
            </DropdownMenu.Item>
            <DropdownMenu.Item className="menu-item" onSelect={() => document.getElementById("package-input")?.click()}>
              {t("toolbar.importPackage")}
            </DropdownMenu.Item>
            <DropdownMenu.Item className="menu-item" onSelect={() => patch({ dialog: "shortcuts" })}>
              {t("toolbar.shortcuts")}
            </DropdownMenu.Item>
            <DropdownMenu.Item className="menu-item" data-action="open-onboarding" onSelect={() => patch({ dialog: "onboarding" })}>
              {t("onboarding.title")}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <div className="project-context">
        {state.projectId && <ProjectName />}
        <span className="save-status" data-testid="save-status" data-status={state.backend === "down" ? "offline" : state.saveState}>
          {saveLabel(state.saveState, state.backend, t)}
        </span>
      </div>
      <span className="toolbar-spacer" />
      {state.projectId ? <div className="document-actions">
        {!importPrimary && <Button action="import" variant="quiet" onClick={() => document.getElementById("import-input")?.click()}>
          <Icon name="import" />{t("toolbar.import")}
        </Button>}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild><Button action="layout-tools" variant="quiet" aria-label={t("wish.tools")} title={t("wish.tools")}>
            <Icon name="layout"/><span>{t("wish.tools")}</span><Icon name="chevron"/>
          </Button></DropdownMenu.Trigger>
          <DropdownMenu.Portal><DropdownMenu.Content className="menu" align="end">
            <DropdownMenu.Item className="menu-item" data-action="auto-layout" data-testid="layout-button" disabled={Boolean(layoutReason)} onSelect={()=>void requestLayout()}>{t("toolbar.autoLayout")}</DropdownMenu.Item>
            <DropdownMenu.Item className="menu-item" data-action="guided-layout" disabled={Boolean(layoutReason)} onSelect={()=>patch({dialog:"guided"})}>{t("layout.guide")}</DropdownMenu.Item>
            <DropdownMenu.Item className="menu-item" data-action="edit-publication" onSelect={() => patch({ dialog: "publication" })}>{t("publication.title")}</DropdownMenu.Item>
          </DropdownMenu.Content></DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div> : <Button action="start-open-package" variant="quiet" aria-label={t("app.openBundle")} title={t("app.openBundle")} onClick={() => document.getElementById("package-input")?.click()}>
        <Icon name="sheets" /><span className="bundle-label">{t("app.openBundle")}</span>
      </Button>}
      <Button action="settings" variant="quiet" className="settings-button" aria-label={t("toolbar.settings")} onClick={() => patch({ dialog: "settings" })}>
        <Icon name="settings" />
      </Button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button action="more" variant="quiet" className="more-button" aria-label={t("toolbar.more")}>
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
      {state.projectId && <Button
        action="export"
        data-testid="export-button"
        variant={importPrimary ? "default" : "primary"}
        disabledReason={state.confirmed ? undefined : t("app.noProject")}
        onClick={() => patch({ dialog: "export", exportState: state.exportState?.status === "running" ? state.exportState : null })}
      >
        <Icon name="export" />
        {t("toolbar.export")}
      </Button>}
      {state.compareMode !== "editing" ? (
        <span className="sr-only">{t("layout.preview")}</span>
      ) : null}
    </header>
  );
}

function ProjectName() {
  const { t } = useTranslation();
  const title = useWorkspace((state) => state.title);
  const projectId = useWorkspace((state) => state.projectId);
  const cancelled = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(title);
  useEffect(() => setText(title), [title]);
  if (!projectId) return null;
  return (
    <div className="project-name-field">
    <input
      ref={input}
      className="project-name"
      aria-label={t("panels.name")}
      value={editing ? text : title}
      title={title}
      onFocus={() => {
        cancelled.current = false;
        setEditing(true);
        setText(title);
      }}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        setEditing(false);
        if (!cancelled.current && text.trim() && text !== title) void renameTitle(text.trim()).catch((error: unknown) => patch({ liveMessage: error instanceof Error ? error.message : t("errors.generic") }));
        else setText(title);
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          cancelled.current = true;
          setText(title);
          setEditing(false);
          event.currentTarget.blur();
        }
      }}
    />
    <Button action="rename-figure" variant="quiet" aria-label={t("project.rename")} title={t("project.rename")} onClick={() => {
      input.current?.focus();
      input.current?.select();
    }}><Icon name="edit" /></Button>
    </div>
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
