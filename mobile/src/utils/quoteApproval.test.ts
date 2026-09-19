import {
  approvalChannels,
  approvalPayload,
  approvalSendFeedback,
  approvalSmsFallback,
  approvalStatusTr,
  defaultApprovalFlags,
  smsComposerHref,
  smsSendFailed,
  validateApprovalSend,
} from "./quoteApproval";

describe("quoteApproval", () => {
  it("requires a channel and matching contact info", () => {
    expect(validateApprovalSend([], "", "")).toBe("En az bir kanal seçin.");
    expect(validateApprovalSend(["whatsapp"], "", "")).toBe("Telefon numarası girin.");
    expect(validateApprovalSend(["email"], "555", "")).toBe("E-posta girin.");
    expect(validateApprovalSend(["sms"], "0555", "")).toBeNull();
  });

  it("enables SMS and WhatsApp when the cari has a phone, like web", () => {
    expect(defaultApprovalFlags("0555", "a@b.com")).toEqual({ sms: true, email: false, whatsapp: true });
    expect(defaultApprovalFlags("", "a@b.com")).toEqual({ sms: false, email: true, whatsapp: false });
    expect(approvalChannels({ whatsapp: true, email: true })).toEqual(["email", "whatsapp"]);
  });

  it("posts channels and the public web origin", () => {
    expect(approvalPayload(["whatsapp"], " 0555 ", " a@b.com ", "https://tamkobi.com/")).toEqual({
      channels: ["whatsapp"],
      phone: "0555",
      email: "a@b.com",
      base_url: "https://tamkobi.com",
    });
    expect(approvalStatusTr("accepted")).toBe("Onaylandı");
    expect(approvalStatusTr("pending")).toBe("Onay bekliyor");
  });

  it("opens the device SMS composer when the operator did not send", () => {
    expect(approvalSmsFallback({ sms: { status: "simulated" } }, ["sms"])).toBe(true);
    expect(approvalSmsFallback({ sms: { status: "failed" } }, ["sms"])).toBe(true);
    expect(approvalSmsFallback({ sms: { status: "sent" } }, ["sms"])).toBe(false);
    expect(smsComposerHref("0532 111 22 33", "Teklif onayı: https://x/teklif/a")).toContain("sms:");
    expect(smsComposerHref("0532 111 22 33", "Teklif onayı: https://x/teklif/a")).toContain("body=");
    expect(approvalSendFeedback({ sms: { status: "failed", detail: "Geçersiz GSM" } }, ["sms"], true).message).toMatch(/telefon SMS/);
    expect(smsSendFailed({ status: "failed", sent: 0, failed: 1 })).toBe(true);
    expect(smsSendFailed({ status: "success", sent: 1, failed: 0 })).toBe(false);
    expect(smsSendFailed({ simulated: true, status: "success", sent: 1 })).toBe(false);
  });
});
