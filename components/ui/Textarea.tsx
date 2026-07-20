import { cn } from "@/lib/utils";
import type { TextareaHTMLAttributes } from "react";
import { fieldClasses } from "./Input";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Textarea({ className, rows = 4, ...props }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      className={cn(fieldClasses, "resize-y", className)}
      {...props}
    />
  );
}
