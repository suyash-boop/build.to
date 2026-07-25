import { Card } from "@/components/ui";

/** A titled sidebar card holding one profile field (dev.to's left-rail style). */
export function SidebarCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-4">
      <h2 className="text-s font-bold uppercase tracking-wide text-secondary">
        {title}
      </h2>
      <div className="mt-2 text-s text-body">{children}</div>
    </Card>
  );
}
