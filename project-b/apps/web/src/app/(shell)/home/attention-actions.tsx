"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { errorMessage, http } from "@/lib/api.client";

export function AttentionActions({ kind, id, owner, slug }: { kind: "invitation" | "request"; id: string; owner: string; slug: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<"yes" | "no" | null>(null);

  const act = async (yes: boolean) => {
    setBusy(yes ? "yes" : "no");
    try {
      if (kind === "invitation") {
        await http.post(`/invitations/${id}/respond`, { accept: yes });
        toast.success(yes ? "You joined the project" : "Invitation declined");
        await qc.invalidateQueries({ queryKey: ["me"] });
        if (yes) router.push(`/${owner}/${slug}`);
      } else {
        await http.post(`/projects/${owner}/${slug}/requests/${id}/decide`, { decision: yes ? "APPROVE" : "DECLINE" });
        toast.success(yes ? "Added as contributor" : "Request declined");
      }
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <span className="flex shrink-0 gap-1.5">
      <Button size="xs" variant="ghost" loading={busy === "no"} disabled={busy !== null} onClick={() => act(false)}>
        Decline
      </Button>
      <Button size="xs" variant="primary" loading={busy === "yes"} disabled={busy !== null} onClick={() => act(true)}>
        {kind === "invitation" ? "Accept" : "Approve"}
      </Button>
    </span>
  );
}
