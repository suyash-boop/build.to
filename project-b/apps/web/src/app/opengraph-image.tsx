import { ImageResponse } from "next/og";
import { LETTERS_D, MARK_LETTERS_OFFSET, MARK_RADIUS, MARK_SIZE } from "@/components/domain/brand";

export const alt = "bld.t: plan with your team, build on GitHub, keep a verified record of what shipped";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", background: "#0c0d0f", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 80 }}>
        <div style={{ display: "flex" }}>
          <svg width="96" height="96" viewBox={`0 0 ${MARK_SIZE} ${MARK_SIZE}`}>
            <rect width={MARK_SIZE} height={MARK_SIZE} rx={MARK_RADIUS} fill="#000" stroke="#2a2c31" strokeWidth="14" />
            <path transform={`translate(${MARK_LETTERS_OFFSET.x} ${MARK_LETTERS_OFFSET.y})`} fill="#fff" fillRule="evenodd" d={LETTERS_D} />
          </svg>
        </div>
        <div style={{ display: "flex", fontSize: 58, lineHeight: 1.15, fontWeight: 600, color: "#e8e9eb", maxWidth: 940 }}>
          Plan with your team, build on GitHub, and keep a verified record of what shipped.
        </div>
        <div style={{ display: "flex", fontSize: 26, color: "#9da1a9" }}>Tasks move with pull requests. Releases land on every contributor&apos;s profile.</div>
      </div>
    ),
    size,
  );
}
