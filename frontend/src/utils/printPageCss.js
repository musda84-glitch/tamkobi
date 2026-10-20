/** Shared print CSS for sipariş formu, teklif, irsaliye, fatura and tahsilat makbuzu.
 * A viewport-tall shell (100vh) or a fixed A4 min-height, plus @page margin, spills
 * one phantom page. visibility:hidden boxes still occupy flow unless removed.
 */

import { RECEIPT_HALF_MM } from "./receiptLayout";

export const A4_HEIGHT_MM = 297;
export const PRINT_PAGE_MARGIN_MM = 10;
export const PRINT_CONTENT_PAD_MM = 8;
/** A5 yatay yaprak. A4 yarısı 148,5mm; iç boşluk aynı, yükseklik kâğıda göre. */
export const RECEIPT_A5_HEIGHT_MM = 148;

export const PRINT_DOC_TYPES = ["invoice", "order", "quote", "dispatch", "receipt"];

export function printVerticalChromeMm(marginMm = PRINT_PAGE_MARGIN_MM, padMm = PRINT_CONTENT_PAD_MM) {
  return (Number(marginMm) + Number(padMm)) * 2;
}

export function printChromeFitsA4(marginMm = PRINT_PAGE_MARGIN_MM, padMm = PRINT_CONTENT_PAD_MM) {
  return printVerticalChromeMm(marginMm, padMm) < A4_HEIGHT_MM;
}

function paperSize(paper, kind) {
  const name = paper === "A5" ? "A5" : "A4";
  if (kind !== "receipt") return name;
  return name === "A5" ? "A5 landscape" : "A4 portrait";
}

function safeDocType(docType) {
  const raw = String(docType || "order");
  return /^[a-z0-9_-]+$/i.test(raw) ? raw : "order";
}

export function printPageCss(docType = "order", paper = "A4") {
  const kind = safeDocType(docType);
  const receipt = kind === "receipt";
  const a5 = paper === "A5";
  const size = paperSize(paper, kind);
  const margin = receipt ? 0 : PRINT_PAGE_MARGIN_MM;
  const pad = receipt ? 0 : PRINT_CONTENT_PAD_MM;
  const pageMargin = receipt ? "0" : `${margin}mm`;
  const base = `
@page { size: ${size}; margin: ${pageMargin}; }
@media print {
  :root {
    --print-page-margin: ${margin}mm;
    --print-content-pad: ${pad}mm;
  }
  html, body {
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
    margin: 0 !important;
    padding: 0 !important;
    background: #fff !important;
  }
  html, body, #root, .min-h-screen, .h-screen, .fixed, #print-area, .print-sheet,
  #print-area[data-doc-type="${kind}"] {
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
  }
  .fixed {
    position: static !important;
    inset: auto !important;
    overflow: visible !important;
    margin: 0 !important;
    padding: 0 !important;
    background: transparent !important;
    box-shadow: none !important;
  }
  body * { visibility: hidden; }
  #print-area, #print-area * { visibility: visible !important; }
  /* visibility:hidden still reserves layout. Drop every box that is not the
     sheet and not an ancestor of it, so a hidden shell cannot mint a blank page. */
  body :not(:has(#print-area)):not(#print-area):not(#print-area *) {
    display: none !important;
    height: 0 !important;
    min-height: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    overflow: hidden !important;
  }
  #print-area {
    position: static !important;
    left: auto !important;
    top: auto !important;
    width: 100% !important;
    height: auto !important;
    min-height: 0 !important;
    margin: 0 !important;
    padding: ${pad}mm !important;
    box-sizing: border-box !important;
    break-after: auto !important;
    page-break-after: auto !important;
    overflow: visible !important;
  }
  :last-child { break-after: auto; page-break-after: auto; }
  #print-area > :last-child,
  #print-area :last-child {
    break-after: auto !important;
    page-break-after: auto !important;
    margin-bottom: 0 !important;
  }
  #print-area .print-sheet-pad {
    padding: 0 !important;
  }
  #print-area .print-footer:empty,
  .print-footer:empty {
    display: none !important;
    height: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
  }
  .no-print { display: none !important; }
}
`.trim();
  if (!receipt) return base;
  return `${base}\n${receiptCopyCss(a5)}`.trim();
}

function both(selector, body) {
  const parts = String(selector).split(",").map((part) => part.trim()).filter(Boolean);
  const selectors = parts.flatMap((part) => [`#print-area ${part}`, `.receipt-measure ${part}`]);
  return `${selectors.join(",\n")} {\n${body}\n}`;
}

/** İki nüsha tek A4 yaprağa sığsın; diğer belge türlerine yazılmaz. */
function receiptCopyCss(a5) {
  const half = `${RECEIPT_HALF_MM}mm`;
  const safePad = `${PRINT_CONTENT_PAD_MM}mm`;
  const a5Sheet = `${RECEIPT_A5_HEIGHT_MM}mm`;
  /* Sabit height + overflow:hidden, Chrome "Varsayılan" kenar boşluğunda
     üst başlığı kırpıyordu. Yarım ölçü flex/max-height olarak kalır; içerik
     border-box içinde ≥8mm boşlukla durur ve taşan satır gizlenmez. */
  const a4Sheets = a5 ? `
  #print-area .receipt-page-single .receipt-half,
  #print-area .receipt-page[data-copy-count="1"] .receipt-half {
    box-sizing: border-box;
    width: 210mm;
    max-width: 210mm;
    min-height: ${a5Sheet};
    height: auto;
    max-height: none;
    margin: 0;
    overflow: visible;
    padding: ${safePad};
    display: flex !important;
    flex-direction: column;
  }
  #print-area .receipt-page-single .receipt-card,
  #print-area .receipt-page[data-copy-count="1"] .receipt-card {
    box-sizing: border-box;
    min-height: calc(${a5Sheet} - ${safePad} - ${safePad});
  }` : `
  #print-area .receipt-page[data-copy-count="2"] {
    position: relative;
    display: flex !important;
    flex-direction: column;
    width: 210mm;
    box-sizing: border-box;
  }
  #print-area .receipt-page-pair .receipt-half,
  #print-area .receipt-page[data-copy-count="2"] .receipt-half {
    box-sizing: border-box;
    width: 210mm;
    max-width: 210mm;
    flex: 0 0 ${half};
    max-height: ${half};
    height: auto;
    min-height: 0;
    margin: 0;
    overflow: visible;
    padding: ${safePad};
    display: flex !important;
    flex-direction: column;
  }
  #print-area .receipt-page-pair .receipt-card,
  #print-area .receipt-page[data-copy-count="2"] .receipt-card {
    box-sizing: border-box;
    min-height: calc(${half} - ${safePad} - ${safePad});
  }
  #print-area .receipt-page[data-copy-count="2"] .receipt-cut {
    position: absolute;
    left: 8mm;
    right: 8mm;
    top: ${half};
    transform: translateY(-50%);
    margin: 0;
    padding: 0 2mm;
    height: auto;
    border-top: 1px dashed #111;
    line-height: 1;
    z-index: 5;
    pointer-events: none;
    background: #fff;
  }
  #print-area .receipt-page-single .receipt-half,
  #print-area .receipt-page[data-copy-count="1"] .receipt-half {
    box-sizing: border-box;
    width: 210mm;
    max-width: 210mm;
    height: auto;
    max-height: none;
    margin: 0;
    overflow: visible;
    padding: ${safePad};
    display: flex !important;
    flex-direction: column;
  }
  #print-area .receipt-page[data-copy-count="1"] {
    break-inside: avoid;
    page-break-inside: avoid;
  }`;
  return `
.receipt-print-only { display: none; }
${both(".receipt-cheque-table", `  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;`)}
${both(".receipt-col-no, .receipt-col-amount", `  white-space: nowrap;`)}
${both(".receipt-address, .receipt-col-drawer, .receipt-col-due, .receipt-col-account, .receipt-company-meta, .receipt-party-meta, .receipt-cheque-table th", `  white-space: normal;
  overflow: visible;
  overflow-wrap: break-word;
  word-break: normal;`)}
.receipt-measure,
.receipt-measure .text-sm,
.receipt-measure .text-base,
.receipt-measure .text-xs {
  font-size: 9pt !important;
  line-height: 1.25 !important;
}
.receipt-measure {
  width: 210mm;
  box-sizing: border-box !important;
  padding: ${safePad} !important;
}
.receipt-measure .receipt-title {
  font-size: 11pt !important;
  line-height: 1.15 !important;
}
@media print {
  #print-area[data-doc-type="receipt"] {
    font-size: 9pt !important;
    line-height: 1.25 !important;
    padding: 0 !important;
    width: 210mm !important;
    max-width: 210mm !important;
  }
  /* Ekran modalı (max-w-xl) baskıda yaprağı ortalayıp sağ kenarı kırpıyordu. */
  .fixed:has(#print-area[data-doc-type="receipt"]),
  .fixed:has(#print-area[data-doc-type="receipt"]) > * {
    display: block !important;
    width: auto !important;
    max-width: none !important;
    margin: 0 !important;
    padding: 0 !important;
  }
  #print-area .receipt-print-only { display: block !important; }
  #print-area .receipt-page:not(:last-child) {
    break-after: page;
    page-break-after: always;
  }
  #print-area .receipt-row,
  #print-area .receipt-cheque-table tr {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  #print-area .receipt-cut {
    border-top: 1px dashed #111;
    text-align: center;
    font-size: 8px;
    letter-spacing: 0.08em;
    margin: 0;
    padding: 0;
    line-height: 1;
    background: #fff;
  }
  #print-area .receipt-logo {
    height: 11mm !important;
    max-height: 11mm !important;
    width: auto;
    object-fit: contain;
  }
  #print-area .receipt-card {
    padding: 1.5mm 2mm !important;
  }
  #print-area .receipt-card > * + * {
    margin-top: 1.2mm !important;
  }
  #print-area .receipt-head {
    padding-bottom: 1mm !important;
    gap: 2mm !important;
    overflow: visible;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  #print-area .receipt-half .receipt-card {
    box-sizing: border-box;
    flex: 1 1 auto;
    min-height: 100%;
    overflow: visible;
  }
  #print-area .receipt-party {
    gap: 2mm !important;
  }
  #print-area .receipt-signs {
    gap: 4mm !important;
    padding-top: 1mm !important;
  }
  #print-area .receipt-sign {
    height: 5mm !important;
  }
  #print-area .receipt-company-name,
  #print-area .receipt-title {
    line-height: 1.15 !important;
  }
  #print-area .receipt-title {
    font-size: 11pt !important;
  }
  #print-area .receipt-total {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    padding-top: 0.8mm !important;
    padding-bottom: 0.8mm !important;
  }
  #print-area .receipt-cheque-table,
  #print-area .receipt-cheque-table th,
  #print-area .receipt-cheque-table td {
    font-size: 9pt;
    padding: 0.6mm 1mm;
    word-break: normal;
    overflow-wrap: break-word;
    white-space: normal;
  }
  #print-area .receipt-density-compact {
    font-size: 8.5pt !important;
  }
  #print-area .receipt-density-compact .receipt-card > * + * {
    margin-top: 1mm !important;
  }
  #print-area .receipt-density-compact .receipt-cheque-table,
  #print-area .receipt-density-compact .receipt-cheque-table th,
  #print-area .receipt-density-compact .receipt-cheque-table td {
    font-size: 8.5pt;
    padding: 0.45mm 0.7mm;
  }
  #print-area .receipt-density-dense {
    font-size: 8pt !important;
  }
  #print-area .receipt-density-dense .receipt-card {
    padding: 1mm 1.5mm !important;
  }
  #print-area .receipt-density-dense .receipt-card > * + * {
    margin-top: 0.7mm !important;
  }
  #print-area .receipt-density-dense .receipt-cheque-table,
  #print-area .receipt-density-dense .receipt-cheque-table th,
  #print-area .receipt-density-dense .receipt-cheque-table td {
    font-size: 8pt;
    padding: 0.3mm 0.5mm;
  }
  #print-area .receipt-density-dense .receipt-sign {
    height: 4mm !important;
  }
  #print-area .receipt-density-dense .receipt-logo {
    height: 8mm !important;
    max-height: 8mm !important;
  }
  #print-area .receipt-cheque-table td.receipt-col-nowrap {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  #print-area .receipt-cheque-table td.receipt-col-account,
  #print-area .receipt-cheque-table td.receipt-col-due,
  #print-area .receipt-cheque-table td.receipt-col-drawer {
    white-space: normal;
    overflow-wrap: break-word;
  }
  ${a4Sheets}
}
.receipt-measure .receipt-card {
  padding: 1.5mm 2mm !important;
}
.receipt-measure .receipt-card > * + * {
  margin-top: 1.2mm !important;
}
.receipt-measure .receipt-logo {
  height: 11mm !important;
  max-height: 11mm !important;
}
.receipt-measure .receipt-sign {
  height: 5mm !important;
}
.receipt-measure .receipt-cheque-table,
.receipt-measure .receipt-cheque-table th,
.receipt-measure .receipt-cheque-table td {
  font-size: 9pt;
  padding: 0.6mm 1mm;
}
.receipt-measure.receipt-density-compact .receipt-cheque-table td,
.receipt-measure.receipt-density-compact .receipt-cheque-table th {
  font-size: 8.5pt;
  padding: 0.45mm 0.7mm;
}
.receipt-measure.receipt-density-dense .receipt-card {
  padding: 1mm 1.5mm !important;
}
.receipt-measure.receipt-density-dense .receipt-card > * + * {
  margin-top: 0.7mm !important;
}
.receipt-measure.receipt-density-dense .receipt-cheque-table td,
.receipt-measure.receipt-density-dense .receipt-cheque-table th {
  font-size: 8pt;
  padding: 0.3mm 0.5mm;
}
.receipt-measure.receipt-density-dense .receipt-logo {
  height: 8mm !important;
  max-height: 8mm !important;
}
`.trim();
}

export function installPrintPageCss() {
  if (typeof document === "undefined") return;
  const id = "print-page-css";
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement("style");
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = printPageCss("shared", "A4");
}
