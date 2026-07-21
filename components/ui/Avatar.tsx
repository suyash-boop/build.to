import { cn } from "@/lib/utils";

type Size = "s" | "m" | "l" | "xl";

// Four sizes, circular (PRD §8.7).
const sizes: Record<Size, string> = {
  s: "size-6 text-s",
  m: "size-8 text-s",
  l: "size-12 text-base",
  xl: "size-20 text-2xl",
};

// A small palette so name-based fallbacks look intentional, not like a grey
// blob. The same name always lands on the same colour.
const fallbackColors = [
  "#4f46e5",
  "#0e7490",
  "#059669",
  "#b45309",
  "#be185d",
  "#7c3aed",
];

function colorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return fallbackColors[Math.abs(hash) % fallbackColors.length];
}

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
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white",
        sizes[size],
        className,
      )}
      style={src ? undefined : { backgroundColor: colorForName(name) }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- avatars are arbitrary external URLs (PRD stores URLs, not uploads)
        <img
          src={src}
          alt={name}
          // Google (lh3.googleusercontent.com) rejects requests that send a
          // referrer, which is why OAuth avatars showed the fallback.
          referrerPolicy="no-referrer"
          className="size-full object-cover"
        />
      ) : (
        initial
      )}
    </span>
  );
}
