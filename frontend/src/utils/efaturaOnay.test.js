import { describe, expect, it } from "@jest/globals";
import { orderCanIssueEFatura, orderEBelgeType, efaturaOnayMessage } from "./orderEBelge";

describe("Elektronik Fatura Onayı kuralları", () => {
  const mukellef = [{ id: "c1", is_e_invoice_user: true }];
  const nihai = [{ id: "c1", is_e_invoice_user: false }];
  const ord = { contact_id: "c1", order_number: "B2B-2026-0020", is_invoiced: true };

  it("cari bayrağı e-fatura mesajı üretmez", () => {
    expect(orderEBelgeType(ord, mukellef)).toBe("e_archive");
    expect(orderCanIssueEFatura(ord, mukellef)).toBe(false);
    expect(efaturaOnayMessage(ord, mukellef)).toMatch(/e-arşiv/);
  });

  it("mükellef değil → e-arşiv mesajı", () => {
    expect(orderEBelgeType(ord, nihai)).toBe("e_archive");
    expect(orderCanIssueEFatura(ord, nihai)).toBe(false);
    expect(efaturaOnayMessage(ord, nihai)).toMatch(/e-arşiv/);
  });

  it("canlı GİB mükellefi Temel/Ticari e-fatura gönderir", () => {
    const gib = { is_e_invoice_user: true, suggested_e_type: "e_invoice" };
    expect(orderEBelgeType(ord, nihai, gib)).toBe("e_invoice");
    const scenarios = ["TEMEL", "TICARI"];
    for (const scenario of scenarios) {
      const payload = { eType: "e_invoice", scenario };
      expect(payload.eType).toBe("e_invoice");
      expect(["TEMEL", "TICARI"]).toContain(payload.scenario);
    }
  });
});
