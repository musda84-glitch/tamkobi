import React, { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";
import { barcodeFormatFor } from "../utils/barcodeFormat";

/**
 * Real scannable barcode (JsBarcode EAN-13 / CODE128).
 * Previous implementation drew decorative bars that cameras/scanners cannot decode.
 */
export const BarcodeRenderer = ({
  code = "8680001234011",
  width = 200,
  height = 50,
  showText = true,
  compact = false,
}) => {
  const ref = useRef(null);
  const value = String(code || "").trim();

  useEffect(() => {
    const svg = ref.current;
    if (!svg || !value) return;
    try {
      const format = barcodeFormatFor(value);
      const barHeight = Math.max(28, showText ? height - 16 : height);
      // Module width ~ fit target width with quiet zones; clamp for scanners
      const moduleWidth = Math.min(2.4, Math.max(1.4, width / (value.length * 11)));
      JsBarcode(svg, value, {
        format,
        height: barHeight,
        width: moduleWidth,
        margin: 12, // quiet zone — required for handheld / camera readers
        displayValue: !!showText,
        fontSize: compact ? 10 : 12,
        textMargin: showText ? 2 : 0,
        font: "monospace",
        background: "#ffffff",
        lineColor: "#0f172a",
        flat: true,
      });
      svg.style.width = `${width}px`;
      svg.style.height = "auto";
      svg.style.maxWidth = "100%";
      svg.style.display = "block";
      svg.removeAttribute("height"); // let aspect ratio follow viewBox after width set
    } catch {
      // Invalid payload for chosen format — leave empty SVG
      while (svg.firstChild) svg.removeChild(svg.firstChild);
    }
  }, [value, width, height, showText, compact]);

  if (!value) return null;

  return (
    <div
      className={
        compact
          ? "inline-flex flex-col items-center gap-0.5 shrink-0 leading-none bg-white"
          : "flex flex-col items-center bg-white p-2 rounded border border-slate-200"
      }
      data-testid="barcode-renderer"
    >
      <svg ref={ref} className="overflow-visible shrink-0 block bg-white" role="img" aria-label={`Barkod ${value}`} />
      {/* When showText is false, parent may render digits separately (print tables). */}
    </div>
  );
};

export default BarcodeRenderer;
