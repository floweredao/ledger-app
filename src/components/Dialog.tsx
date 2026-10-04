import { useRef } from "react";
import { Button } from "./Button";
import { Sheet, type SheetProps } from "./Sheet";

export function Dialog(props: Omit<SheetProps, "variant">) {
  return <Sheet {...props} variant="dialog" />;
}

type ConfirmDialogProps = {
  readonly open: boolean;
  readonly title: string;
  readonly description?: string;
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  readonly destructive?: boolean;
  readonly busy?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "취소",
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Sheet
      open={open}
      onClose={onCancel}
      title={title}
      variant="dialog"
      role="alertdialog"
      initialFocusRef={cancelRef}
      {...(description ? { description } : {})}
      footer={
        <>
          <Button ref={cancelRef} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? "danger" : "primary"} onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {null}
    </Sheet>
  );
}
