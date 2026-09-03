import React from "react";

// Simple SVG Barcode Generator (Code128 / EAN simulation)
export const BarcodeRenderer = ({ code = "8680001234011", width = 200, height = 50, showText = true }) => {
  // Generate deterministic bar widths based on code characters
  const bars = [];
  let totalWidth = 0;
  
  for (let i = 0; i < code.length; i++) {
    const charCode = code.charCodeAt(i);
    const pattern = [(charCode % 3) + 1, ((charCode * 3) % 4) + 1, ((charCode * 7) % 3) + 1, ((charCode * 5) % 2) + 1];
    pattern.forEach((w, idx) => {
      bars.push({
        isBlack: idx % 2 === 0,
        w: Math.max(1.5, w * 1.2),
        x: totalWidth
      });
      totalWidth += Math.max(1.5, w * 1.2);
    });
  }

  const scale = width / Math.max(totalWidth, 1);

  return (
    <div className="flex flex-col items-center bg-white p-2 rounded border border-slate-200">
      <svg width={width} height={height} viewBox={`0 0 ${totalWidth} ${height}`} className="overflow-hidden">
        {bars.map((bar, i) =>
          bar.isBlack ? (
            <rect key={i} x={bar.x} y={0} width={bar.w} height={height} fill="#0f172a" />
          ) : null
        )}
      </svg>
      {showText && (
        <span className="font-mono text-xs text-slate-700 tracking-widest font-semibold mt-1">
          {code}
        </span>
      )}
    </div>
  );
};
