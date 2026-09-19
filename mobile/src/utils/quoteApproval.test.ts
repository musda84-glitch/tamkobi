import {
  approvalChannels,
  approvalChannelNeedsFallback,
  approvalPayload,
  approvalPublicOrigin,
  approvalSendFeedback,
  approvalStatusTr,
  channelResultLabel,
  contactEmail,
  contactPhone,
  defaultApprovalFlags,
  emailComposerHref,
  mergeApprovalFlags,
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

  it("enables SMS, WhatsApp and email when the cari has those fields", () => {
    expect(defaultApprovalFlags("0555", "a@b.com")).toEqual({ sms: true, email: true, whatsapp: true });
    expect(defaultApprovalFlags("", "a@b.com")).toEqual({ sms: false, email: true, whatsapp: false });
    expect(defaultApprovalFlags("0555", "")).toEqual({ sms: true, email: false, whatsapp: true });
    expect(approvalChannels({ whatsapp: true, email: true })).toEqual(["email", "whatsapp"]);
  });

  it("fills empty phone/email from the cari after it loads", () => {
    expect(contactPhone({ phone: " 0532 ", contact_person_phone: "0555" })).toBe("0532");
    expect(contactPhone({ contact_person_phone: "0555" })).toBe("0555");
    expect(contactEmail({ email: " a@b.com " })).toBe("a@b.com");
    expect(mergeApprovalFlags({ sms: false, email: false, whatsapp: false }, "0555", "a@b.com")).toEqual({
      sms: true,
      email: true,
      whatsapp: true,
    });
    expect(mergeApprovalFlags({ sms: true, email: false, whatsapp: false }, "0555", "a@b.com")).toEqual({
      sms: true,
      email: true,
      whatsapp: true,
    });
  });

  it("posts channels and the public web origin", () => {
    expect(approvalPayload(["whatsapp"], " 0555 ", " a@b.com ", "https://tamkobi.com/")).toEqual({
      channels: ["whatsapp"],
      phone: "0555",
      email: "a@b.com",
      base_url: "https://tamkobi.com",
    });
    expect(approvalPublicOrigin("https://api.example/api", "https://tamkobi.com/teklif/abc")).toBe("https://tamkobi.com");
    expect(approvalPublicOrigin("https://tamkobi.com/", "")).toBe("https://tamkobi.com");
    expect(approvalStatusTr("accepted")).toBe("Onaylandı");
    expect(approvalStatusTr("pending")).toBe("Onay bekliyor");
  });

  it("opens the device composer when SMS or email did not send", () => {
    expect(approvalChannelNeedsFallback({ sms: { status: "simulated" } }, ["sms"], "sms")).toBe(true);
    expect(approvalChannelNeedsFallback({ sms: { status: "failed" } }, ["sms"], "sms")).toBe(true);
    expect(approvalChannelNeedsFallback({ sms: { status: "sent" } }, ["sms"], "sms")).toBe(false);
    expect(approvalChannelNeedsFallback({ email: { status: "failed" } }, ["email"], "email")).toBe(true);
    expect(approvalChannelNeedsFallback({ email: { status: "sent" } }, ["email"], "email")).toBe(false);
    expect(smsComposerHref("0532 111 22 33", "Teklif onayı: https://x/teklif/a")).toContain("sms:");
    expect(smsComposerHref("0532 111 22 33", "Teklif onayı: https://x/teklif/a")).toContain("body=");
    expect(emailComposerHref("a@b.com", "Teklif", "link")).toContain("mailto:a@b.com");
    expect(approvalSendFeedback({ sms: { status: "failed", detail: "Geçersiz GSM" } }, ["sms"], { sms: true }).message).toMatch(/telefon SMS/);
    expect(approvalSendFeedback({ email: { status: "failed", detail: "SMTP yok" } }, ["email"], { email: true }).message).toMatch(/e-posta uygulaması/);
    expect(approvalSendFeedback({ email: { status: "failed", detail: "E-posta hesabı tanımlı değil." } }, ["email"]).ok).toBe(false);
    expect(smsSendFailed({ status: "failed", sent: 0, failed: 1 })).toBe(true);
    expect(smsSendFailed({ status: "success", sent: 1, failed: 0 })).toBe(false);
    expect(smsSendFailed({ simulated: true, status: "success", sent: 1 })).toBe(false);
    expect(channelResultLabel("simulated")).toBe("Simüle");
  });
});
