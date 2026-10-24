import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const field =
  "w-full rounded-md border border-border bg-surface text-fg placeholder:text-faint transition-colors " +
  "hover:border-border-strong focus:border-border-strong focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus " +
  "disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger";

export const Input = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, "prefix"> & { leading?: ReactNode }>(
  function Input({ className, leading, ...props }, ref) {
    if (leading) {
      return (
        <div className={cn(field, "flex h-8 items-center gap-0 pl-2.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus", className)}>
          <span className="shrink-0 select-none text-sm text-faint">{leading}</span>
          <input ref={ref} className="h-full min-w-0 flex-1 bg-transparent pr-2.5 text-sm outline-none placeholder:text-faint" {...props} />
        </div>
      );
    }
    return <input ref={ref} className={cn(field, "h-8 px-2.5 text-sm", className)} {...props} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return <textarea ref={ref} className={cn(field, "min-h-20 px-2.5 py-2 text-sm leading-relaxed", className)} {...props} />;
});

/** Label, control, hint and error in a consistent vertical rhythm. */
export function Field({
  label,
  hint,
  error,
  children,
  className,
  optional,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: (id: string, describedBy: string | undefined) => ReactNode;
  className?: string;
  optional?: boolean;
}) {
  const id = useId();
  const hintId = hint || error ? `${id}-desc` : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-fg">
        {label}
        {optional && <span className="ml-1.5 font-normal text-faint">Optional</span>}
      </label>
      {children(id, hintId)}
      {error ? (
        <p id={hintId} className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
