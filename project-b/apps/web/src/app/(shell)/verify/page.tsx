import type { Metadata } from "next";
import { MobileTitle, PageBody, PageHeader } from "@/components/shell/page";
import { VerifyForm } from "./verify-form";

export const metadata: Metadata = {
  title: "Verify a work record",
  description: "Check that a bld.t work record is genuine, unedited, and not revoked.",
};

export default function VerifyPage() {
  return (
    <>
      <PageHeader title="Verify a work record" />
      <MobileTitle>Verify</MobileTitle>
      <PageBody width="medium">
        <div className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight">Verify a work record</h1>
          <p className="mt-1 max-w-prose text-sm text-muted">
            Paste the signed JSON someone gave you, or drop the file. The signature is checked against bld.t&apos;s published keys, and the
            registry is checked for revocation. Nothing you paste is stored.
          </p>
        </div>
        <VerifyForm />
      </PageBody>
    </>
  );
}
