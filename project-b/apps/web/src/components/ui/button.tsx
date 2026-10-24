import { Slot } from "radix-ui";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { Spinner } from "./spinner";

const VARIANT = {
  primary: "bg-primary text-primary-fg hover:bg-primary-hover border border-transparent",
  secondary: "bg-surface text-fg border border-border hover:bg-surface-hover hover:border-border-strong",
  ghost: "text-muted hover:text-fg hover:bg-surface-hover border border-transparent",
  danger: "bg-danger text-white border border-transparent hover:opacity-90",
  "danger-ghost": "text-danger hover:bg-danger-soft border border-transparent",
} as const;

const SIZE = {
  xs: "h-7 px-2.5 text-xs gap-1",
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
  lg: "h-10 px-4 text-base gap-2",
  icon: "h-7 w-7 justify-center",
  "icon-sm": "h-6 w-6 justify-center",
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANT;
  size?: keyof typeof SIZE;
  loading?: boolean;
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, asChild, className, children, disabled, type, ...props },
  ref,
) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : (type ?? "button")}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "transition-ui inline-flex shrink-0 select-none items-center whitespace-nowrap rounded-md font-medium active:scale-[0.97]",
        "disabled:pointer-events-none disabled:opacity-50",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading && <Spinner className="size-3.5" />}
          {children}
        </>
      )}
    </Comp>
  );
});
