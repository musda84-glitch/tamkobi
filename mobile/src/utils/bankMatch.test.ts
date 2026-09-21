import type { Invoice } from "../types";
import {
  canSubmitMatch,
  connStatusTone,
  connStatusTr,
  contactSelectGroups,
  emptyMatchDraft,
  invoiceRemaining,
  matchPayload,
  matchResultLabel,
  matchTargets,
  matchedViaTr,
  openInvoices,
  ruleLabel,
  suggestionLabel,
  transferSelectGroups,
} from "./bankMatch";

const salesOpen: Invoice = {
  id: "inv1",
  contact_id: "c1",
  invoice_type: "sales",
  invoice_number: "SAT-1",
  payment_status: "partial",
  status: "issued",
  grand_total: 200,
  paid_amount: 50,
};
const salesPaid: Invoice = { ...salesOpen, id: "inv2", payment_status: "paid", paid_amount: 200 };
const draft: Invoice = { ...salesOpen, id: "inv3", status: "draft" };
const purchase: Invoice = { ...salesOpen, id: "inv4", invoice_type: "purchase", invoice_number: "ALIS-1" };

describe("openInvoices", () => {
  it("keeps unpaid non-draft invoices of the matching type, closest amount first", () => {
    const far: Invoice = { ...salesOpen, id: "inv5", grand_total: 900, paid_amount: 0, invoice_number: "SAT-9" };
    const rows = openInvoices([salesPaid, draft, purchase, far, salesOpen], "c1", { type: "inflow", amount: 150 });
    expect(rows.map((i) => i.id)).toEqual(["inv1", "inv5"]);
  });

  it("uses purchase invoices for outflows", () => {
    const rows = openInvoices([salesOpen, purchase], "c1", { type: "outflow", amount: 150 });
    expect(rows.map((i) => i.id)).toEqual(["inv4"]);
  });

  it("returns empty without a contact", () => {
    expect(openInvoices([salesOpen], "", { type: "inflow", amount: 10 })).toEqual([]);
  });
});

describe("matchTargets / remaining", () => {
  it("drops the source account and integrated banks", () => {
    const rows = matchTargets(
      [
        { id: "a1", account_name: "Kaynak", is_integrated: false },
        { id: "a2", account_name: "Hedef", is_integrated: false },
        { id: "a3", account_name: "Entegre", is_integrated: true },
      ],
      { account_id: "a1" }
    );
    expect(rows.map((a) => a.id)).toEqual(["a2"]);
  });

  it("computes remaining invoice amount", () => {
    expect(invoiceRemaining(salesOpen)).toBe(150);
    expect(invoiceRemaining(null)).toBe(0);
  });
});

describe("match draft / payload", () => {
  it("prefills suggested contact and requires fields per mode", () => {
    const d = emptyMatchDraft({ suggested_contact_id: "c9" });
    expect(d.mode).toBe("contact");
    expect(d.contact_id).toBe("c9");
    expect(d.learn).toBe(true);
    expect(canSubmitMatch(d)).toBe(true);
    expect(canSubmitMatch({ ...d, mode: "invoice" })).toBe(false);
    expect(canSubmitMatch({ ...d, mode: "invoice", invoice_id: "inv1" })).toBe(true);
    expect(canSubmitMatch({ ...d, mode: "transfer" })).toBe(false);
    expect(canSubmitMatch({ ...d, mode: "category", category: "  " })).toBe(false);
    expect(canSubmitMatch({ ...d, mode: "category", category: "Kira" })).toBe(true);
  });

  it("keeps partner cash in the virman target list", () => {
    const groups = transferSelectGroups(
      [{ id: "a2", bank_name: "Matek Kasa", account_name: "Vadesiz TL Hesabı" }],
      [
        { id: "p1", name: "Mustafa", share_percent: 50, balance: 1200, is_active: true },
        { id: "p2", name: "Pasif", is_active: false },
      ]
    );
    expect(groups.map((g) => g.label)).toEqual(["Kasa / Hesap", "Ortaklar Hesabı"]);
    expect(groups[1].options.map((o) => o.value)).toEqual(["partner:p1"]);
    expect(groups[1].options[0].label).toContain("Mustafa");
    expect(groups[1].options[0].label).toContain("Ortak");
    const transfer = matchPayload({
      ...emptyMatchDraft(),
      mode: "transfer",
      target_account_id: "partner:p1",
    });
    expect(transfer.target_account_id).toBe("partner:p1");
  });

  it("sends only the fields that belong to the selected mode", () => {
    const base = emptyMatchDraft();
    const contact = matchPayload({ ...base, contact_id: "c1", category: "Aidat" });
    expect(contact).toEqual({
      learn: true,
      category: "Aidat",
      contact_id: "c1",
      invoice_id: null,
      target_account_id: null,
    });
    const invoice = matchPayload({ ...base, mode: "invoice", contact_id: "c1", invoice_id: "inv1" });
    expect(invoice.invoice_id).toBe("inv1");
    expect(invoice.contact_id).toBe("c1");
    const transfer = matchPayload({ ...base, mode: "transfer", contact_id: "c1", target_account_id: "acc2" });
    expect(transfer.contact_id).toBeNull();
    expect(transfer.target_account_id).toBe("acc2");
  });
});

describe("labels", () => {
  it("translates connection and match-via badges", () => {
    expect(connStatusTr("connected")).toBe("Canlı bağlı");
    expect(connStatusTone("simulated")).toBe("amber");
    expect(connStatusTone("error")).toBe("red");
    expect(matchedViaTr("auto")).toBe("Otomatik");
    expect(matchedViaTr(undefined)).toBe("Manuel");
    expect(matchResultLabel({ contact_name: "Ahmet", related_invoice_number: "SAT-1" })).toBe("Ahmet · SAT-1");
    expect(suggestionLabel({ contact_name: "X", target_account_name: "Kasa", category: "Virman" })).toBe("X · Kasa (virman) · Virman");
    expect(ruleLabel({ pattern: "trendyol", contact_name: "Trendyol" })).toBe('"trendyol" → Trendyol');
  });

  it("marks the suggested contact in the select list", () => {
    const groups = contactSelectGroups([{ id: "c1", name: "Ali" }, { id: "c2", name: "Veli" }], "c2");
    expect(groups[0].options[1].label).toBe("Veli ★");
  });
});
