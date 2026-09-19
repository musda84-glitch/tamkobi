import {
  approvalChannels,
  approvalPayload,
  approvalStatusTr,
  defaultApprovalFlags,
  validateApprovalSend,
} from "./quoteApproval";

describe("quoteApproval", () => {
  it("requires a channel and matching contact info", () => {
    expect(validateApprovalSend([], "", "")).toBe("En az bir kanal seçin.");
    expect(validateApprovalSend(["whatsapp"], "", "")).toBe("Telefon numarası girin.");
    expect(validateApprovalSend(["email"], "555", "")).toBe("E-posta girin.");
    expect(validateApprovalSend(["sms"], "0555", "")).toBeNull();
  });

  it("prefers WhatsApp when the cari has a phone", () => {
    expect(defaultApprovalFlags("0555", "a@b.com")).toEqual({ sms: false, email: false, whatsapp: true });
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
});
