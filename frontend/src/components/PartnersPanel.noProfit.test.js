/**
 * @jest-environment node
 */
const fs = require("fs");
const path = require("path");

test("PartnersPanel has no kâr payı dağıt UI", () => {
  const src = fs.readFileSync(path.join(__dirname, "PartnersPanel.jsx"), "utf8");
  expect(src).not.toMatch(/distribute-profit-btn/);
  expect(src).not.toMatch(/Kâr Payı Dağıt/);
  expect(src).not.toMatch(/distribute-profit-modal/);
  expect(src).not.toMatch(/Dağıtılan Kâr/);
  expect(src).not.toMatch(/partner-accrue-salary-btn/);
  expect(src).toMatch(/partner-tx-btn/);
  expect(src).toMatch(/Aylık maaş/);
});
