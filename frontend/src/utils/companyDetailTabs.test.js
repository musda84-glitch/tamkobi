import {
  companyDetailPath,
  companyDetailTabFromUrl,
  companyDetailTabToUrl,
} from "./companyDetailTabs";

test("URL tab entegrator maps to einvoice", () => {
  expect(companyDetailTabFromUrl("entegrator")).toBe("einvoice");
  expect(companyDetailTabFromUrl("einvoice")).toBe("einvoice");
  expect(companyDetailTabFromUrl("storage")).toBe("storage");
  expect(companyDetailTabFromUrl("")).toBe("license");
  expect(companyDetailTabFromUrl("unknown")).toBe("license");
});

test("internal tab to URL", () => {
  expect(companyDetailTabToUrl("einvoice")).toBe("entegrator");
  expect(companyDetailTabToUrl("license")).toBe("license");
  expect(companyDetailTabToUrl("ai")).toBe("ai");
});

test("company detail path", () => {
  expect(companyDetailPath("comp_1")).toBe("/sistem/sirketler/comp_1");
  expect(companyDetailPath("comp_1", "license")).toBe("/sistem/sirketler/comp_1");
  expect(companyDetailPath("comp_1", "einvoice")).toBe("/sistem/sirketler/comp_1?tab=entegrator");
  expect(companyDetailPath("comp_1", "storage")).toBe("/sistem/sirketler/comp_1?tab=storage");
});
