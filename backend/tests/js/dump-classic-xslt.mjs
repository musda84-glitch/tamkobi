import { classicIsnetLayout, layoutToXslt, normalizeLayout } from "../../../frontend/src/utils/einvoiceDesignLayout.js";

const kind = process.argv[2] || "e_invoice";
if (kind === "render") {
  const layout = normalizeLayout({
    kind: "e_invoice",
    preset: "classic_isnet",
    ibanTitle: "BANKA HESAP BİLGİLERİMİZ",
    blocks: [
      { id: "header" },
      { id: "lines" },
      { id: "totals" },
      { id: "iban" },
      { id: "balance" },
      { id: "notes", hidden: true },
      { id: "supplier", hidden: true },
      { id: "customer", hidden: true },
      { id: "meta", hidden: true },
      { id: "ettn", hidden: true },
      { id: "qr", hidden: true },
    ],
    lineCols: [
      { id: "name" },
      { id: "qty" },
      { id: "discount" },
      { id: "vat" },
      { id: "total" },
    ],
    totalRows: [
      { id: "subtotal" },
      { id: "inclusive" },
      { id: "grand" },
    ],
  }, "e_invoice");
  process.stdout.write(layoutToXslt(layout, "e_invoice"));
} else {
  process.stdout.write(layoutToXslt(classicIsnetLayout(kind), kind));
}
