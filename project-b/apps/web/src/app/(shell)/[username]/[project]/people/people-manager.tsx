"use client";

import { canAssignRole, type InvitationItem, type JoinRequestItem, type MemberItem, type ProjectRole, type SuggestedPerson } from "@bldt/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, MoreHorizontal, UserMinus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { GithubMark } from "@/components/domain/logo";
import { MatchLine, PersonCardView } from "@/components/domain/match";
import { RelativeTime } from "@/components/domain/time";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Input } from "@/components/ui/input";
import { Avatar, Panel, SectionHeader } from "@/components/ui/misc";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/overlay";
import { ApiError, errorMessage, http } from "@/lib/api.client";
import { compactNumber, monthYear } from "@/lib/utils";

const ROLE_LABEL: Record<ProjectRole, string> = { OWNER: "Owner", MAINTAINER: "Maintainer", CONTRIBUTOR: "Contributor", VIEWER: "Viewer" };
const ROLE_HELP: Record<Exclude<ProjectRole, "OWNER">, string> = {
  MAINTAINER: "Manage tasks, milestones, members, ship",
  CONTRIBUTOR: "Create and work on tasks, comment",
  VIEWER: "Read-only access to the workspace",
};

export function PeopleManager(props: {
  owner: string;
  slug: string;
  viewerId: string | null;
  viewerRole: ProjectRole | null;
  members: MemberItem[];
  external: { githubLogin: string; commits: number; prsMerged: number }[];
  invitations: InvitationItem[];
  requests: JoinRequestItem[];
  canInvite: boolean;
  canManage: boolean;
  canReview: boolean;
}) {
  const { owner, slug, viewerId, viewerRole, members, external, invitations, requests, canInvite, canManage, canReview } = props;
  const base = `/projects/${owner}/${slug}`;
  const router = useRouter();
  const qc = useQueryClient();
  const [removing, setRemoving] = useState<MemberItem | null>(null);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["members", owner, slug] });
    router.refresh();
  };
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const self = members.find((m) => m.user.id === viewerId);
  const assignable = (target: ProjectRole) => viewerRole != null && canManage && canAssignRole(viewerRole, target);

  return (
    <div className="space-y-8">
      {canInvite && <InviteForm base={base} viewerRole={viewerRole!} onDone={refresh} />}

      {canReview && requests.length > 0 && (
        <section>
          <SectionHeader title="Requests to join" count={requests.length} />
          <Panel className="divide-y divide-border">
            {requests.map((r) => (
              <div key={r.id} className="flex items-start gap-3 px-4 py-3">
                <Avatar user={r.user} size={28} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <Link href={`/${r.user.username}`} className="font-medium hover:underline">{r.user.displayName}</Link>{" "}
                    <span className="text-faint">@{r.user.username}</span>
                    {r.roleWanted && <span className="text-muted"> wants to help with {r.roleWanted}</span>}
                  </p>
                  <p className="mt-1 whitespace-pre-line text-sm text-muted">{r.message}</p>
                  <p className="mt-1 text-xs text-faint"><RelativeTime iso={r.createdAt} /></p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button size="xs" variant="ghost" onClick={() => run(() => http.post(`${base}/requests/${r.id}/decide`, { decision: "DECLINE" }), "Request declined")}>
                    Decline
                  </Button>
                  <Button size="xs" variant="primary" onClick={() => run(() => http.post(`${base}/requests/${r.id}/decide`, { decision: "APPROVE", role: "CONTRIBUTOR" }), `${r.user.displayName} added as contributor`)}>
                    Approve
                  </Button>
                </div>
              </div>
            ))}
          </Panel>
        </section>
      )}

      <section>
        <SectionHeader
          title="Members"
          count={members.length}
          action={
            self && self.role !== "OWNER" ? (
              <Button size="xs" variant="ghost" onClick={() => setRemoving(self)}>
                <LogOut className="size-3.5" /> Leave project
              </Button>
            ) : undefined
          }
        />
        <Panel className="divide-y divide-border">
          {members.map((m) => {
            const c = m.contribution;
            return (
              <div key={m.user.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap">
                <Avatar user={m.user} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    <Link href={`/${m.user.username}`} className="font-medium hover:underline">{m.user.displayName}</Link>
                    {m.title && <span className="text-muted"> · {m.title}</span>}
                  </p>
                  <p className="text-xs text-faint">
                    @{m.user.username} · joined {monthYear(m.joinedAt)}
                  </p>
                </div>
                {c ? (
                  <dl className="hidden shrink-0 grid-cols-3 gap-5 text-right text-xs md:grid" title="From connected GitHub repositories">
                    <Stat label="Commits" value={c.commits} />
                    <Stat label="PRs merged" value={c.prsMerged} />
                    <Stat label="Reviews" value={c.reviews} />
                  </dl>
                ) : (
                  <span className="hidden text-xs text-faint md:inline">No GitHub activity yet</span>
                )}
                <div className="flex w-36 shrink-0 justify-end">
                  {m.role !== "OWNER" && assignable(m.role) ? (
                    <Menu>
                      <MenuTrigger asChild>
                        <Button size="sm" variant="ghost">{ROLE_LABEL[m.role]} <MoreHorizontal className="size-3.5 text-faint" /></Button>
                      </MenuTrigger>
                      <MenuContent className="w-72">
                        <MenuLabel>Role</MenuLabel>
                        {(["MAINTAINER", "CONTRIBUTOR", "VIEWER"] as const)
                          .filter((r) => assignable(r))
                          .map((r) => (
                            <MenuItem key={r} onSelect={() => r !== m.role && run(() => http.patch(`${base}/members/${m.user.id}`, { role: r }), `${m.user.displayName} is now ${ROLE_LABEL[r].toLowerCase()}`)}>
                              <span className="flex-1">
                                <span className="block">{ROLE_LABEL[r]}</span>
                                <span className="block text-xs text-faint">{ROLE_HELP[r]}</span>
                              </span>
                              {r === m.role && <span className="text-xs text-muted">Current</span>}
                            </MenuItem>
                          ))}
                        <MenuSeparator />
                        <MenuItem destructive onSelect={() => setRemoving(m)}>
                          <UserMinus className="size-4" /> Remove from project
                        </MenuItem>
                      </MenuContent>
                    </Menu>
                  ) : (
                    <span className="px-2.5 text-sm text-muted">{ROLE_LABEL[m.role]}</span>
                  )}
                </div>
              </div>
            );
          })}
        </Panel>
      </section>

      {canInvite && <SuggestedPeople base={base} onInvited={refresh} />}

      {canInvite && invitations.length > 0 && (
        <section>
          <SectionHeader title="Pending invitations" count={invitations.length} />
          <Panel className="divide-y divide-border">
            {invitations.map((i) => (
              <div key={i.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                {i.invitee && <Avatar user={i.invitee} size={22} />}
                <span className="min-w-0 flex-1 truncate">
                  {i.invitee?.displayName} <span className="text-faint">as {ROLE_LABEL[i.role].toLowerCase()}, invited by {i.inviter.displayName}</span>
                </span>
                <span className="text-xs text-faint">expires <RelativeTime iso={i.expiresAt} /></span>
                <Button size="xs" variant="ghost" onClick={() => run(() => http.del(`${base}/invitations/${i.id}`), "Invitation revoked")}>
                  Revoke
                </Button>
              </div>
            ))}
          </Panel>
        </section>
      )}

      {external.length > 0 && (
        <section>
          <SectionHeader title="Other contributors on GitHub" count={external.length} />
          <p className="-mt-1 mb-2 text-xs text-muted">People with commits in connected repositories who are not members here. Their work counts once they join bld.t and the project.</p>
          <Panel className="divide-y divide-border">
            {external.map((e) => (
              <div key={e.githubLogin} className="flex items-center gap-3 px-4 py-2 text-sm">
                <GithubMark className="size-3.5 text-faint" />
                <a href={`https://github.com/${e.githubLogin}`} target="_blank" rel="noopener noreferrer" className="flex-1 truncate hover:underline">
                  {e.githubLogin}
                </a>
                <span className="text-xs text-faint tnum">
                  {compactNumber(e.commits)} commits · {e.prsMerged} PRs merged
                </span>
              </div>
            ))}
          </Panel>
        </section>
      )}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={removing?.user.id === viewerId ? "Leave this project?" : `Remove ${removing?.user.displayName}?`}
        description={
          removing?.user.id === viewerId
            ? "You lose access to the workspace. Your past contributions stay attributed to you."
            : "They lose access and their open tasks become unassigned. Their past contributions stay attributed to them."
        }
        confirmLabel={removing?.user.id === viewerId ? "Leave project" : "Remove member"}
        destructive
        onConfirm={async () => {
          if (!removing) return;
          await http.del(`${base}/members/${removing.user.id}`);
          toast.success(removing.user.id === viewerId ? "You left the project" : "Member removed");
          if (removing.user.id === viewerId) {
            await qc.invalidateQueries({ queryKey: ["me"] });
            router.push("/home");
          }
          await refresh();
        }}
      />
    </div>
  );
}

/** Builders outside the project whose public work overlaps its stack. Loaded lazily; it is a secondary aid. */
function SuggestedPeople({ base, onInvited }: { base: string; onInvited: () => Promise<void> }) {
  const qc = useQueryClient();
  const key = ["suggested-people", base];
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => http.get<{ items: SuggestedPerson[] }>(`${base}/suggested-people`).then((r) => r.items),
    staleTime: 5 * 60_000,
  });
  const [busy, setBusy] = useState<string | null>(null);
  if (!data || data.length === 0) return null;

  const invite = async (p: SuggestedPerson) => {
    setBusy(p.id);
    try {
      await http.post(`${base}/invitations`, { username: p.username, role: "CONTRIBUTOR" });
      toast.success(`Invited ${p.displayName} as contributor`);
      qc.setQueryData<SuggestedPerson[]>(key, (old) => old?.filter((x) => x.id !== p.id));
      await onInvited();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section>
      <SectionHeader title="People who build with this stack" />
      <p className="-mt-1 mb-3 text-xs text-muted">From their public projects. Nobody is notified unless you invite them.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {data.map((p) => (
          <PersonCardView
            key={p.id}
            p={p}
            footer={
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
                <MatchLine reason={p.reason} />
                <Button size="xs" loading={busy === p.id} onClick={() => invite(p)}>
                  Invite
                </Button>
              </div>
            }
          />
        ))}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-faint">{label}</dt>
      <dd className="font-medium text-fg tnum">{compactNumber(value)}</dd>
    </div>
  );
}

function InviteForm({ base, viewerRole, onDone }: { base: string; viewerRole: ProjectRole; onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<Exclude<ProjectRole, "OWNER">>("CONTRIBUTOR");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const roles = (["MAINTAINER", "CONTRIBUTOR", "VIEWER"] as const).filter((r) => canAssignRole(viewerRole, r));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await http.post(`${base}/invitations`, { username: username.replace(/^@/, "").trim(), role });
      toast.success(`Invitation sent to ${username}`);
      setUsername("");
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <SectionHeader title="Invite someone" />
      <form onSubmit={submit} className="flex flex-wrap gap-2">
        <div className="min-w-48 flex-1">
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="bld.t username"
            aria-label="Username to invite"
            aria-invalid={Boolean(error)}
            leading="@"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as typeof role)}
          aria-label="Role"
          className="h-8 rounded-md border border-border bg-surface px-2 text-sm"
        >
          {roles.map((r) => (
            <option key={r} value={r}>{ROLE_LABEL[r]}</option>
          ))}
        </select>
        <Button type="submit" variant="primary" loading={busy} disabled={!username.trim()}>Send invite</Button>
      </form>
      {error ? <p className="mt-1.5 text-xs text-danger">{error}</p> : <p className="mt-1.5 text-xs text-faint">{ROLE_HELP[role]}. They accept from their inbox.</p>}
    </section>
  );
}
