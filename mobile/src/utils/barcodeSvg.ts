import { barcodeFormatFor } from "./barcodeFormat";
import { code128Svg } from "./code128";
import { ean13Svg } from "./ean13";

/** Same mm→px ratio as web LabelDesigner (LabelCanvas). */
export const LABEL_PX_PER_MM = 3.78;

export type LabelBarcodeEl = {
  w?: number;
  h?: number;
  showText?: boolean;
};

/**
 * Barcode SVG sized like web LabelCanvas / JsBarcode:
 * height ≈ el.h×px − text gutter, module width clamped by el.w.
 * Valid EAN-13 → EAN13; otherwise CODE128.
 */
export function barcodeSvgForLabel(value: unknown, el: LabelBarcodeEl = {}): string {
  const code = String(value ?? "").trim();
  if (!code) return "";
  const showText = el.showText !== false;
  const wMm = Number(el.w) || 40;
  const hMm = Number(el.h) || 14;
  const height = Math.max(10, hMm * LABEL_PX_PER_MM - (showText ? 14 : 2));
  const moduleWidth = Math.max(0.8, Math.min(3, (wMm * LABEL_PX_PER_MM) / 110));
  const fontSize = showText ? 10 : 0;
  const opts = {
    height,
    moduleWidth,
    margin: 8,
    displayValue: showText,
    fontSize,
  };
  if (barcodeFormatFor(code) === "EAN13") {
    return ean13Svg(code, opts);
  }
  return code128Svg(code, opts);
}
