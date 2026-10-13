import { forgotErpPayload, forgotResultMessage } from "./forgotPassword";

describe("forgotErpPayload", () => {
  it("builds email channel body", () => {
    expect(forgotErpPayload({
      channel: "email",
      email: "  a@b.com ",
      phone: "05551112233",
      baseUrl: "https://tamkobi.com",
      next: "login",
    })).toEqual({
      channel: "email",
      email: "a@b.com",
      base_url: "https://tamkobi.com",
      next: "login",
    });
  });

  it("builds SMS channel body with phone", () => {
    expect(forgotErpPayload({
      channel: "sms",
      email: "a@b.com",
      phone: " 0555 111 22 33 ",
      baseUrl: "https://tamkobi.com",
    })).toEqual({
      channel: "sms",
      phone: "0555 111 22 33",
      base_url: "https://tamkobi.com",
      next: "login",
    });
  });

  it("defaults channel to email", () => {
    expect(forgotErpPayload({ email: "x@y.com", baseUrl: "https://tamkobi.com" }).channel).toBe("email");
  });
});

describe("forgotResultMessage", () => {
  it("returns server message only", () => {
    expect(forgotResultMessage({
      message: "Kayıtlı bir hesap varsa SMS gönderildi.",
      // @ts-expect-error ensure UI helpers ignore mail fields
      mail_status: "failed",
      detail: "SMTP down",
    }, "sms")).toBe("Kayıtlı bir hesap varsa SMS gönderildi.");
  });

  it("falls back by channel when message empty", () => {
    expect(forgotResultMessage({}, "sms")).toMatch(/SMS/);
    expect(forgotResultMessage(null, "email")).toMatch(/e-posta/);
  });
});
