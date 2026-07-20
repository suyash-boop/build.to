import { cn } from "@/lib/utils";
import type { SelectHTMLAttributes } from "react";
import { fieldClasses } from "./Input";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export function Select({ className, children, ...props }: SelectProps) {
  return (
    <select className={cn(fieldClasses, "cursor-pointer", className)} {...props}>
      {children}
    </select>
  );
}
