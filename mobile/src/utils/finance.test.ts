import {
  accountPayload,
  accountUpdatePayload,
  draftFromAccount,
  emptyAccountDraft,
  emptyProjectExpenseDraft,
  expenseCalc,
  expenseCategoryGroups,
  expensePayload,
  accountGroupTone,
  bankingFilterLabel,
  bankingListFilterKeys,
  filterPartners,
  groupedAccounts,
  paymentTargetGroups,
  splitPaymentTarget,
  validateContactPayment,
  contactPaymentRequest,
  accountCashTxRequest,
  totalLiquidity,
  validateAccountDraft,
  validateExpenseDraft,
  validatePartner,
  validateVirman,
  virmanAccounts,
  virmanSelectGroups,
  isBankingBankAccount,
  isBankingCashAccount,
  isBankingPosAccount,
  recentTxForAccounts,
  recentPartnerTx,
  bankMovementNotice,
  partnerMovementNotice,
  partnerCardTone,
  partnerInitials,
  filterPartnerTxs,
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
    expect(validateVirman("integrated:b1", "a2", "10")).toBe("Entegre banka hesaplar virmana kapalı.");
    expect(validateVirman("partner:p1", "a2", "10")).toBeNull();
  });

  it("puts partner cash and integrated banks on the virman list", () => {
    expect(isBankingBankAccount({ type: "bank" })).toBe(true);
    expect(isBankingBankAccount({ type: "pos" })).toBe(false);
    expect(isBankingBankAccount({ type: "okc_pos" })).toBe(false);
    expect(isBankingBankAccount({ type: "cash_box" })).toBe(false);
    expect(isBankingPosAccount({ type: "pos" })).toBe(true);
    expect(isBankingPosAccount({ type: "okc_pos" })).toBe(true);
    expect(isBankingPosAccount({ type: "bank" })).toBe(false);
    expect(isBankingCashAccount({ type: "cash_box" })).toBe(true);
    expect(isBankingCashAccount({ type: "kasa" })).toBe(true);
    expect(isBankingCashAccount({ type: "bank" })).toBe(false);
    const groups = virmanSelectGroups(
      [
        { id: "k1", type: "cash_box", account_name: "Kasa", current_balance: 10 },
        { id: "b1", type: "bank", bank_name: "Vakıf", account_name: "Vadesiz", is_integrated: true, current_balance: 5 },
        { id: "p0", type: "pos", account_name: "PayTR", current_balance: 3 },
      ],
      [{ id: "p1", name: "Ali BAL", share_percent: 50, balance: 2880, is_active: true }]
    );
    expect(groups.map((g) => g.label)).toEqual(["Kasa", "POS", "Ortaklar Hesabı", "Entegre banka"]);
    expect(groups.find((g) => g.label === "Ortaklar Hesabı")?.options[0].value).toBe("partner:p1");
    expect(groups.find((g) => g.label === "Entegre banka")?.options[0]).toMatchObject({
      value: "integrated:b1",
      disabled: true,
    });
  });

  it("groups kasas even when type is a cash alias", () => {
    const groups = groupedAccounts([
      { type: "bank", account_name: "Vakıf" },
      { type: "kasa", account_name: "Merkez kasa" },
      { type: "cash", account_name: "Nakit kasa" },
      { type: "credit_card", account_name: "Kart" },
    ]);
    const keys = groups.map((g) => g.key);
    expect(accountGroupTone("cash_box").accent).toBe("#059669");
    expect(accountGroupTone("bank").bg).toBe("#EFF6FF");
    expect(accountGroupTone("partners").label).toBe("#B45309");
    expect(accountGroupTone("yok").accent).toBe("#64748B");
    expect(bankingListFilterKeys(keys, true)).toEqual(["all", "bank", "partners", "cash_box", "credit_card"]);
    expect(bankingFilterLabel("all")).toBe("Tümü");
    expect(bankingFilterLabel("partners")).toBe("Ortaklar");
    expect(filterPartners([{ name: "Ali BAL" }, { name: "Veli" }], "ali")).toHaveLength(1);
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

  it("posts cash-account tahsilat with optional cari", () => {
    const acc = { id: "k1", account_name: "Matek Kasa", currency: "TRY" };
    const plain = accountCashTxRequest({
      companyId: "c1",
      account: acc,
      type: "inflow",
      amount: 100,
      description: "",
      date: "2026-09-22",
    });
    expect(plain.body).toMatchObject({
      account_id: "k1",
      category: "Tahsilat",
      description: "Tahsilat",
      date: "2026-09-22",
      source: "manual",
    });
    expect(plain.body).not.toHaveProperty("contact_id");
    const withCari = accountCashTxRequest({
      companyId: "c1",
      account: acc,
      type: "inflow",
      amount: 80,
      description: "Nakit",
      date: "2026-09-22",
      contactId: "ct9",
      contactName: "Ali BAL",
    });
    expect(withCari.body).toMatchObject({
      category: "Cari Tahsilat",
      contact_id: "ct9",
      contact_name: "Ali BAL",
      date: "2026-09-22",
    });
  });

  it("picks the latest 3 movements per group card", () => {
    const accs = [{ id: "b1" }, { id: "b2" }];
    const txs = [
      { id: "1", account_id: "b1", type: "inflow", amount: 10, date: "2026-01-01", description: "eski" },
      { id: "2", account_id: "b1", type: "outflow", amount: 4, date: "2026-09-20", description: "tediye" },
      { id: "3", account_id: "x", type: "inflow", amount: 99, date: "2026-09-22", description: "başka" },
      { id: "4", account_id: "b2", type: "inflow", amount: 8, date: "2026-09-21", description: "tahsilat" },
      { id: "5", target_account_id: "b1", account_id: "z", type: "transfer", amount: 3, date: "2026-09-22", description: "virman" },
    ];
    const latest = recentTxForAccounts(txs, accs, 3);
    expect(latest.map((t) => t.id)).toEqual(["5", "4", "2"]);
    expect(bankMovementNotice(latest[0], accs).signed).toBe(3);
    expect(bankMovementNotice(latest[2], accs).signed).toBe(-4);
    expect(recentPartnerTx([
      { id: "p1", type: "capital_in", amount: 20, date: "2026-01-01" },
      { id: "p2", type: "withdrawal", amount: 5, date: "2026-09-21" },
      { id: "p3", type: "profit_share", amount: 1, date: "2026-09-20" },
      { id: "p4", type: "capital_in", amount: 2, date: "2026-09-22" },
    ]).map((t) => t.id)).toEqual(["p4", "p2", "p3"]);
    expect(partnerMovementNotice({ id: "p2", type: "withdrawal", amount: 5 }).signed).toBe(-5);
  });

  it("gives partners stable colors and filters their movements", () => {
    expect(partnerInitials("Ali BAL")).toBe("AB");
    expect(partnerInitials("Mustafa Bal")).toBe("MB");
    expect(partnerCardTone("ali")).toEqual(partnerCardTone("ali"));
    expect(partnerCardTone("ali").accent).not.toBe(partnerCardTone("mustafa").accent);
    expect(filterPartnerTxs([
      { id: "1", partner_id: "a", amount: 1 },
      { id: "2", partner_id: "b", amount: 2 },
    ], "a").map((t) => t.id)).toEqual(["1"]);
  });
});
