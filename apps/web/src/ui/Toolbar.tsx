import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RESOURCE_LIMITS, type Project } from "@panelstudio/contracts";
import { api, ApiClientError } from "../api/client";
import {
  cancelCrop,
  commitCrop,
  deleteCurrentProject,
  newProject,
  openListedProject,
  reloadFromServer,
  renameTitle,
  requestLayout,
  restoreListedProject,
  returnToStart,
} from "../state/session";
import { patch, useWorkspace } from "../state/store";
import { cropInvalid } from "../model/document-ui";
import { Button, Icon } from "./widgets";

export function Toolbar({ inert }: { inert: boolean }) {
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
  const cropInvalidNow = state.crop ? cropInvalid(state.crop.crop) : false;
  const [listed, setListed] = useState<Project[]>([]);
  const openable = listed.filter((project) => !project.deletedAt);
  const deleted = listed.filter((project) => project.deletedAt);
  return (
    <header className="toolbar" data-testid="toolbar" data-editor={Boolean(state.projectId)} inert={inert}>
      <DropdownMenu.Root
        onOpenChange={(open) => {
          if (!open) return;
          void api.projects({ includeDeleted: true }).then(
            (page) => setListed(page.items),
            (error: unknown) => patch({ liveMessage: error instanceof ApiClientError ? error.message : t("errors.generic") }),
          );
        }}
      >
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
            <ProjectSubmenu
              label={t("toolbar.openProject")}
              testId="open-project"
              projects={openable}
              empty={t("app.noProject")}
              onSelect={(projectId) => void openListedProject(projectId).catch((error: unknown) => patch({ liveMessage: error instanceof ApiClientError ? error.message : t("errors.generic") }))}
            />
            <DropdownMenu.Item
              className="menu-item"
              data-testid="delete-project"
              disabled={!state.projectId}
              title={state.projectId ? undefined : t("app.noProject")}
              onSelect={() => void deleteCurrentProject().catch((error: unknown) => patch({ liveMessage: error instanceof ApiClientError ? error.message : t("errors.generic") }))}
            >
              {t("toolbar.deleteProject")}
            </DropdownMenu.Item>
            <ProjectSubmenu
              label={t("toolbar.restoreProject")}
              testId="restore-project"
              projects={deleted}
              empty={t("toolbar.noDeletedProjects")}
              onSelect={(projectId) => void restoreListedProject(projectId).catch((error: unknown) => patch({ liveMessage: error instanceof ApiClientError ? error.message : t("errors.generic") }))}
            />
            <DropdownMenu.Item className="menu-item" onSelect={() => document.getElementById("package-input")?.click()}>
              {t("toolbar.importPackage")}
            </DropdownMenu.Item>
            <DropdownMenu.Item className="menu-item" disabled={!state.projectId} title={state.projectId ? undefined : t("app.noProject")} onSelect={() => void reloadFromServer()}>
              {t("toolbar.reload")}
            </DropdownMenu.Item>
            <DropdownMenu.Item className="menu-item" disabled={!state.projectId} onSelect={() => patch({ dialog: "publication" })}>
              {t("publication.title")}
            </DropdownMenu.Item>
            <DropdownMenu.Item className="menu-item" onSelect={() => patch({ dialog: "shortcuts" })}>
              {t("toolbar.shortcuts")}
            </DropdownMenu.Item>
            <DropdownMenu.Item className="menu-item" onSelect={() => patch({ dialog: "onboarding" })}>
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
        <Button action="import" variant={importPrimary ? "primary" : "quiet"} onClick={() => document.getElementById("import-input")?.click()}>
          <Icon name="import" />{t("toolbar.import")}
        </Button>
        <Button action="auto-layout" data-testid="layout-button" disabledReason={layoutReason}
          onClick={() => void requestLayout()}>
          <Icon name="layout" />{t("toolbar.autoLayout")}
        </Button>
        <Button action="guided-layout" className="guided-action" disabledReason={layoutReason} onClick={() => patch({ dialog: "guided" })}>
          <Icon name="reference" />{t("layout.guide")}
        </Button>
        <Button action="open-refine" variant="quiet" onClick={() => patch({ inspectorMode: "ai", rightOpen: true, leftOpen: false })}><Icon name="sliders" />{t("ai.tab")}</Button>
      </div> : <Button action="start-open-package" variant="quiet" aria-label={t("app.openBundle")} title={t("app.openBundle")} onClick={() => document.getElementById("package-input")?.click()}>
        <Icon name="sheets" /><span className="bundle-label">{t("app.openBundle")}</span>
      </Button>}
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
      <Button action="open-onboarding" variant="quiet" className="help-button" aria-label={t("onboarding.title")} title={t("onboarding.title")} onClick={() => patch({ dialog: "onboarding" })}><Icon name="book" /></Button>
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
        onClick={() => patch({ dialog: "export", exportState: null })}
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

function ProjectSubmenu(props: {
  label: string;
  testId: string;
  projects: Project[];
  empty: string;
  onSelect: (projectId: string) => void;
}) {
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger className="menu-item" data-testid={props.testId}>
        {props.label}
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent className="menu menu-scroll" sideOffset={4} alignOffset={-4}>
          {props.projects.length === 0 ? (
            <DropdownMenu.Item className="menu-item" disabled title={props.empty}>
              {props.empty}
            </DropdownMenu.Item>
          ) : (
            props.projects.map((project) => (
              <DropdownMenu.Item
                key={project.id}
                className="menu-item menu-project"
                title={project.title}
                onSelect={() => props.onSelect(project.id)}
              >
                {project.title}
              </DropdownMenu.Item>
            ))
          )}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}

function ProjectName() {
  const { t } = useTranslation();
  const title = useWorkspace((state) => state.title);
  const projectId = useWorkspace((state) => state.projectId);
  const cancelled = useRef(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(title);
  useEffect(() => setText(title), [title]);
  if (!projectId) return null;
  return (
    <input
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
