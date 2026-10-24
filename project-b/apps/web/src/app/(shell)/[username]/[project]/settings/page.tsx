import type { Metadata } from "next";
import { headers } from "next/headers";
import { PageBody } from "@/components/shell/page";
import { api, getMe } from "@/lib/api.server";
import { can, getProject, requirePermission } from "@/lib/project.server";
import type { AuditEntry, Delivery, TechOption } from "./settings-forms";
import { ProjectSettings } from "./settings-forms";
import type { MemberItem, SignalSettingsDto, WebhookEndpointItem } from "@bldt/contracts";

export async function generateMetadata({ params }: PageProps<"/[username]/[project]/settings">): Promise<Metadata> {
  const { username, project } = await params;
  return { title: `Settings · ${(await getProject(username, project)).name}` };
}

export default async function SettingsPage({ params }: PageProps<"/[username]/[project]/settings">) {
  const { username, project } = await params;
  const p = await getProject(username, project);
  requirePermission(p, "project.update");
  const base = `/projects/${p.owner.username}/${p.slug}`;
  const canIntegrate = can(p, "project.integrations");
  const [me, techs, deliveries, audit, members, signalSettings, webhooks] = await Promise.all([
    getMe(),
    api<{ items: TechOption[] }>("/technologies"),
    canIntegrate ? api<{ items: Delivery[] }>(`${base}/deliveries`) : Promise.resolve({ items: [] }),
    can(p, "audit.view") ? api<{ items: AuditEntry[] }>(`${base}/audit?limit=30`) : Promise.resolve({ items: [] }),
    api<{ items: MemberItem[] }>(`${base}/members`),
    api<SignalSettingsDto>(`${base}/signal-settings`),
    canIntegrate ? api<{ items: WebhookEndpointItem[] }>(`${base}/webhooks`) : Promise.resolve({ items: [] }),
  ]);
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? (h.get("host")?.startsWith("localhost") ? "http" : "https");
  const origin = `${proto}://${h.get("host")}`;

  return (
    <PageBody width="medium">
      <ProjectSettings
        project={p}
        origin={origin}
        viewerId={me!.id}
        catalog={techs.items}
        deliveries={deliveries.items}
        audit={audit.items}
        maintainers={members.items.filter((m) => m.role === "MAINTAINER").map((m) => m.user)}
        githubConnected={Boolean(me?.githubLogin)}
        signalSettings={signalSettings}
        webhooks={webhooks.items}
      />
    </PageBody>
  );
}
