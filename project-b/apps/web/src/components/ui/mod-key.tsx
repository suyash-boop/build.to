"use client";

import { useEffect, useState } from "react";
import { isMac } from "@/lib/hotkeys";
import { Kbd } from "./misc";

/** Shows ⌘K on macOS and Ctrl K elsewhere. Renders Ctrl on the server, corrects after mount. */
export function ModKey({ k, className }: { k: string; className?: string }) {
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(isMac()), []);
  return <Kbd className={className}>{mac ? `⌘${k}` : `Ctrl ${k}`}</Kbd>;
}
