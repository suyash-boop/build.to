"use client";

import { useId, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/api.client";
import { Button } from "./button";
import { Input } from "./input";
import { Dialog, DialogContent, DialogFooter } from "./overlay";

/**
 * Confirmation for consequential actions. Pass `typeToConfirm` for irreversible ones so the
 * user has to type a name, not just click through.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  typeToConfirm,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  typeToConfirm?: string;
  onConfirm: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState("");
  const inputId = useId();
  const ready = !typeToConfirm || typed === typeToConfirm;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setTyped("");
        onOpenChange(o);
      }}
    >
      {open && (
        <DialogContent title={title} description={description}>
          {typeToConfirm && (
            <div className="space-y-1.5">
              <label htmlFor={inputId} className="text-sm text-muted">
                Type <span className="font-mono text-fg">{typeToConfirm}</span> to confirm
              </label>
              <Input id={inputId} value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off" spellCheck={false} />
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              variant={destructive ? "danger" : "primary"}
              loading={busy}
              disabled={!ready}
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirm();
                  setTyped("");
                  onOpenChange(false);
                } catch (err) {
                  toast.error(errorMessage(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
