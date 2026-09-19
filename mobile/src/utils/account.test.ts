import { passwordChangePayload, validatePasswordChange } from "./account";

describe("validatePasswordChange", () => {
  it("requires current, length, match, and a different password", () => {
    expect(validatePasswordChange("", "abcdef", "abcdef")).toBe("Mevcut şifreyi girin.");
    expect(validatePasswordChange("old", "abc", "abc")).toBe("Yeni şifre en az 6 karakter olmalı.");
    expect(validatePasswordChange("old", "abcdef", "abcdeg")).toBe("Yeni şifreler eşleşmiyor.");
    expect(validatePasswordChange("abcdef", "abcdef", "abcdef")).toBe("Yeni şifre mevcut şifreyle aynı olamaz.");
    expect(validatePasswordChange("oldpass", "newpass", "newpass")).toBeNull();
  });

  it("posts current and trimmed new password", () => {
    expect(passwordChangePayload("old", "  secret1 ")).toEqual({
      current_password: "old",
      new_password: "secret1",
    });
  });
});
