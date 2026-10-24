import Image from "next/image";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Avatar({
  user,
  size = 20,
  className,
}: {
  user: { displayName: string; username: string; avatarUrl: string | null } | null;
  size?: number;
  className?: string;
}) {
  const style = { width: size, height: size };
  if (user?.avatarUrl) {
    return (
      <Image
        src={user.avatarUrl}
        unoptimized
        alt=""
        width={size * 2}
        height={size * 2}
        style={style}
        className={cn("shrink-0 rounded-full bg-surface-2 object-cover ring-1 ring-border", className)}
      />
    );
  }
  const name = (user?.displayName || user?.username || "?").trim();
  const parts = name.split(/\s+/).filter(Boolean);
  // Two initials read as a person; one reads as a letter.
  // Two initials only where there is room for them; tiny avatars keep one.
  const initials = (size >= 24 && parts.length > 1 ? parts[0]![0]! + parts[parts.length - 1]![0]! : name.slice(0, 1)).toUpperCase();
  const hue = avatarHue(user?.username ?? name);
  return (
    <span
      style={{
        ...style,
        fontSize: Math.max(8, Math.round(size * (initials.length > 1 ? 0.38 : 0.45))),
        // Muted tint that works on both themes: the hue carries identity, not the saturation.
        background: `color-mix(in oklab, hsl(${hue} 55% 50%) 22%, var(--surface-2))`,
        color: `color-mix(in oklab, hsl(${hue} 60% 62%) 75%, var(--text))`,
      }}
      className={cn("inline-flex shrink-0 select-none items-center justify-center rounded-full font-medium tracking-tight ring-1 ring-border", className)}
      aria-hidden
    >
      {initials}
    </span>
  );
}

/** Stable hue per person, spread to avoid near-identical neighbours. */
function avatarHue(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  // Skip the purple band (260-300) to stay within the product palette rules.
  const hues = [12, 28, 42, 145, 165, 188, 205, 222, 340, 355, 95, 60];
  return hues[h % hues.length]!;
}

export function AvatarStack({ users, max = 4, size = 20 }: { users: Parameters<typeof Avatar>[0]["user"][]; max?: number; size?: number }) {
  const shown = users.slice(0, max);
  const extra = users.length - shown.length;
  // The faces carry no names, so the group is labelled as a whole for screen readers.
  const names = users.map((u) => u?.displayName || u?.username).filter(Boolean);
  const label = names.length > 6 ? `${names.slice(0, 5).join(", ")} and ${names.length - 5} more` : names.join(", ");
  return (
    <span role="img" aria-label={label || undefined} title={label || undefined} className="flex items-center -space-x-1.5">
      {shown.map((u, i) => (
        <Avatar key={u?.username ?? i} user={u} size={size} className="ring-2 ring-bg" />
      ))}
      {extra > 0 && (
        <span aria-hidden className="pl-2.5 text-xs text-muted tnum">
          +{extra}
        </span>
      )}
    </span>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-sm border border-border bg-surface-2 px-1 font-mono text-[10.5px] font-medium text-muted",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export function Badge({ children, className, tone = "neutral" }: { children: ReactNode; className?: string; tone?: "neutral" | "accent" | "success" | "warning" | "danger" }) {
  const tones = {
    neutral: "border-border text-muted",
    accent: "border-accent/40 text-accent",
    success: "border-success/30 text-success",
    warning: "border-warning/30 text-warning",
    danger: "border-danger/40 text-danger",
  };
  return (
    <span className={cn("inline-flex h-[22px] items-center gap-1 rounded-md border px-2 text-2xs font-medium", tones[tone], className)}>
      {children}
    </span>
  );
}

/** Soft shimmer, slow enough to read as "loading" rather than flicker. */
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      style={style}
      className={cn(
        "rounded-md bg-[linear-gradient(90deg,var(--surface-2)_25%,var(--surface-hover)_50%,var(--surface-2)_75%)] bg-[length:200%_100%] animate-[shimmer_1.6s_linear_infinite] motion-reduce:animate-none",
        className,
      )}
      aria-hidden
    />
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-lg border border-border px-6 py-14 text-center", className)}>
      {icon && <div className="mb-4 flex size-10 items-center justify-center rounded-lg border border-border text-muted">{icon}</div>}
      <p className="text-[15px] font-semibold text-fg">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function SectionHeader({ title, action, count }: { title: string; action?: ReactNode; count?: number }) {
  return (
    <div className="mb-3 flex min-h-7 items-center justify-between gap-2">
      <h2 className="flex items-baseline gap-2 text-[15px] font-semibold tracking-tight text-fg">
        {title}
        {count !== undefined && <span className="tnum text-sm font-normal text-faint">{count}</span>}
      </h2>
      {action}
    </div>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-lg border border-border bg-surface", className)}>{children}</div>;
}
