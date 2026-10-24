import type { Metadata } from "next";
import { MobileTitle, PageBody, PageHeader } from "@/components/shell/page";
import { api, requireMe, ServerApiError } from "@/lib/api.server";
import { DeviceApproval, type DeviceRequest } from "./device-approval";

export const metadata: Metadata = { title: "Connect a device", robots: { index: false } };

export default async function DevicePage({ searchParams }: PageProps<"/device">) {
  const { code } = await searchParams;
  const raw = typeof code === "string" ? code : "";
  const me = await requireMe(`/device${raw ? `?code=${encodeURIComponent(raw)}` : ""}`);

  let request: DeviceRequest | null = null;
  let error: string | null = null;
  if (raw) {
    try {
      request = await api<DeviceRequest>(`/auth/device/${encodeURIComponent(raw)}`);
    } catch (err) {
      if (err instanceof ServerApiError && err.status === 404) error = err.message;
      else throw err;
    }
  }

  return (
    <>
      <PageHeader title="Connect a device" />
      <MobileTitle>Connect a device</MobileTitle>
      <PageBody width="narrow">
        <DeviceApproval initialCode={raw} request={request} error={error} username={me.username} />
      </PageBody>
    </>
  );
}
