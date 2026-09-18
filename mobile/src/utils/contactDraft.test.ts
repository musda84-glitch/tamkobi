import { collectableAccounts, contactPayload, draftFromContact, emptyContactDraft, splitPaymentTarget, validateContactDraft } from "./contactDraft";

describe("contactDraft", () => {
  it("requires name and VKN", () => {
    expect(validateContactDraft(emptyContactDraft())).toBe("Cari adı zorunludur.");
    const d = emptyContactDraft();
    d.name = "Acme";
    expect(validateContactDraft(d)).toBe("VKN/TCKN zorunludur.");
    d.tax_number_or_id = "1234567890";
    expect(validateContactDraft(d)).toBeNull();
  });

  it("maps a contact into a draft and payload", () => {
    const d = draftFromContact({
      type: "supplier",
      name: "Altın İş",
      tax_number_or_id: "0610641514",
      is_e_invoice_user: true,
      payment_term_days: 30,
      tags: ["vip", "hırdavat"],
      b2b_enabled: true,
      sms_opt_in: false,
    });
    expect(d.type).toBe("supplier");
    expect(d.tags).toBe("vip, hırdavat");
    expect(d.b2b_password).toBe("");
    const body = contactPayload(d, "comp1");
    expect(body.company_id).toBe("comp1");
    expect(body.is_e_invoice_user).toBe(true);
    expect(body.payment_term_days).toBe(30);
    expect(body.tags).toEqual(["vip", "hırdavat"]);
    expect(body.b2b_password).toBeUndefined();
  });

  it("carries map coordinates into the contact payload", () => {
    const d = draftFromContact({ name: "Acme", tax_number_or_id: "1", latitude: 41.0151, longitude: 28.9795 });
    expect(d.latitude).toBe("41.0151");
    const body = contactPayload(d);
    expect(body.latitude).toBe(41.0151);
    expect(body.longitude).toBe(28.9795);
    expect(contactPayload(emptyContactDraft()).latitude).toBeNull();
  });

  it("omits credit cards from tahsilat accounts", () => {
    const pool = collectableAccounts([
      { type: "bank" },
      { type: "credit_card" },
      { type: "cash_box" },
    ]);
    expect(pool.map((a) => a.type)).toEqual(["bank", "cash_box"]);
    expect(collectableAccounts([{ type: "kasa" }, { type: "credit_card" }]).map((a) => a.type)).toEqual(["kasa"]);
  });

  it("splits partner vs kasa payment targets", () => {
    expect(splitPaymentTarget("partner:p1")).toEqual({ partner_id: "p1" });
    expect(splitPaymentTarget("acc9")).toEqual({ account_id: "acc9" });
  });
});
