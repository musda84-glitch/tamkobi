import { describe, expect, it } from "@jest/globals";
import { orderCanIssueEFatura, orderEBelgeType, efaturaOnayMessage } from "./orderEBelge";

describe("Elektronik Fatura Onayı kuralları", () => {
  const mukellef = [{ id: "c1", is_e_invoice_user: true }];
  const nihai = [{ id: "c1", is_e_invoice_user: false }];
  const ord = { contact_id: "c1", order_number: "B2B-2026-0020", is_invoiced: true };

  it("mükellef → e-fatura mesajı + Temel/Ticari senaryo", () => {
    expect(orderEBelgeType(ord, mukellef)).toBe("e_invoice");
    expect(orderCanIssueEFatura(ord, mukellef)).toBe(true);
    expect(efaturaOnayMessage(ord, mukellef)).toMatch(/e-fatura mükellefidir/);
  });

  it("mükellef değil → e-arşiv mesajı, senaryo yok", () => {
    expect(orderEBelgeType(ord, nihai)).toBe("e_archive");
    expect(orderCanIssueEFatura(ord, nihai)).toBe(false);
    expect(efaturaOnayMessage(ord, nihai)).toMatch(/e-arşiv/);
  });
});
