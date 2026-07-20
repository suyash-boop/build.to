import { cn } from "@/lib/utils";

type Size = "s" | "m" | "l" | "xl";

// Four sizes, circular (PRD §8.7).
const sizes: Record<Size, string> = {
  s: "size-6 text-s",
  m: "size-8 text-s",
  l: "size-12 text-base",
  xl: "size-20 text-xl",
};

export interface AvatarProps {
  src?: string | null;
  name: string;
  size?: Size;
  className?: string;
}

export function Avatar({ src, name, size = "m", className }: AvatarProps) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-base-bg font-medium text-secondary",
        sizes[size],
        className,
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- avatars are arbitrary external URLs (PRD stores URLs, not uploads); next/image remote config is out of scope for Phase 1
        <img src={src} alt={name} className="size-full object-cover" />
      ) : (
        initial
      )}
    </span>
  );
}
