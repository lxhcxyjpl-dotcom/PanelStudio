import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { patch } from "../state/store";
import { Button, Icon } from "./widgets";

export function Shell(props: { open: boolean; title: string; children: ReactNode; onClose?: () => void; className?: string }) {
  const { t } = useTranslation();
  return <Dialog.Root open={props.open} onOpenChange={open => { if (!open) props.onClose ? props.onClose() : patch({ dialog: null }); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="scrim" />
      <Dialog.Content className={"dialog " + (props.className ?? "")} aria-describedby={undefined}>
        <div className="dialog-heading">
          <Dialog.Title>{props.title}</Dialog.Title>
          <Dialog.Close asChild><Button action="close-dialog" variant="quiet" aria-label={t("a11y.close")} title={t("a11y.close")}><Icon name="close" /></Button></Dialog.Close>
        </div>
        {props.children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
