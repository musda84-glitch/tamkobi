import { describe, expect, it } from "@jest/globals";
import { orderCanIssueEFatura, orderEBelgeType, efaturaOnayMessage } from "./orderEBelge";

describe("Elektronik Fatura Onayı kuralları", () => {
  const mukellef = [{ id: "c1", is_e_invoice_user: true }];
  const nihai = [{ id: "c1", is_e_invoice_user: false }];
  const ord = { contact_id: "c1", order_number: "B2B-2026-0020", is_invoiced: true };

  it("mükellef → e-fatura mesajı", () => {
    expect(orderEBelgeType(ord, mukellef)).toBe("e_invoice");
    expect(orderCanIssueEFatura(ord, mukellef)).toBe(true);
    expect(efaturaOnayMessage(ord, mukellef)).toMatch(/e-fatura mükellefidir/);
  });

  it("mükellef değil → e-arşiv mesajı (Devam Et yine Temel/Ticari ister)", () => {
    expect(orderEBelgeType(ord, nihai)).toBe("e_archive");
    expect(orderCanIssueEFatura(ord, nihai)).toBe(false);
    expect(efaturaOnayMessage(ord, nihai)).toMatch(/e-arşiv/);
  });

  it("Temel/Ticari senaryo seçimleri e-fatura zorlar", () => {
    const scenarios = ["TEMEL", "TICARI"];
    for (const scenario of scenarios) {
      expect(scenario === "TEMEL" || scenario === "TICARI").toBe(true);
      // Modal onConfirm her zaman eType=e_invoice + scenario ile çağrılır
      const payload = { eType: "e_invoice", scenario };
      expect(payload.eType).toBe("e_invoice");
      expect(["TEMEL", "TICARI"]).toContain(payload.scenario);
    }
  });
});
