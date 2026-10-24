"use client";

import type { WorkRecordVerification } from "@bldt/contracts";
import { BadgeCheck, CircleSlash, FileUp, HelpCircle, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { errorMessage, http } from "@/lib/api.client";
import { cn, shortDate } from "@/lib/utils";

const REASON: Record<string, string> = {
  malformed: "This is not a bld.t work record, or it has been reformatted in a way that changed its values.",
  unknown_key: "It was not signed by any key bld.t has published.",
  bad_signature: "The contents were changed after signing. Some figure, name, or date in it is not what bld.t issued.",
};

export function VerifyForm() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<WorkRecordVerification | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const check = async (raw = text) => {
    setError(null);
    setResult(null);
    let doc: unknown;
    try {
      doc = JSON.parse(raw);
    } catch {
      setError("That is not valid JSON. Paste the whole file, including the outer braces.");
      return;
    }
    setBusy(true);
    try {
      setResult(await http.post<WorkRecordVerification>("/work-records/verify", doc));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 256 * 1024) return setError("That file is too large to be a work record.");
    const raw = await file.text();
    setText(raw);
    void check(raw);
  };

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void onFile(e.dataTransfer.files[0]);
        }}
        className={cn("rounded-lg transition-colors", dragging && "outline-2 outline-dashed outline-border-strong")}
      >
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          spellCheck={false}
          placeholder='{ "record": { ... }, "signature": { "alg": "Ed25519", ... } }'
          className="font-mono text-xs"
          aria-label="Signed work record JSON"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => check()} loading={busy} disabled={!text.trim()}>
          Verify
        </Button>
        <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md px-3 text-sm text-muted hover:bg-surface-hover hover:text-fg">
          <FileUp className="size-3.5" /> Choose a file
          <input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      {result && <Result r={result} />}
    </div>
  );
}

function Result({ r }: { r: WorkRecordVerification }) {
  const rec = r.record;
  const who = rec ? `${rec.subject.name} (@${rec.subject.username})` : "";
  const what = rec ? `${rec.project.name ?? "a private project"}, ${shortDate(rec.period.from)} to ${shortDate(rec.period.to)}` : "";
  const view = rec && r.status !== "unknown_record" ? (
    <Link href={`/verify/${rec.id}`} className="text-fg underline underline-offset-2">
      Open the full record
    </Link>
  ) : null;

  const [tone, icon, title, body] =
    r.status === "valid"
      ? (["success", <BadgeCheck key="i" className="size-4" />, "Genuine and current", <>Issued by bld.t to {who} for {what}. Not revoked. {view}</>] as const)
      : r.status === "revoked"
        ? (["danger", <CircleSlash key="i" className="size-4" />, "Genuine, but revoked", <>The signature is real, but {who} revoked it on {shortDate(r.revokedAt!)}. {view}</>] as const)
        : r.status === "unknown_record"
          ? (["warning", <HelpCircle key="i" className="size-4" />, "Genuine signature, not in this registry", <>Signed by bld.t for {who} ({what}), but this server has no entry for it, usually because the holder deleted their account. Revocation cannot be checked.</>] as const)
          : (["danger", <ShieldAlert key="i" className="size-4" />, "Not genuine", <>{REASON[r.reason ?? "malformed"]}</>] as const);

  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-3 rounded-lg border px-4 py-3",
        tone === "success" ? "border-success/30 bg-success/5" : tone === "warning" ? "border-warning/30 bg-warning/5" : "border-danger/30 bg-danger/5",
      )}
    >
      <span className={cn("mt-0.5", tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-danger")}>{icon}</span>
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-sm text-muted">{body}</p>
      </div>
    </div>
  );
}
