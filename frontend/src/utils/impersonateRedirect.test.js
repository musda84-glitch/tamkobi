import { ERP_HOME_PATH, impersonateRedirect } from "./impersonateRedirect";

test("impersonateRedirect defaults to /panel", () => {
  expect(ERP_HOME_PATH).toBe("/panel");
  expect(impersonateRedirect(null)).toBe("/panel");
  expect(impersonateRedirect({})).toBe("/panel");
  expect(impersonateRedirect({ redirect: "/panel" })).toBe("/panel");
  expect(impersonateRedirect({ redirect: "  /mesai  " })).toBe("/mesai");
  expect(impersonateRedirect({ redirect: "https://evil.example/" })).toBe("/panel");
});
