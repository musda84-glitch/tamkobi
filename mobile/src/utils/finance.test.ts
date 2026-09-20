import {
  accountPayload,
  accountUpdatePayload,
  draftFromAccount,
  emptyAccountDraft,
  emptyProjectExpenseDraft,
  expenseCalc,
  expenseCategoryGroups,
  expensePayload,
  groupedAccounts,
  paymentTargetGroups,
  splitPaymentTarget,
  validateContactPayment,
  contactPaymentRequest,
  totalLiquidity,
  validateAccountDraft,
  validateExpenseDraft,
  validatePartner,
  validateVirman,
  virmanAccounts,
} from "./finance";
import { emptyExpenseDraft } from "./finance";

describe("finance drafts", () => {
  it("requires account name and bank name for bank accounts", () => {
    const d = emptyAccountDraft();
    expect(validateAccountDraft(d)).toBe("Hesap adı gerekli.");
    d.account_name = "İş Bankası TL";
    expect(validateAccountDraft(d)).toBe("Banka adı gerekli.");
    d.bank_name = "İş Bankası";
    expect(validateAccountDraft(d)).toBeNull();
  });

  it("builds create payload with company and card sign", () => {
    const d = emptyAccountDraft();
    d.type = "credit_card";
    d.account_name = "Şirket kartı";
    d.current_balance = "2500";
    d.card_last4 = "12ab3456";
    const body = accountPayload(d, "comp_1");
    expect(body.company_id).toBe("comp_1");
    expect(body.current_balance).toBe(-2500);
    expect(body.card_last4).toBe("3456");
    const upd = accountUpdatePayload(d);
    expect("current_balance" in upd).toBe(false);
    expect("company_id" in upd).toBe(false);
  });

  it("maps an existing account into the form", () => {
    const d = draftFromAccount({ type: "cash_box", account_name: "Merkez kasa", current_balance: 10 });
    expect(d.type).toBe("cash_box");
    expect(d.account_name).toBe("Merkez kasa");
    expect(d.current_balance).toBe("10");
  });

  it("calculates expense VAT like web", () => {
    const d = emptyExpenseDraft("2026-09-16");
    d.description = "Kira";
    d.amount = "120";
    d.vat_rate = "20";
    d.vat_included = true;
    const t = expenseCalc(d);
    expect(t.net).toBeCloseTo(100);
    expect(t.vat).toBeCloseTo(20);
    expect(t.total).toBeCloseTo(120);
    expect(validateExpenseDraft(d)).toBeNull();
    d.description = "";
    expect(validateExpenseDraft(d)).toBe("Açıklama zorunlu.");
  });

  it("posts expense with optional payment account", () => {
    const d = emptyExpenseDraft("2026-09-16");
    d.description = "Yakıt";
    d.amount = "100";
    d.account_id = "acc1";
    const body = expensePayload(d, "comp");
    expect(body.company_id).toBe("comp");
    expect(body.amount).toBe(100);
    expect(body.account_id).toBe("acc1");
    expect(body.partner_id).toBeNull();
    expect(body.project_id).toBeNull();
    d.account_id = "partner:p9";
    const partnerBody = expensePayload(d, "comp");
    expect(partnerBody.account_id).toBeNull();
    expect(partnerBody.partner_id).toBe("p9");
    const proj = emptyProjectExpenseDraft("2026-09-19");
    proj.description = "Şantiye";
    proj.amount = "250";
    expect(proj.vat_included).toBe(true);
    expect(expensePayload(proj, "comp", "prj1")).toMatchObject({
      project_id: "prj1",
      description: "Şantiye",
      vat_included: true,
    });
  });

  it("groups payment targets like web PaymentTargetSelect", () => {
    const accounts = [
      { id: "b1", type: "bank", account_name: "Vakıf", current_balance: 100 },
      { id: "k1", type: "kasa", account_name: "Merkez kasa", current_balance: 50 },
      { id: "c1", type: "credit_card", account_name: "Kart", current_balance: -20 },
    ];
    const partners = [{ id: "p1", name: "Ali", balance: 3000 }, { id: "p2", name: "Pasif", is_active: false }];

    const collect = paymentTargetGroups(accounts, partners, { collectableOnly: true });
    expect(collect.map((g) => g.label)).toEqual(["Banka", "Kasa", "Ortaklar Hesabı"]);
    expect(collect.at(-1)?.options).toEqual([{ value: "partner:p1", label: expect.stringContaining("Ali") }]);
    expect(collect.at(-1)?.options[0].label).toContain("Ortak");

    const first = paymentTargetGroups(accounts, partners, { partnersFirst: true });
    expect(first[0].label).toBe("Ortaklar Hesabı");
    expect(first[0].options[0]).toEqual({ value: "partner:p1", label: expect.stringContaining("Ali") });

    const payIn = paymentTargetGroups(accounts, partners, { collectableOnly: true, partnersFirst: true });
    expect(payIn[0].label).toBe("Ortaklar Hesabı");
    expect(payIn[0].options.map((o) => o.value)).toEqual(["partner:p1"]);
    expect(payIn.map((g) => g.label)).not.toContain("Kredi Kartı");

    const spend = paymentTargetGroups(accounts, partners);
    expect(spend.map((g) => g.label)).toContain("Kredi Kartı");

    const noPartners = paymentTargetGroups(accounts, partners, { includePartners: false });
    expect(noPartners.map((g) => g.label)).not.toContain("Ortaklar Hesabı");
  });

  it("splits expense categories into default and company groups", () => {
    const groups = expenseCategoryGroups(
      [{ name: "Kira", is_default: true }, { name: "Şantiye", is_default: false }],
      ["Depo kirası", "Kira"]
    );
    expect(groups.map((g) => g.label)).toEqual(["Varsayılan", "Şirkete özel"]);
    expect(groups[1].options.map((o) => o.value)).toEqual(["Şantiye", "Depo kirası"]);
    expect(expenseCategoryGroups([])[0].options.length).toBeGreaterThan(5);
  });

  it("rejects virman onto the same account", () => {
    expect(validateVirman("a", "a", "10")).toBe("Kaynak ve hedef hesap aynı olamaz.");
    expect(validateVirman("a", "b", "0")).toBe("Geçerli bir tutar giriniz.");
    expect(validateVirman("a", "b", "25")).toBeNull();
  });

  it("groups kasas even when type is a cash alias", () => {
    const groups = groupedAccounts([
      { type: "bank", account_name: "Vakıf" },
      { type: "kasa", account_name: "Merkez kasa" },
      { type: "cash", account_name: "Nakit kasa" },
      { type: "credit_card", account_name: "Kart" },
    ]);
    const keys = groups.map((g) => g.key);
    expect(keys).toEqual(["bank", "cash_box", "credit_card"]);
    expect(groups.find((g) => g.key === "cash_box")?.items).toHaveLength(2);
    expect(totalLiquidity([
      { type: "cash_box", current_balance: 10 },
      { type: "bank", current_balance: 5 },
      { type: "credit_card", current_balance: -20 },
    ])).toBe(15);
    expect(virmanAccounts([{ is_integrated: true }, { is_integrated: false }])).toHaveLength(1);
    expect(splitPaymentTarget("partner:p1")).toEqual({ partner_id: "p1", account_id: null });
    expect(validatePartner("", "10")).toBe("Ortak adı gerekli.");
    expect(validatePartner("Ali", "60", 50)).toBe("Toplam ortaklık payı %100'ü aşamaz.");
    expect(validatePartner("Ali", "40", 50)).toBeNull();
  });

  it("builds a cari tahsilat / ödeme request", () => {
    expect(validateContactPayment("", "a1")).toBe("Geçerli bir tutar girin.");
    expect(validateContactPayment("10", "")).toBe("Kasa / banka / ortak seçin.");
    expect(validateContactPayment("12,5", "a1")).toBeNull();
    const partner = contactPaymentRequest({
      companyId: "c1",
      contactId: "ct1",
      contactName: "Mustafa BAL",
      type: "inflow",
      amount: 50,
      accountId: "partner:p1",
      description: "Cari tahsilat",
      accounts: [],
    });
    expect(partner.path).toBe("/contacts/ct1/record-payment");
    expect(partner.body).toMatchObject({ partner_id: "p1", type: "inflow", amount: 50 });
    const bank = contactPaymentRequest({
      companyId: "c1",
      contactId: "ct1",
      contactName: "Mustafa BAL",
      type: "outflow",
      amount: 20,
      accountId: "a1",
      description: "Cari ödeme",
      accounts: [{ id: "a1", account_name: "Kasa" }],
    });
    expect(bank.path).toBe("/banking/transactions");
    expect(bank.body).toMatchObject({ category: "Cari Ödeme", contact_id: "ct1", account_name: "Kasa", source: "manual" });
  });
});
