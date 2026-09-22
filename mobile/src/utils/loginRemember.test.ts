import { emailToRemember } from "./loginRemember";

test("emailToRemember stores only when checked", () => {
  expect(emailToRemember(true, "  Admin@TamKobi.com ")).toBe("admin@tamkobi.com");
  expect(emailToRemember(false, "admin@tamkobi.com")).toBeNull();
  expect(emailToRemember(true, "   ")).toBeNull();
});
