import type { WorkRecordView } from "@bldt/contracts";
import { BadgeCheck, CircleSlash, ExternalLink, GitMerge, ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MobileTitle, PageBody, PageHeader } from "@/components/shell/page";
import { Panel } from "@/components/ui/misc";
import { apiOr404 } from "@/lib/api.server";
import { cn, fullDate, shortDate } from "@/lib/utils";
import { RecordActions } from "./record-actions";

const ROLE: Record<string, string> = { OWNER: "Owner", MAINTAINER: "Maintainer", CONTRIBUTOR: "Contributor", VIEWER: "Viewer" };

async function load(id: string) {
  // Ids are UUIDs; anything else is simply not a record.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  return apiOr404<WorkRecordView>(`/work-records/${id}`);
}

export async function generateMetadata({ params }: PageProps<"/verify/[id]">): Promise<Metadata> {
  const { id } = await params;
  const v = await load(id);
  const r = v.signed.record;
  return {
    title: `Work record: ${r.subject.name}${r.project.name ? ` on ${r.project.name}` : ""}`,
    // Shared by link on purpose; not for search engines.
    robots: { index: false, follow: false },
  };
}

export default async function WorkRecordPage({ params }: PageProps<"/verify/[id]">) {
  const { id } = await params;
  const v = await load(id);
  const r = v.signed.record;
  const s = r.summary;
  // Without a linked GitHub account nothing from GitHub was counted; zero would read as "did none".
  const gh = r.subject.github !== null;
  const stats: [string, string][] = [
    ["Merged pull requests", gh ? String(s.pullRequestsMerged) : "Not counted"],
    ["Lines changed", !gh ? "Not counted" : s.pullRequestsMerged ? `+${s.additions.toLocaleString("en")} −${s.deletions.toLocaleString("en")}` : "0"],
    ["Tasks completed", String(s.tasksCompleted)],
    ["Reviews", gh ? String(s.reviews) : "Not counted"],
    ["Releases", String(s.releases)],
  ];

  return (
    <>
      <PageHeader title="Work record" />
      <MobileTitle>Work record</MobileTitle>
      <PageBody width="medium">
        <div className="space-y-8">
          <StatusStrip view={v} />

          <header>
            <p className="text-2xs font-medium uppercase tracking-wide text-faint">Work record</p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight">
              {r.subject.name}{" "}
              <Link href={`/${r.subject.username}`} className="text-base font-normal text-faint hover:text-fg">
                @{r.subject.username}
              </Link>
            </h1>
            <p className="mt-1 text-sm text-muted">
              {ROLE[r.role] ?? r.role} on{" "}
              {r.project.url && r.project.name ? (
                <Link href={new URL(r.project.url).pathname.replace(/^\/projects(?=\/|$)/, "")} className="font-medium text-fg hover:underline">
                  {r.project.name}
                </Link>
              ) : (
                <span className="font-medium text-fg">a private project</span>
              )}
              , member since {shortDate(r.memberSince)}. Covers <span className="tnum">{shortDate(r.period.from)}</span> to{" "}
              <span className="tnum">{shortDate(r.period.to)}</span>.
            </p>
            {r.subject.github && (
              <p className="mt-1 text-xs text-faint">
                Linked GitHub account:{" "}
                <a href={`https://github.com/${r.subject.github}`} target="_blank" rel="noopener noreferrer" className="font-mono hover:text-fg">
                  {r.subject.github}
                </a>
              </p>
            )}
          </header>

          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-5">
            {stats.map(([label, value]) => (
              <div key={label} className="bg-surface px-3 py-2.5">
                <dt className="text-2xs text-faint">{label}</dt>
                <dd className="mt-0.5 text-base font-medium tnum">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="-mt-5 text-xs text-faint">
            {gh ? (
              <>
                Pull requests and reviews come from GitHub and count only under <span className="font-mono">{r.subject.github}</span>. Tasks and releases are tracked in bld.t.
              </>
            ) : (
              "No GitHub account was linked when this was issued, so GitHub work is not counted here. Tasks and releases are tracked in bld.t."
            )}
          </p>

          {r.project.visibility === "PRIVATE" && (
            <Panel className="px-4 py-3 text-sm text-muted">The project is private, so this record states counts only. Names and titles are left out.</Panel>
          )}

          {r.evidence.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold">
                Merged pull requests{" "}
                <span className="font-normal text-faint">
                  {r.evidence.length < s.pullRequestsMerged ? `${r.evidence.length} most recent of ${s.pullRequestsMerged}` : ""}
                </span>
              </h2>
              <Panel className="divide-y divide-border">
                {r.evidence.map((e) => (
                  <a key={`${e.repo}#${e.number}`} href={e.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-hover">
                    <GitMerge className="size-3.5 shrink-0 text-st-shipped" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{e.title}</span>
                      <span className="block truncate font-mono text-2xs text-faint">
                        {e.repo}#{e.number}
                      </span>
                    </span>
                    <span className="hidden shrink-0 font-mono text-2xs sm:block">
                      <span className="text-success">+{e.additions}</span> <span className="text-danger">−{e.deletions}</span>
                    </span>
                    <span className="w-14 shrink-0 text-right text-xs text-faint tnum">{shortDate(e.mergedAt)}</span>
                    <ExternalLink className="size-3 shrink-0 text-faint" />
                  </a>
                ))}
              </Panel>
            </section>
          )}

          {r.tasks.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold">
                Completed tasks{" "}
                <span className="font-normal text-faint">{r.tasks.length < s.tasksCompleted ? `${r.tasks.length} most recent of ${s.tasksCompleted}` : ""}</span>
              </h2>
              <Panel className="divide-y divide-border">
                {r.tasks.map((t) => (
                  <div key={t.identifier} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span className="w-20 shrink-0 font-mono text-2xs text-faint">{t.identifier}</span>
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                    <span className="shrink-0 text-xs text-faint tnum">{shortDate(t.completedAt)}</span>
                  </div>
                ))}
              </Panel>
            </section>
          )}

          <section className="border-t border-border pt-6">
            <h2 className="text-sm font-semibold">Check it yourself</h2>
            <p className="mt-1 text-sm text-muted">
              You do not have to trust this page. The record is canonical JSON (keys sorted, no whitespace) signed with Ed25519. Download it, fetch the
              public key with id <span className="font-mono text-xs">{v.signed.signature.kid}</span> from{" "}
              <a href="/projects/.well-known/bldt-keys.json" className="font-mono text-xs text-fg underline underline-offset-2">
                /.well-known/bldt-keys.json
              </a>
              , and verify the signature over the record. Any change to the record, even one character, makes it fail. Or{" "}
              <Link href="/verify" className="text-fg underline underline-offset-2">
                paste the JSON into the verifier
              </Link>
              .
            </p>
            <RecordActions id={id} signed={v.signed} />
          </section>
        </div>
      </PageBody>
    </>
  );
}

function StatusStrip({ view: v }: { view: WorkRecordView }) {
  const r = v.signed.record;
  if (v.status === "invalid") {
    return (
      <Strip tone="danger" icon={<ShieldAlert className="size-4" />} title="This record failed verification">
        Its contents do not match the signature. Do not rely on it.
      </Strip>
    );
  }
  if (v.status === "revoked") {
    return (
      <Strip tone="danger" icon={<CircleSlash className="size-4" />} title={`Revoked by ${r.subject.name} on ${shortDate(v.revokedAt!)}`}>
        {v.revokedReason ? `Reason given: ${v.revokedReason}. ` : ""}The signature is genuine, but the holder no longer stands behind this record.
      </Strip>
    );
  }
  return (
    <Strip tone="success" icon={<BadgeCheck className="size-4" />} title="Signature verified">
      Issued by bld.t on {fullDate(r.issuedAt)} and unchanged since.{v.keyStatus === "retired" ? " Signed with a previous key that is still published." : ""}
    </Strip>
  );
}

function Strip({ tone, icon, title, children }: { tone: "success" | "danger"; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-3 rounded-lg border px-4 py-3",
        tone === "success" ? "border-success/30 bg-success/5" : "border-danger/30 bg-danger/5",
      )}
    >
      <span className={cn("mt-0.5", tone === "success" ? "text-success" : "text-danger")}>{icon}</span>
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-sm text-muted">{children}</p>
      </div>
    </div>
  );
}

export const dynamic = "force-dynamic";
