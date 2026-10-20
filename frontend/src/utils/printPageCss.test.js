import {
  A4_HEIGHT_MM,
  PRINT_DOC_TYPES,
  installPrintPageCss,
  printChromeFitsA4,
  printPageCss,
  printVerticalChromeMm,
} from "./printPageCss";

const fs = require("fs");
const path = require("path");

function declaredMm(css, variable) {
  const match = css.match(new RegExp(`--${variable}:\\s*(\\d+(?:\\.\\d+)?)mm`));
  if (!match) throw new Error(`missing --${variable}`);
  return Number(match[1]);
}

test.each(PRINT_DOC_TYPES)("%s print css keeps a one-page document on one page", (docType) => {
  const paper = docType === "dispatch" ? "A5" : "A4";
  const css = printPageCss(docType, paper);

  expect(css).toContain(`#print-area[data-doc-type="${docType}"]`);
  expect(css).toContain("html, body");
  expect(css).toContain("height: auto !important");
  expect(css).toContain("min-height: 0 !important");
  expect(css).not.toMatch(/height:\s*100vh/);
  expect(css).not.toMatch(/min-height:\s*297mm/);
  expect(css).not.toMatch(/height:\s*297mm/);
  expect(css).not.toMatch(/min-height:\s*100vh/);

  expect(css).toContain(":last-child { break-after: auto; page-break-after: auto; }");
  expect(css).toContain("break-after: auto");
  expect(css).toContain("page-break-after: auto");

  expect(css).toContain("visibility: hidden");
  expect(css).toContain("display: none !important");
  expect(css).toContain(".print-footer:empty");
  expect(css).toMatch(/\.print-footer:empty[\s\S]*height:\s*0/);
  expect(css).toMatch(/\.print-footer:empty[\s\S]*margin:\s*0/);
  expect(css).toMatch(/\.print-footer:empty[\s\S]*padding:\s*0/);

  const margin = declaredMm(css, "print-page-margin");
  const pad = declaredMm(css, "print-content-pad");
  expect(css).toContain(`margin: ${margin}mm`);
  expect(css).toContain(`padding: ${pad}mm`);
  expect(printVerticalChromeMm(margin, pad)).toBeLessThan(A4_HEIGHT_MM);
  expect(printChromeFitsA4(margin, pad)).toBe(true);

  if (paper === "A5") expect(css).toContain("size: A5");
  else expect(css).toContain("size: A4");
});

test("receipt copy layout is receipt-only", () => {
  const a4 = printPageCss("receipt", "A4");
  const a5 = printPageCss("receipt", "A5");
  expect(a4).toContain("size: A4");
  expect(a4).toContain(".receipt-half");
  expect(a4).toContain(".receipt-cut");
  expect(a4).toContain("page-break-after: always");
  expect(a4).toMatch(/\.receipt-page\[data-copy-count="2"\][\s\S]*display:\s*flex\s*!important/);
  expect(printPageCss("invoice", "A4")).not.toContain("display: flex !important");
  expect(a5).toContain("size: A5");
  expect(a5).not.toContain("min-height: 248mm");
  expect(a4).not.toContain("248mm");
  expect(printPageCss("invoice", "A4")).not.toContain(".receipt-half");
  expect(printPageCss("order", "A4")).not.toContain(".receipt-cut");
});

test("tek nüsha A5 yatay, iki nüsha A4 dikey ve 148.5mm yarımlar", () => {
  const a5 = printPageCss("receipt", "A5");
  const a4 = printPageCss("receipt", "A4");
  expect(a5).toContain("size: A5 landscape");
  expect(a5).toMatch(/@page \{ size: A5 landscape; margin: 0; \}/);
  expect(a5).not.toContain("portrait");
  expect(a5).toMatch(/min-height:\s*148mm/);
  expect(a5).toContain("210mm");
  expect(a5).toContain("max-width: none");
  expect(a4).toContain("max-width: none");
  expect(a5).toMatch(/padding:\s*8mm/);
  expect(a5).toMatch(/box-sizing:\s*border-box/);
  expect(a5).not.toContain("148.5mm");
  expect(a4).toMatch(/@page \{ size: A4 portrait; margin: 0; \}/);
  expect(a4).toMatch(/\.receipt-page\[data-copy-count="2"\] \.receipt-half \{[^}]*flex:\s*0 0 148\.5mm/);
  expect(a4).toMatch(/\.receipt-page\[data-copy-count="2"\] \.receipt-half \{[^}]*max-height:\s*148\.5mm/);
  expect(a4).toMatch(/\.receipt-page\[data-copy-count="2"\] \.receipt-half \{[^}]*box-sizing:\s*border-box/);
  expect(a4).toMatch(/\.receipt-page\[data-copy-count="2"\] \.receipt-half \{[^}]*padding:\s*8mm/);
  expect(a4).toMatch(/\.receipt-page\[data-copy-count="2"\] \.receipt-half \{[^}]*overflow:\s*visible/);
  expect(a4).not.toMatch(/\.receipt-half \{[^}]*overflow:\s*hidden/);
  expect(a4).not.toContain("248mm");
  expect(a4).not.toContain("justify-content: space-between");
  expect(a4).not.toMatch(/height:\s*297mm/);
  expect(a5).not.toContain("248mm");
  expect(a4).toContain("table-layout: fixed");
  expect(a5).toContain("table-layout: fixed");
  expect(a4).not.toContain("text-overflow: ellipsis");
  expect(a4).not.toContain("-webkit-line-clamp");
  expect(a4).not.toContain("line-clamp");
  expect(a5).not.toContain("text-overflow: ellipsis");
  expect(a5).not.toContain("-webkit-line-clamp");
  expect(a5).not.toContain("line-clamp");
  expect(a4).not.toMatch(/font-size:\s*7(\.5)?pt/);
  expect(a5).not.toMatch(/font-size:\s*7(\.5)?pt/);
  expect(a4).toMatch(/font-size:\s*8pt/);
  expect(a5).toMatch(/font-size:\s*8pt/);
  expect(printPageCss("invoice", "A4")).toContain("@page { size: A4; margin: 10mm; }");
  expect(printPageCss("invoice", "A4")).not.toContain("portrait");
  expect(printPageCss("invoice", "A4")).not.toContain("landscape");
  expect(printPageCss("order", "A4")).not.toContain("148.5mm");
  expect(printPageCss("dispatch", "A5")).toContain("@page { size: A5; margin: 10mm; }");
  expect(printPageCss("dispatch", "A5")).not.toContain("portrait");
  expect(printPageCss("dispatch", "A5")).not.toContain("landscape");
});

test("invoice order quote and dispatch print css stay byte-identical", () => {
  const dir = path.join(__dirname, "__fixtures__");
  for (const [doc, paper] of [["invoice", "A4"], ["order", "A4"], ["quote", "A4"], ["dispatch", "A5"]]) {
    const expected = fs.readFileSync(path.join(dir, `${doc}-${paper}.css`), "utf8");
    expect(printPageCss(doc, paper)).toBe(expected);
  }
});

test("screen print entry installs the shared rules and drops the absolute sheet", () => {
  installPrintPageCss();
  const installed = document.getElementById("print-page-css");
  expect(installed).not.toBeNull();
  expect(installed.textContent).toContain("height: auto !important");
  expect(installed.textContent).toContain(":last-child { break-after: auto; page-break-after: auto; }");
  expect(installed.textContent).not.toMatch(/height:\s*100vh/);

  const root = path.resolve(__dirname, "..");
  const printDoc = fs.readFileSync(path.join(root, "components/PrintDocument.jsx"), "utf8");
  const receipt = fs.readFileSync(path.join(root, "components/ReceiptPrint.jsx"), "utf8");
  const entry = fs.readFileSync(path.join(root, "index.js"), "utf8");
  const cssFile = fs.readFileSync(path.join(root, "index.css"), "utf8");

  expect(printDoc).toContain("printPageCss(docType");
  expect(printDoc).toContain("print-sheet-pad");
  expect(printDoc).toContain("print-footer");
  expect(receipt).toContain('printPageCss("receipt"');
  expect(receipt).toContain('data-doc-type="receipt"');
  expect(entry).toContain("installPrintPageCss");
  expect(cssFile).not.toMatch(/#print-area\s*\{[^}]*position:\s*absolute/);
});
