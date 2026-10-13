import { PAGE_HELP, pathKey, resolvePageHelp } from "./pageRegistry";

test("every known module has a title and intro", () => {
  const keys = Object.keys(PAGE_HELP);
  expect(keys).toContain("/invoices");
  expect(keys).toContain("/contacts");
  expect(keys).toContain("/stock");
  expect(keys).toContain("/yardim");
  keys.forEach((k) => {
    expect(PAGE_HELP[k].title).toBeTruthy();
    expect(PAGE_HELP[k].intro.length).toBeGreaterThan(20);
  });
});

test("settings tab and sistem section resolve", () => {
  const s = resolvePageHelp("/settings", "?tab=einvoice");
  expect(s.title).toMatch(/e-Fatura/i);
  expect(s.pageKey).toBe("/settings");
  const y = resolvePageHelp("/sistem/yardim");
  expect(y.title).toMatch(/Yardım/i);
  expect(y.tour.some((t) => t.selector.includes("sys-sidebar-nav"))).toBe(true);
});

test("pathKey prefers longest prefix", () => {
  expect(pathKey("/invoices")).toBe("/invoices");
  expect(pathKey("/sistem/sirketler/abc")).toBe("/sistem/sirketler");
});

test("invoice tour includes create button", () => {
  const h = resolvePageHelp("/invoices");
  expect(h.tour.some((t) => t.selector.includes("create-new-invoice-btn"))).toBe(true);
  expect(h.tour.some((t) => t.selector.includes("help-page-btn"))).toBe(true);
});
