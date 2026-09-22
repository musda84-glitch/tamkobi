import { loadRememberedEmail, saveRememberedEmail, clearRememberedEmail, REMEMBER_ERP_KEY } from "./rememberEmail";

test("save and load remembered email", () => {
  clearRememberedEmail(REMEMBER_ERP_KEY);
  expect(loadRememberedEmail(REMEMBER_ERP_KEY)).toBe("");
  saveRememberedEmail(REMEMBER_ERP_KEY, "  Admin@TamKobi.com ");
  expect(loadRememberedEmail(REMEMBER_ERP_KEY)).toBe("admin@tamkobi.com");
  clearRememberedEmail(REMEMBER_ERP_KEY);
  expect(loadRememberedEmail(REMEMBER_ERP_KEY)).toBe("");
});
