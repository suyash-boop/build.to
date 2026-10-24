"use client";

import { useEffect, useRef } from "react";

type Handler = (e: KeyboardEvent) => void;

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.closest("[role=dialog] input") != null;
};

/**
 * Keyboard shortcuts. Keys: "mod+k" (Cmd on macOS, Ctrl elsewhere), single keys ("c", "?"),
 * and two-key sequences ("g h"). Single-key shortcuts never fire while typing.
 */
export function useHotkeys(bindings: Record<string, Handler>, enabled = true) {
  const ref = useRef(bindings);
  ref.current = bindings;

  useEffect(() => {
    if (!enabled) return;
    let pending: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const key = e.key.toLowerCase();
      const mod = e.metaKey || e.ctrlKey;

      if (mod) {
        const h = ref.current[`mod+${key}`];
        if (h) {
          e.preventDefault();
          h(e);
        }
        return;
      }
      if (e.altKey || isTyping(e.target)) return;

      if (pending) {
        const h = ref.current[`${pending} ${key}`];
        pending = null;
        clearTimeout(timer);
        if (h) {
          e.preventDefault();
          h(e);
          return;
        }
      }
      if (Object.keys(ref.current).some((k) => k.startsWith(`${key} `))) {
        pending = key;
        timer = setTimeout(() => (pending = null), 900);
        return;
      }
      const h = ref.current[e.key === "?" ? "?" : key];
      if (h) {
        e.preventDefault();
        h(e);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(timer);
    };
  }, [enabled]);
}

export const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
