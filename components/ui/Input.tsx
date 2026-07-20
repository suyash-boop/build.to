import { cn } from "@/lib/utils";
import type { InputHTMLAttributes } from "react";

export const fieldClasses =
  "w-full rounded border border-border bg-body-bg px-3 py-2 text-base text-body placeholder:text-secondary " +
  "focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-brand " +
  "disabled:cursor-not-allowed disabled:opacity-60";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, type = "text", ...props }: InputProps) {
  return (
    <input type={type} className={cn(fieldClasses, className)} {...props} />
  );
}
