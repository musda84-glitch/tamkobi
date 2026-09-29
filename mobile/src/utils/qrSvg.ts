import QRCode from "qrcode";

/** Barkod/SKU için kare QR SVG (etiket şablonu type=qr). */
export function qrSvg(value: string, size = 96): string {
  const code = String(value || "").trim();
  if (!code) {
    return `<div style="font-size:6pt;color:#be123c;font-weight:700">QR yok</div>`;
  }
  try {
    const qr = QRCode.create(code, { errorCorrectionLevel: "M" });
    const modules = qr.modules;
    const n = modules.size;
    const parts: string[] = [];
    for (let row = 0; row < n; row += 1) {
      for (let col = 0; col < n; col += 1) {
        if (modules.get(row, col)) parts.push(`M${col} ${row}h1v1h-1z`);
      }
    }
    const px = Math.max(24, Math.round(size));
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" style="width:100%;height:100%;display:block"><rect width="${n}" height="${n}" fill="#fff"/><path fill="#000" d="${parts.join("")}"/></svg>`;
  } catch {
    return `<div style="font-size:6pt;color:#be123c;font-weight:700">QR hata</div>`;
  }
}
