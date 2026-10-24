"use client";

import { WEBHOOK_CATEGORIES, type OutboundDeliveryDetail, type OutboundDeliveryItem, type Paginated, type WebhookEndpointItem } from "@bldt/contracts";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronRight, CircleCheck, CircleX, Clock, Copy, KeyRound, MoreHorizontal, Pencil, Plus, Power, RotateCw, Send, Trash2, Webhook } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { RelativeTime } from "@/components/domain/time";
import { Button } from "@/components/ui/button";
import { Checkbox, Segmented } from "@/components/ui/choice";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Field, Input } from "@/components/ui/input";
import { LoadError } from "@/components/ui/load-error";
import { Badge, Panel } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogFooter, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/overlay";
import { ApiError, errorMessage, http } from "@/lib/api.client";
import { cn, plural } from "@/lib/utils";

type Format = WebhookEndpointItem["format"];

const CATEGORY_LABEL: Record<string, string> = {
  task: "Tasks",
  milestone: "Milestones",
  release: "Releases and ships",
  project: "Project stage",
  member: "Members",
  pull_request: "Pull requests",
  push: "Pushes",
  deployment: "Deployments",
  signal: "Signals",
};

const FORMAT_HINT: Record<Format, string> = {
  JSON: "Signed JSON for your own service. Verify the X-Bldt-Signature header.",
  SLACK: "A Slack incoming webhook URL, from a Slack app's Incoming Webhooks page.",
  DISCORD: "A Discord channel webhook URL, from Channel settings, Integrations. Messages never mention anyone.",
};

const keys = {
  list: (api: string) => ["webhooks", api] as const,
  deliveries: (api: string, id: string) => ["webhook-deliveries", api, id] as const,
};

export function WebhooksSection({ api, initial }: { api: string; initial: WebhookEndpointItem[] }) {
  const qc = useQueryClient();
  const { data: items = initial } = useQuery({
    queryKey: keys.list(api),
    queryFn: () => http.get<{ items: WebhookEndpointItem[] }>(`${api}/webhooks`).then((r) => r.items),
    initialData: initial,
    // While deliveries are in flight, keep the counters honest.
    refetchInterval: (q) => ((q.state.data ?? []).some((e) => e.recent.pending > 0) ? 5_000 : false),
  });
  const [editing, setEditing] = useState<WebhookEndpointItem | "new" | null>(null);
  const [secret, setSecret] = useState<{ value: string; rotated: boolean } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: keys.list(api) });

  return (
    <section id="webhooks" className="scroll-mt-20">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Webhooks</h2>
          <p className="mt-0.5 text-sm text-muted">Send project events to Slack, Discord, or your own service as they happen. Failed deliveries retry for about ten hours.</p>
        </div>
        {items.length > 0 && (
          <Button size="sm" onClick={() => setEditing("new")} disabled={items.length >= 10}>
            <Plus className="size-3.5" /> Add webhook
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <Panel className="flex flex-col items-center gap-3 px-6 py-8 text-center">
          <Webhook className="size-5 text-faint" />
          <p className="max-w-sm text-sm text-muted">Post finished tasks, merged pull requests, releases and alerts to a channel, or trigger your own automation.</p>
          <Button size="sm" variant="primary" onClick={() => setEditing("new")}>
            <Plus className="size-3.5" /> Add webhook
          </Button>
        </Panel>
      ) : (
        <Panel className="divide-y divide-border overflow-hidden">
          {items.map((e) => (
            <EndpointRow
              key={e.id}
              api={api}
              endpoint={e}
              expanded={open === e.id}
              onToggle={() => setOpen((o) => (o === e.id ? null : e.id))}
              onEdit={() => setEditing(e)}
              onSecret={(value) => setSecret({ value, rotated: true })}
              onChanged={refresh}
            />
          ))}
        </Panel>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        {editing !== null && (
          <EndpointForm
            api={api}
            endpoint={editing === "new" ? null : editing}
            onDone={(created) => {
              setEditing(null);
              void refresh();
              if (created) {
                setSecret({ value: created.secret, rotated: false });
                setOpen(created.endpoint.id);
              }
            }}
          />
        )}
      </Dialog>

      <Dialog open={secret !== null} onOpenChange={(o) => !o && setSecret(null)}>
        {secret && <SecretReveal secret={secret.value} rotated={secret.rotated} onClose={() => setSecret(null)} />}
      </Dialog>
    </section>
  );
}

function health(e: WebhookEndpointItem): { tone: string; label: string } {
  if (!e.active) return { tone: "bg-faint", label: e.disabledReason ? "Disabled automatically" : "Disabled" };
  if (e.consecutiveFailures > 0) return { tone: "bg-warning", label: `Failing (${plural(e.consecutiveFailures, "delivery", "deliveries")} failed in a row)` };
  if (!e.lastDeliveryAt) return { tone: "bg-border-strong", label: "No deliveries yet" };
  return { tone: "bg-success", label: "Healthy" };
}

function EndpointRow({
  api,
  endpoint: e,
  expanded,
  onToggle,
  onEdit,
  onSecret,
  onChanged,
}: {
  api: string;
  endpoint: WebhookEndpointItem;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onSecret: (s: string) => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<"delete" | "rotate" | null>(null);
  const h = health(e);
  const base = `${api}/webhooks/${e.id}`;
  let host = e.url;
  try {
    const u = new URL(e.url);
    host = `${u.host}${u.pathname.length > 1 ? u.pathname : ""}`;
  } catch {}

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast.success(ok);
      onChanged();
      await qc.invalidateQueries({ queryKey: keys.deliveries(api, e.id) });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-3">
        <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <ChevronRight className={cn("size-3.5 shrink-0 text-faint transition-transform duration-150", expanded && "rotate-90")} />
          <span className={cn("size-2 shrink-0 rounded-full", h.tone)} title={h.label} aria-label={h.label} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate font-mono text-xs">{host}</span>
              <Badge>{e.format === "JSON" ? "JSON" : e.format === "SLACK" ? "Slack" : "Discord"}</Badge>
            </span>
            <span className="mt-0.5 block truncate text-xs text-faint">
              {e.description ? `${e.description} · ` : ""}
              {e.events.length === 0 ? "All events" : e.events.map((c) => CATEGORY_LABEL[c] ?? c).join(", ")}
            </span>
          </span>
        </button>
        <span className="hidden shrink-0 text-right text-xs text-faint sm:block">
          {e.recent.total > 0 ? (
            <span className="tnum">
              {e.recent.total} in 24h{e.recent.failed > 0 && <span className="text-danger"> · {e.recent.failed} failed</span>}
            </span>
          ) : e.lastDeliveryAt ? (
            <>
              Last <RelativeTime iso={e.lastDeliveryAt} />
            </>
          ) : (
            "Nothing sent yet"
          )}
        </span>
        <Menu>
          <MenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label={`Actions for ${host}`}>
              <MoreHorizontal className="size-3.5" />
            </Button>
          </MenuTrigger>
          <MenuContent>
            <MenuItem onSelect={() => run(() => http.post(`${base}/test`), "Test event queued")}>
              <Send className="size-3.5 text-faint" /> Send test event
            </MenuItem>
            <MenuItem onSelect={onEdit}>
              <Pencil className="size-3.5 text-faint" /> Edit
            </MenuItem>
            {e.format === "JSON" && (
              <MenuItem onSelect={() => setConfirm("rotate")}>
                <KeyRound className="size-3.5 text-faint" /> Rotate signing secret
              </MenuItem>
            )}
            <MenuItem onSelect={() => run(() => http.patch(base, { active: !e.active }), e.active ? "Webhook disabled" : "Webhook enabled")}>
              <Power className="size-3.5 text-faint" /> {e.active ? "Disable" : "Enable"}
            </MenuItem>
            <MenuSeparator />
            <MenuItem destructive onSelect={() => setConfirm("delete")}>
              <Trash2 className="size-3.5" /> Delete
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>

      {!e.active && e.disabledReason && (
        <div className="mx-4 mb-3 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs">
          <AlertTriangle className="mt-px size-3.5 shrink-0 text-warning" />
          <span className="min-w-0 flex-1 text-muted">
            Turned off: {e.disabledReason}. Fix the receiver, send a test event, then enable it again.
          </span>
          <Button size="xs" onClick={() => run(() => http.patch(base, { active: true }), "Webhook enabled")}>
            Enable
          </Button>
        </div>
      )}

      {expanded && <DeliveryLog api={api} endpoint={e} />}

      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Delete this webhook?"
        description="Deliveries stop immediately and the delivery log is removed."
        confirmLabel="Delete webhook"
        destructive
        onConfirm={() => run(() => http.del(base), "Webhook deleted")}
      />
      <ConfirmDialog
        open={confirm === "rotate"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Rotate the signing secret?"
        description="The current secret stops working at once. Update your receiver right after."
        confirmLabel="Rotate secret"
        onConfirm={() =>
          run(async () => {
            const r = await http.post<{ secret: string }>(`${base}/rotate-secret`);
            onSecret(r.secret);
          })
        }
      />
    </div>
  );
}

function StatusIcon({ status }: { status: OutboundDeliveryItem["status"] }) {
  if (status === "SUCCESS") return <CircleCheck className="size-3.5 text-success" aria-label="Delivered" />;
  if (status === "FAILED") return <CircleX className="size-3.5 text-danger" aria-label="Failed" />;
  return <Clock className="size-3.5 text-warning" aria-label="Pending" />;
}

function DeliveryLog({ api, endpoint }: { api: string; endpoint: WebhookEndpointItem }) {
  const [filter, setFilter] = useState<"all" | "FAILED">("all");
  const [inspect, setInspect] = useState<string | null>(null);
  const base = `${api}/webhooks/${endpoint.id}`;
  const q = useInfiniteQuery({
    queryKey: [...keys.deliveries(api, endpoint.id), filter],
    queryFn: ({ pageParam }) =>
      http.get<Paginated<OutboundDeliveryItem>>(`${base}/deliveries?limit=20${filter === "FAILED" ? "&status=FAILED" : ""}${pageParam ? `&cursor=${pageParam}` : ""}`),
    initialPageParam: null as string | null,
    getNextPageParam: (l) => l.nextCursor,
    refetchInterval: (query) => (query.state.data?.pages.some((p) => p.items.some((d) => d.status === "PENDING")) ? 4_000 : false),
  });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="border-t border-border bg-bg-subtle px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-2xs font-medium uppercase tracking-wide text-faint">Recent deliveries</p>
        <Segmented size="sm" value={filter} onChange={setFilter} options={[{ value: "all", label: "All" }, { value: "FAILED", label: "Failed" }]} />
      </div>
      {q.isPending ? (
        <p className="py-4 text-center text-xs text-faint">Loading</p>
      ) : q.isError && rows.length === 0 ? (
        <LoadError title="Could not load deliveries" error={q.error} onRetry={() => q.refetch()} retrying={q.isRefetching} />
      ) : rows.length === 0 ? (
        <p className="py-4 text-center text-xs text-faint">{filter === "FAILED" ? "No failed deliveries." : "Nothing sent yet. Send a test event from the menu."}</p>
      ) : (
        <div className="overflow-hidden rounded-md border border-border bg-surface">
          <table className="w-full text-xs">
            <thead className="sr-only">
              <tr>
                <th>Status</th>
                <th>Event</th>
                <th>Response</th>
                <th>Attempts</th>
                <th>Duration</th>
                <th>Sent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((d) => (
                <tr key={d.id} onClick={() => setInspect(d.id)} className="cursor-pointer hover:bg-surface-hover">
                  <td className="w-8 py-2 pl-3">
                    <StatusIcon status={d.status} />
                  </td>
                  <td className="py-2 font-mono">
                    {/* The row is clickable for pointers; this is the keyboard and screen reader path. */}
                    <button
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setInspect(d.id);
                      }}
                      className="rounded-sm text-left hover:underline"
                      aria-label={`Inspect ${d.event} delivery`}
                    >
                      {d.event}
                    </button>
                  </td>
                  <td className="py-2 text-muted tnum">{d.responseStatus ?? (d.error ? <span className="text-danger">{d.error.slice(0, 40)}</span> : "")}</td>
                  <td className="hidden py-2 text-faint tnum sm:table-cell">{d.attempts > 1 ? `${d.attempts} attempts` : ""}</td>
                  <td className="hidden py-2 text-right text-faint tnum sm:table-cell">{d.durationMs != null ? `${d.durationMs} ms` : ""}</td>
                  <td className="py-2 pr-3 text-right text-faint">
                    {d.status === "PENDING" && d.nextAttemptAt && d.attempts > 0 ? (
                      <>
                        retry <RelativeTime iso={d.nextAttemptAt} />
                      </>
                    ) : (
                      <RelativeTime iso={d.createdAt} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {q.hasNextPage && (
        <div className="mt-2 flex justify-center">
          <Button size="xs" variant="ghost" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
            Older deliveries
          </Button>
        </div>
      )}
      <Dialog open={inspect !== null} onOpenChange={(o) => !o && setInspect(null)}>
        {inspect && <DeliveryInspector base={base} deliveryId={inspect} canRedeliver={endpoint.active} onClose={() => setInspect(null)} />}
      </Dialog>
    </div>
  );
}

function pretty(s: string | null) {
  if (!s) return "";
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

function DeliveryInspector({ base, deliveryId, canRedeliver, onClose }: { base: string; deliveryId: string; canRedeliver: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const { data: d, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ["webhook-delivery", base, deliveryId],
    queryFn: () => http.get<OutboundDeliveryDetail>(`${base}/deliveries/${deliveryId}`),
  });
  const redeliver = async () => {
    setBusy(true);
    try {
      await http.post(`${base}/deliveries/${deliveryId}/redeliver`);
      toast.success("Redelivery queued");
      await qc.invalidateQueries({ queryKey: ["webhook-deliveries"] });
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <DialogContent title={d ? d.event : "Delivery"} description={d ? <>Delivery <span className="font-mono">{d.id.slice(0, 8)}</span>, {plural(d.attempts, "attempt")}</> : undefined} wide>
      {!d && isError ? (
        <LoadError title="Could not load this delivery" error={error} onRetry={() => refetch()} retrying={isRefetching} className="py-6" />
      ) : !d ? (
        <p className="py-6 text-center text-sm text-faint">Loading</p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <span className="flex items-center gap-1.5">
              <StatusIcon status={d.status} /> {d.status === "SUCCESS" ? "Delivered" : d.status === "FAILED" ? "Failed" : "Pending"}
            </span>
            {d.responseStatus != null && <span className="tnum">HTTP {d.responseStatus}</span>}
            {d.durationMs != null && <span className="tnum">{d.durationMs} ms</span>}
            {d.error && d.responseStatus == null && <span className="text-danger">{d.error}</span>}
          </div>
          <CodeBlock label="Request body" text={pretty(d.requestBody)} />
          <CodeBlock label="Response body" text={d.responseBody ? pretty(d.responseBody) : "(empty)"} />
        </div>
      )}
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button variant="primary" onClick={redeliver} loading={busy} disabled={!d || !canRedeliver} title={canRedeliver ? undefined : "Enable the webhook first"}>
          <RotateCw className="size-3.5" /> Redeliver
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function CodeBlock({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <p className="mb-1 text-2xs font-medium uppercase tracking-wide text-faint">{label}</p>
      <pre className="max-h-64 overflow-auto rounded-md border border-border bg-bg-subtle p-3 font-mono text-2xs leading-relaxed text-muted">{text}</pre>
    </div>
  );
}

function EndpointForm({ api, endpoint, onDone }: { api: string; endpoint: WebhookEndpointItem | null; onDone: (created?: { endpoint: WebhookEndpointItem; secret: string }) => void }) {
  const [url, setUrl] = useState(endpoint?.url ?? "");
  const [format, setFormat] = useState<Format>(endpoint?.format ?? "JSON");
  const [description, setDescription] = useState(endpoint?.description ?? "");
  const [events, setEvents] = useState<string[]>(endpoint?.events ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const all = events.length === 0;

  // Paste a Slack or Discord URL and the format follows.
  const onUrl = (v: string) => {
    setUrl(v);
    setError(null);
    if (!endpoint) {
      if (/^https:\/\/hooks\.slack\.com\//.test(v)) setFormat("SLACK");
      else if (/^https:\/\/(?:\w+\.)?discord(?:app)?\.com\/api\/webhooks\//.test(v)) setFormat("DISCORD");
    }
  };

  const toggle = (c: string, on: boolean) => {
    setEvents((cur) => {
      const base = cur.length === 0 ? [...WEBHOOK_CATEGORIES] : cur;
      const next = on ? [...new Set([...base, c])] : base.filter((x) => x !== c);
      return next.length === WEBHOOK_CATEGORIES.length ? [] : next;
    });
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!all && events.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const body = { url: url.trim(), format, description: description.trim() || (endpoint ? null : undefined), events };
      if (endpoint) {
        await http.patch(`${api}/webhooks/${endpoint.id}`, body);
        toast.success("Webhook saved");
        onDone();
      } else {
        onDone(await http.post<{ endpoint: WebhookEndpointItem; secret: string }>(`${api}/webhooks`, body));
      }
    } catch (err) {
      setError(err instanceof ApiError && err.status === 422 ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent title={endpoint ? "Edit webhook" : "Add webhook"} wide>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Format" hint={FORMAT_HINT[format]}>
          {() => <div><Segmented value={format} onChange={setFormat} options={[{ value: "JSON", label: "JSON" }, { value: "SLACK", label: "Slack" }, { value: "DISCORD", label: "Discord" }]} /></div>}
        </Field>
        <Field label="Payload URL" error={error ?? undefined}>
          {(id, describedBy) => <Input id={id} aria-describedby={describedBy} value={url} onChange={(e) => onUrl(e.target.value)} placeholder="https://" autoFocus={!endpoint} spellCheck={false} autoComplete="off" required className="font-mono text-xs" />}
        </Field>
        <Field label="Description" optional>
          {(id, describedBy) => <Input id={id} aria-describedby={describedBy} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} placeholder="#eng-updates" />}
        </Field>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium">Events</p>
            <button type="button" className="text-xs text-faint hover:text-fg" onClick={() => setEvents([])} disabled={all}>
              {all ? "Sending everything" : "Select all"}
            </button>
          </div>
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
            {WEBHOOK_CATEGORIES.map((c) => {
              const on = all || events.includes(c);
              return (
                <label key={c} className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox checked={on} onChange={(v) => toggle(c, v)} label={CATEGORY_LABEL[c] ?? c} />
                  <span className={cn(!on && "text-muted")}>{CATEGORY_LABEL[c]}</span>
                </label>
              );
            })}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onDone()}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!url.trim()}>
            {endpoint ? "Save" : "Add webhook"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

const VERIFY_SNIPPET = `import { createHmac, timingSafeEqual } from "node:crypto";

// header: X-Bldt-Signature, body: the raw request body string
export function verify(secret, header, body) {
  const { t, v1 } = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = createHmac("sha256", secret).update(\`\${t}.\${body}\`).digest("hex");
  return v1?.length === expected.length && timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
}`;

function SecretReveal({ secret, rotated, onClose }: { secret: string; rotated: boolean; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <DialogContent title={rotated ? "New signing secret" : "Webhook added"} description="Copy the signing secret now. It is not shown again; you can rotate it at any time." wide>
      <div className="space-y-4">
        <div className="flex items-center gap-2 rounded-md border border-border bg-bg-subtle p-2 pl-3">
          <code className="min-w-0 flex-1 truncate font-mono text-xs">{secret}</code>
          <Button size="sm" onClick={copy}>
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <div>
          <p className="mb-1 text-sm">Verifying requests</p>
          <p className="mb-2 text-xs text-muted">
            Each request carries <span className="font-mono">X-Bldt-Signature: t=…,v1=…</span>, an HMAC-SHA256 of the timestamp and raw body. Reject anything older than five minutes. Deduplicate on the envelope <span className="font-mono">id</span>: retries and redeliveries reuse it.
          </p>
          <pre className="overflow-auto rounded-md border border-border bg-bg-subtle p-3 font-mono text-2xs leading-relaxed text-muted">{VERIFY_SNIPPET}</pre>
        </div>
      </div>
      <DialogFooter>
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
