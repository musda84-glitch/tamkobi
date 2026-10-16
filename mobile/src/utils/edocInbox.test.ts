import {
  DISPATCH_PROCESS_LABEL,
  DISPATCH_PROCESS_SUCCESS,
  EDOC_FILTERS,
  GIB_ACCEPT_CONFIRM,
  canSendCommercialResponse,
  commercialBadge,
  edocKindTr,
  edocRowSubtitle,
  edocRowTitle,
  edocStatusTr,
  inboxProcessLabel,
  isEdocProcessable,
  pendingEdocCount,
} from "./edocInbox";

const NOW = new Date("2026-10-16T09:00:00Z");

describe("edocInbox", () => {
  it("labels status and kind like the web inbox", () => {
    expect(edocStatusTr("pending")).toBe("Bekliyor");
    expect(edocStatusTr("approved")).toBe("İçeri alındı");
    expect(edocStatusTr("rejected")).toBe("Reddedildi");
    expect(edocStatusTr("ignored")).toBe("Dikkate alınmadı");
    expect(edocKindTr("invoice")).toBe("e-Fatura");
    expect(edocKindTr("dispatch")).toBe("e-İrsaliye");
  });

  it("builds a list row from supplier, number and totals", () => {
    const doc = {
      status: "pending",
      kind: "invoice",
      number: "GIB20260009",
      issue_date: "2026-09-20",
      grand_total: 1250,
      supplier: { name: "Woks Mobilya", tax_id: "123" },
      lines: [{ name: "Raf" }, { name: "Klasör" }],
      matched_lines: 1,
    };
    expect(edocRowTitle(doc)).toBe("Woks Mobilya");
    expect(edocRowSubtitle(doc)).toContain("e-Fatura");
    expect(edocRowSubtitle(doc)).toContain("GIB20260009");
    expect(edocRowSubtitle(doc)).toContain("1/2 satır");
    expect(isEdocProcessable(doc)).toBe(true);
  });

  it("blocks blank pending docs from one-tap process", () => {
    expect(isEdocProcessable({ status: "pending" })).toBe(false);
    expect(isEdocProcessable({ status: "approved", grand_total: 10, supplier: { name: "A" }, lines: [{}] })).toBe(false);
    expect(pendingEdocCount({ pending: 4, approved: 2 })).toBe(4);
    expect(pendingEdocCount(null)).toBe(0);
    expect(EDOC_FILTERS.map((f) => f.key)).toEqual(["pending", "rejected", "ignored"]);
  });

  it("shows GİB KABUL only for a commercial invoice inside 8 days", () => {
    const ticari = { kind: "invoice", profile: "TICARIFATURA", issue_date: "2026-10-16", status: "pending" };
    expect(canSendCommercialResponse(ticari, NOW)).toBe(true);
    expect(canSendCommercialResponse({ ...ticari, profile: "TEMELFATURA" }, NOW)).toBe(false);
    expect(canSendCommercialResponse({ ...ticari, issue_date: "2026-10-07" }, NOW)).toBe(false);
    expect(canSendCommercialResponse({ ...ticari, kind: "dispatch" }, NOW)).toBe(false);
    expect(commercialBadge(ticari, NOW)?.label).toBe("Yanıt bekliyor (8 gün)");
    expect(commercialBadge({ ...ticari, commercial_response: "accepted" }, NOW)?.label).toBe("Kabul edildi");
    expect(GIB_ACCEPT_CONFIRM).toContain("GİB'e gider");
    expect(inboxProcessLabel({ kind: "dispatch" })).toBe(DISPATCH_PROCESS_LABEL);
    expect(DISPATCH_PROCESS_SUCCESS).toBe("Gelen irsaliye alındı");
  });
});
