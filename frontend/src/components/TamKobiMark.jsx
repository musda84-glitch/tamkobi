/** Official TamKobi 4-quadrant mark (brand guide). */
import React, { useId } from "react";

const MAVI = "#2d7bff";
const MOR = "#7b3ff2";
const MOR_DARK = "#4f2fd0";
const VURGU = "#c6f432";
const GECE = "#0b0b14";

/**
 * @param {{ className?: string, title?: string, variant?: "mark" | "app" }} props
 * variant "app" = gece rounded tile (sidebar / launcher)
 * variant "mark" = circle only on transparent
 */
export default function TamKobiMark({ className = "w-8 h-8", title = "TamKobi", variant = "app" }) {
  const uid = useId().replace(/:/g, "");
  const clip = `tk-clip-${uid}`;
  const r = 10.8;
  const gap = 1.15;
  const c = 16;

  return (
    <svg viewBox="0 0 32 32" className={className} role="img" aria-label={title} data-testid="tamkobi-mark">
      <defs>
        <clipPath id={clip}>
          <circle cx={c} cy={c} r={r} />
        </clipPath>
      </defs>
      {variant === "app" ? <rect width="32" height="32" rx="8" fill={GECE} /> : null}
      <g clipPath={`url(#${clip})`}>
        <rect x={c - r} y={c - r} width={r - gap / 2} height={r - gap / 2} fill={MAVI} />
        <rect x={c + gap / 2} y={c - r} width={r - gap / 2} height={r - gap / 2} fill={MOR} />
        <rect x={c - r} y={c + gap / 2} width={r - gap / 2} height={r - gap / 2} fill={MOR_DARK} />
        <rect x={c + gap / 2} y={c + gap / 2} width={r - gap / 2} height={r - gap / 2} fill={VURGU} />
      </g>
    </svg>
  );
}
