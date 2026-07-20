import { cn } from "@/lib/utils";
import Link from "next/link";

/**
 * Tag chip — renders as `#tagname` (PRD §5.8). `color` is the tag's bgColorHex,
 * used as a subtle accent (left border + hover tint) rather than a solid fill,
 * matching the dev.to chip look.
 */
export interface TagProps {
  name: string;
  color?: string;
  href?: string;
  className?: string;
}

export function Tag({ name, color, href, className }: TagProps) {
  const style = color ? { borderColor: color } : undefined;
  const classes = cn(
    "inline-flex items-center rounded border border-border bg-body-bg px-2 py-1 text-s text-body transition-colors hover:bg-base-bg",
    className,
  );
  const content = (
    <>
      <span className="text-secondary">#</span>
      {name}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={classes} style={style}>
        {content}
      </Link>
    );
  }
  return (
    <span className={classes} style={style}>
      {content}
    </span>
  );
}
