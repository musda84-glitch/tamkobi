import React, { useId } from "react";

/** Compact TamKobi mark: TK monogram on an emerald→indigo tile. */
export default function TamKobiMark({ className = "w-8 h-8", title = "TamKobi" }) {
  const uid = useId().replace(/:/g, "");
  const fill = `tk-fill-${uid}`;
  const shine = `tk-shine-${uid}`;
  return (
    <svg viewBox="0 0 32 32" className={className} role="img" aria-label={title} data-testid="tamkobi-mark">
      <defs>
        <linearGradient id={fill} x1="3" y1="29" x2="29" y2="3" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#059669" />
          <stop offset="0.42" stopColor="#10b981" />
          <stop offset="1" stopColor="#4f46e5" />
        </linearGradient>
        <linearGradient id={shine} x1="16" y1="1" x2="16" y2="18" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity="0.3" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={`url(#${fill})`} />
      <rect width="32" height="32" rx="8" fill={`url(#${shine})`} />
      <path
        fill="#fff"
        d="M6.2 8.15h10.2v2.7H12.7V23.85h-2.8V10.85H6.2zm11.25 0h2.8v5.2L23.85 8.15h3.5L21.7 15.55l6 8.3h-3.55l-4.9-5.85v5.85h-2.8z"
      />
    </svg>
  );
}
