import * as Dialog from "@radix-ui/react-dialog";
import { useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { patch } from "../state/store";
import { Button, Icon } from "./widgets";

export function Shell(props: { open: boolean; title: string; children: ReactNode; onClose?: () => void; className?: string }) {
  const { t } = useTranslation();
  const opener = useRef<HTMLElement | null>(null);
  return <Dialog.Root open={props.open} onOpenChange={open => { if (!open) props.onClose ? props.onClose() : patch({ dialog: null }); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="scrim" />
      <Dialog.Content className={"dialog " + (props.className ?? "")} aria-describedby={undefined}
        onOpenAutoFocus={() => {
          opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={event => {
          const trigger = opener.current;
          if (trigger && trigger !== document.body && trigger.isConnected && trigger.getClientRects().length &&
              !trigger.closest("[inert], [hidden]") && !document.querySelector('[role="dialog"][data-state="open"]')) {
            event.preventDefault();
            trigger.focus({ preventScroll: true });
          }
        }}>
        <div className="dialog-heading">
          <Dialog.Title>{props.title}</Dialog.Title>
          <Dialog.Close asChild><Button action="close-dialog" variant="quiet" aria-label={t("a11y.close")} title={t("a11y.close")}><Icon name="close" /></Button></Dialog.Close>
        </div>
        {props.children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
