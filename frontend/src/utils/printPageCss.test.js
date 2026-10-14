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
