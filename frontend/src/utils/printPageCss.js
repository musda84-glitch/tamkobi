/** Shared print CSS for sipariş formu, teklif, irsaliye, fatura and tahsilat makbuzu.
 * A viewport-tall shell (100vh) or a fixed A4 min-height, plus @page margin, spills
 * one phantom page. visibility:hidden boxes still occupy flow unless removed.
 */

export const A4_HEIGHT_MM = 297;
export const PRINT_PAGE_MARGIN_MM = 10;
export const PRINT_CONTENT_PAD_MM = 8;

export const PRINT_DOC_TYPES = ["invoice", "order", "quote", "dispatch", "receipt"];

export function printVerticalChromeMm(marginMm = PRINT_PAGE_MARGIN_MM, padMm = PRINT_CONTENT_PAD_MM) {
  return (Number(marginMm) + Number(padMm)) * 2;
}

export function printChromeFitsA4(marginMm = PRINT_PAGE_MARGIN_MM, padMm = PRINT_CONTENT_PAD_MM) {
  return printVerticalChromeMm(marginMm, padMm) < A4_HEIGHT_MM;
}

function paperSize(paper) {
  return paper === "A5" ? "A5" : "A4";
}

function safeDocType(docType) {
  const raw = String(docType || "order");
  return /^[a-z0-9_-]+$/i.test(raw) ? raw : "order";
}

export function printPageCss(docType = "order", paper = "A4") {
  const kind = safeDocType(docType);
  const size = paperSize(paper);
  const margin = PRINT_PAGE_MARGIN_MM;
  const pad = PRINT_CONTENT_PAD_MM;
  const base = `
@page { size: ${size}; margin: ${margin}mm; }
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
  if (kind !== "receipt") return base;
  return `${base}\n${receiptCopyCss(size)}`.trim();
}

/** İki nüsha tek A4 yaprağa sığsın; diğer belge türlerine yazılmaz. */
function receiptCopyCss(size) {
  const a4Sheets = size === "A4" ? `
  #print-area .receipt-page[data-copy-count="2"] {
    min-height: 248mm;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  #print-area .receipt-page[data-copy-count="1"] {
    break-inside: avoid;
    page-break-inside: avoid;
  }` : `
  #print-area .receipt-page {
    break-inside: avoid;
    page-break-inside: avoid;
  }`;
  return `
.receipt-print-only { display: none; }
@media print {
  #print-area .receipt-print-only { display: block !important; }
  #print-area .receipt-page:not(:last-child) {
    break-after: page;
    page-break-after: always;
  }
  #print-area .receipt-half,
  #print-area .receipt-row,
  #print-area .receipt-cheque-table tr {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  #print-area .receipt-cut {
    border-top: 1px dashed #111;
    text-align: center;
    font-size: 9px;
    letter-spacing: 0.08em;
    margin: 1.5mm 0;
    padding-top: 1mm;
    flex: 0 0 auto;
  }
  #print-area .receipt-logo {
    height: 13mm;
    max-height: 14mm;
    width: auto;
    object-fit: contain;
  }
  #print-area .receipt-total {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  #print-area .receipt-cheque-table,
  #print-area .receipt-cheque-table th,
  #print-area .receipt-cheque-table td {
    font-size: 9px;
  }
  #print-area .receipt-cheque-table th,
  #print-area .receipt-cheque-table td {
    white-space: normal;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  ${a4Sheets}
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
