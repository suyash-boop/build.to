/* eslint-disable @next/next/no-html-link-for-pages -- /projects is a separate Next.js zone; hard navigation is required. */
import Link from "next/link";

const links = [
  { href: "/", label: "Home", icon: "🏠" },
  { href: "/search", label: "Search", icon: "🔍" },
  { href: "/notifications", label: "Notifications", icon: "🔔" },
];

/** Feed left rail (desktop only) — primary navigation, dev.to style. */
export function LeftRail() {
  return (
    <nav className="sticky top-20 flex flex-col gap-1 text-base">
      <a href="/projects/home" className="mb-2 rounded-large border border-border bg-body-bg p-3 transition-colors hover:border-brand">
        <span className="block font-semibold text-brand">Build together ↗</span>
        <span className="mt-1 block text-s text-secondary">Projects, tasks, and the people you build with.</span>
      </a>
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className="flex items-center gap-3 rounded-large px-3 py-2 text-body transition-colors hover:bg-body-bg"
        >
          <span aria-hidden>{l.icon}</span>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
