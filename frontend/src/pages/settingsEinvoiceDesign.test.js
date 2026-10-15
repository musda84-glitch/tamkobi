const fs = require("fs");
const path = require("path");

test("firma ayarlarında e-fatura tasarım stüdyosu yok", () => {
  const src = fs.readFileSync(path.join(__dirname, "SettingsPage.jsx"), "utf8");
  expect(src).not.toMatch(/EinvoiceDesignsPanel/);
  expect(src).not.toMatch(/einvoice\/designs/);
  expect(src).toMatch(/Fatura tasarımı değişikliği için destek ile iletişime geçin/);
  expect(src).toMatch(/einvoice-design-support-hint/);
});
