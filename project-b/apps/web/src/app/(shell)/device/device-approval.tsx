"use client";

import { CircleCheck, CircleX, Laptop, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { RelativeTime } from "@/components/domain/time";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel } from "@/components/ui/misc";
import { errorMessage, http } from "@/lib/api.client";

export interface DeviceRequest {
  userCode: string;
  clientName: string;
  ip: string | null;
  createdAt: string;
  status: "PENDING" | "APPROVED" | "DENIED" | "CONSUMED";
}

export function DeviceApproval({ initialCode, request, error, username }: { initialCode: string; request: DeviceRequest | null; error: string | null; username: string }) {
  const router = useRouter();
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [done, setDone] = useState<"approved" | "denied" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const decide = async (decision: "approve" | "deny") => {
    if (!request) return;
    setBusy(decision);
    setFailure(null);
    try {
      await http.post(`/auth/device/${request.userCode}/${decision}`);
      setDone(decision === "approve" ? "approved" : "denied");
    } catch (err) {
      setFailure(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  if (done) {
    return (
      <Panel className="flex flex-col items-center gap-2 px-6 py-10 text-center">
        {done === "approved" ? <CircleCheck className="size-6 text-success" /> : <CircleX className="size-6 text-faint" />}
        <p className="text-base font-medium">{done === "approved" ? "Device connected" : "Request declined"}</p>
        <p className="max-w-sm text-sm text-muted">
          {done === "approved"
            ? "Go back to your editor; it finishes signing in on its own. You can disconnect it any time in Settings, under Sessions."
            : "Nothing was connected. If you did not start this, you can ignore it."}
        </p>
      </Panel>
    );
  }

  if (!request) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          router.push(`/device?code=${encodeURIComponent(code.trim())}`);
        }}
        className="space-y-4"
      >
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Connect a device</h1>
          <p className="mt-1 text-sm text-muted">Enter the code your editor shows.</p>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex gap-2">
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABCD-EFGH" autoFocus className="h-10 max-w-48 text-center font-mono text-base tracking-widest uppercase" aria-label="Device code" />
          <Button type="submit" variant="primary" size="lg" disabled={code.replace(/[^a-z]/gi, "").length !== 8}>
            Continue
          </Button>
        </div>
      </form>
    );
  }

  const usable = request.status === "PENDING";
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Connect {request.clientName}?</h1>
        <p className="mt-1 text-sm text-muted">
          It will act as <span className="font-medium text-fg">@{username}</span>: see your projects and tasks, update tasks, and post in discussions.
        </p>
      </div>
      <Panel className="divide-y divide-border">
        <Row label="Code" value={<span className="font-mono tracking-widest">{request.userCode}</span>} />
        <Row label="Device" value={<span className="flex items-center gap-1.5"><Laptop className="size-3.5 text-faint" />{request.clientName}</span>} />
        <Row label="Requested" value={<><RelativeTime iso={request.createdAt} />{request.ip ? <span className="text-faint"> from {request.ip}</span> : null}</>} />
      </Panel>
      <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2.5 text-xs text-muted">
        <ShieldAlert className="mt-px size-3.5 shrink-0 text-warning" />
        <span>Only approve if you just started sign-in in your own editor and the code matches what it shows. Someone else may have sent you this link.</span>
      </div>
      {failure && <p className="text-sm text-danger">{failure}</p>}
      {usable ? (
        <div className="flex gap-2">
          <Button variant="primary" size="lg" loading={busy === "approve"} disabled={busy !== null} onClick={() => decide("approve")}>
            Approve
          </Button>
          <Button size="lg" variant="ghost" loading={busy === "deny"} disabled={busy !== null} onClick={() => decide("deny")}>
            Deny
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted">This request was already {request.status === "DENIED" ? "declined" : "used"}. Start sign-in again from your editor if you need to.</p>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 px-4 py-2.5 text-sm">
      <span className="w-24 shrink-0 text-faint">{label}</span>
      <span className="min-w-0 flex-1">{value}</span>
    </div>
  );
}
