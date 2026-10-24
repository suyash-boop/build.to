import { ImageResponse } from "next/og";
import { LETTERS_D, MARK_LETTERS_OFFSET, MARK_SIZE } from "@/components/domain/brand";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** iOS rounds the corners itself, so the square is drawn edge to edge. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", background: "#000", display: "flex" }}>
        <svg width="180" height="180" viewBox={`0 0 ${MARK_SIZE} ${MARK_SIZE}`}>
          <path transform={`translate(${MARK_LETTERS_OFFSET.x} ${MARK_LETTERS_OFFSET.y})`} fill="#fff" fillRule="evenodd" d={LETTERS_D} />
        </svg>
      </div>
    ),
    size,
  );
}
