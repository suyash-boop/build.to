import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "outline" | "ghost";
type Size = "s" | "m" | "l";

const variants: Record<Variant, string> = {
  primary:
    "bg-brand text-white border border-transparent hover:bg-brand-hover",
  secondary:
    "bg-body-bg text-body border border-border hover:bg-base-bg",
  outline:
    "bg-transparent text-body border border-border hover:bg-base-bg",
  ghost:
    "bg-transparent text-body border border-transparent hover:bg-base-bg",
};

const sizes: Record<Size, string> = {
  s: "h-8 px-3 text-s",
  m: "h-10 px-4 text-base",
  l: "h-12 px-5 text-l",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({
  variant = "primary",
  size = "m",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
        "disabled:pointer-events-none disabled:opacity-60",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
