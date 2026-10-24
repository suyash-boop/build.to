"use client";

import type { SignedWorkRecord } from "@bldt/contracts";
import { Check, Copy, Download, Terminal } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

const SNIPPET = `// node verify.mjs record.json
import { createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";

const { record, signature } = JSON.parse(readFileSync(process.argv[2], "utf8"));
const jwks = await (await fetch("ORIGIN/projects/.well-known/bldt-keys.json")).json();
const jwk = jwks.keys.find((k) => k.kid === signature.kid);
const canonical = (v) =>
  Array.isArray(v) ? \`[\${v.map(canonical).join(",")}]\`
  : v && typeof v === "object"
    ? \`{\${Object.keys(v).sort().map((k) => \`\${JSON.stringify(k)}:\${canonical(v[k])}\`).join(",")}}\`
    : JSON.stringify(v);
const ok = verify(null, Buffer.from(canonical(record)), createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(signature.value, "base64url"));
console.log(ok ? "Valid signature" : "INVALID");`;

export function RecordActions({ id, signed }: { id: string; signed: SignedWorkRecord }) {
  const [copied, setCopied] = useState(false);
  const [showCode, setShowCode] = useState(false);

  const download = () => {
    const blob = new Blob([JSON.stringify(signed, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `bldt-work-record-${id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const copy = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={download}>
          <Download className="size-3.5" /> Download signed JSON
        </Button>
        <Button size="sm" variant="ghost" onClick={copy}>
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? "Copied" : "Copy link"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setShowCode((v) => !v)} aria-expanded={showCode}>
          <Terminal className="size-3.5" /> {showCode ? "Hide" : "Show"} a verification script
        </Button>
      </div>
      {showCode && (
        <pre className="mt-3 overflow-auto rounded-md border border-border bg-bg-subtle p-3 font-mono text-2xs leading-relaxed text-muted">
          {SNIPPET.replace("ORIGIN", typeof window === "undefined" ? "" : window.location.origin)}
        </pre>
      )}
    </div>
  );
}
