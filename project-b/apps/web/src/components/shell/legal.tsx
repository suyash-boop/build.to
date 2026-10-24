import { format, parseISO } from "date-fns";
import Link from "next/link";
import type { ReactNode } from "react";
import { PublicHeader, SiteFooter } from "./public-header";

export function LegalPage({ title, effective, children }: { title: string; effective: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-12">
        <p className="text-xs text-faint">
          <Link href="/privacy" className="hover:text-fg">Privacy</Link> · <Link href="/terms" className="hover:text-fg">Terms</Link>
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted">Effective {format(parseISO(effective), "MMMM d, yyyy")}</p>
        <div className="legal mt-8 space-y-8 text-[14px] leading-7 text-muted">{children}</div>
      </main>
      <SiteFooter />
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-base font-semibold text-fg">{title}</h2>
      <div className="space-y-3 [&_li]:ml-5 [&_li]:list-disc [&_strong]:font-medium [&_strong]:text-fg">{children}</div>
    </section>
  );
}
