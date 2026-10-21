import type { Invoice } from "../types";
import {
  DEFAULT_PERSONNEL_PAY_KIND,
  MATCH_MODES,
  PERSONNEL_PAY_KINDS,
  canSubmitMatch,
  connStatusTone,
  connStatusTr,
  contactSelectGroups,
  emptyMatchDraft,
  expenseCategoryOptionLabel,
  invoiceRemaining,
  isPersonnelExpenseCategory,
  matchExpenseCategoryGroups,
  matchModesForTx,
  matchPayload,
  matchResultLabel,
  matchTargets,
  matchedViaTr,
  openInvoices,
  personnelCategoryOnly,
  posAccountGroups,
  ruleLabel,
  suggestionLabel,
  transferSelectGroups,
  type PersonnelPayKind,
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
  it("drops Cari + Fatura from modes and keeps POS bloke çözümü", () => {
    expect(MATCH_MODES.map((m) => m.key)).toEqual(["contact", "transfer", "category", "expense", "pos_settlement"]);
    expect(MATCH_MODES.map((m) => m.label)).not.toContain("Cari + Fatura");
    expect(MATCH_MODES[MATCH_MODES.length - 1]).toEqual({ key: "pos_settlement", label: "POS bloke çözümü" });
  });

  it("shows POS bloke çözümü only for inflow", () => {
    expect(matchModesForTx({ type: "inflow" }).map((m) => m.key)).toContain("pos_settlement");
    expect(matchModesForTx({ type: "outflow" }).map((m) => m.key)).not.toContain("pos_settlement");
    expect(matchModesForTx(null).map((m) => m.key)).not.toContain("pos_settlement");
    expect(matchModesForTx({ type: "outflow" }).map((m) => m.key)).toEqual(["contact", "transfer", "category", "expense"]);
  });

  it("prefills suggested contact and requires fields per mode", () => {
    const d = emptyMatchDraft({ suggested_contact_id: "c9" });
    expect(d.mode).toBe("contact");
    expect(d.contact_id).toBe("c9");
    expect(d.learn).toBe(true);
    expect(d.employee_id).toBe("");
    expect(d.personnel_pay_kind).toBe(DEFAULT_PERSONNEL_PAY_KIND);
    expect(d.expense_id).toBe("");
    expect(canSubmitMatch(d)).toBe(true);
    expect(canSubmitMatch({ ...d, mode: "transfer" })).toBe(false);
    expect(canSubmitMatch({ ...d, mode: "category", category: "  " })).toBe(false);
    expect(canSubmitMatch({ ...d, mode: "category", category: "Kira" })).toBe(true);
    expect(personnelCategoryOnly({ ...d, mode: "category", category: "Personel Masrafı" })).toBe(true);
    expect(personnelCategoryOnly({ ...d, mode: "expense", category: "Personel Masrafı" })).toBe(false);
    expect(canSubmitMatch({ ...d, mode: "category", category: "Personel Masrafı" })).toBe(false);
    expect(canSubmitMatch({ ...d, mode: "expense" })).toBe(false);
    expect(canSubmitMatch({ ...d, mode: "expense", category: "Yakıt" })).toBe(true);
    expect(canSubmitMatch({ ...d, mode: "expense", category: "Personel Masrafı" })).toBe(false);
    expect(canSubmitMatch({
      ...d,
      mode: "expense",
      category: "Personel Masrafı",
      employee_id: "e1",
      personnel_pay_kind: "advance",
    })).toBe(true);
  });

  it("starts a POS suggestion at net and does not apply the rate or suggested gross", () => {
    const d = emptyMatchDraft({
      type: "inflow",
      amount: 100,
      suggested_match_kind: "pos_settlement",
      suggested_pos_commission_rate: 0.1,
      suggested_pos_gross: 111.11,
      suggested_target_account_id: "pos-1",
      suggested_target_account_name: "Sanal POS",
      suggested_category: "POS Komisyonu",
    });
    expect(d.mode).toBe("pos_settlement");
    expect(d.target_account_id).toBe("pos-1");
    expect(d.category).toBe("POS Komisyonu");
    expect(d.contact_id).toBe("");
    expect(d.pos_gross).toBe("100");
    expect(d.pos_commission).toBe("0");
    expect(d.learn).toBe(true);
    const plain = emptyMatchDraft({ type: "outflow", amount: 80, suggested_match_kind: "pos_settlement" });
    expect(plain.mode).toBe("contact");
    expect(plain.pos_gross).toBe("");
  });

  it("labels Personel and lists pay kinds", () => {
    expect(isPersonnelExpenseCategory("Personel Masrafı")).toBe(true);
    expect(expenseCategoryOptionLabel("Personel Masrafı")).toBe("Personel");
    expect(PERSONNEL_PAY_KINDS.map((k) => k.label)).toEqual([
      "Masraf iadesi",
      "Avans",
      "Maaş",
      "Mesai",
      "Şirket masrafı (personel adına)",
    ]);
    expect(PERSONNEL_PAY_KINDS.map((k) => k.key)).toEqual(["reimburse", "advance", "salary", "overtime", "expense"]);
    const groups = matchExpenseCategoryGroups([{ name: "Yakıt" }, { name: "Personel Masrafı" }]);
    expect(groups[0].options.map((o) => o.label)).toEqual(["Yakıt", "Personel"]);
    expect(groups[0].options.find((o) => o.label === "Personel")?.value).toBe("Personel Masrafı");
  });

  it("keeps partner cash in the virman target list", () => {
    const groups = transferSelectGroups(
      [{ id: "a2", bank_name: "Matek Kasa", account_name: "Vadesiz TL Hesabı" }],
      [
        { id: "p1", name: "Mustafa", share_percent: 50, balance: 1200, is_active: true },
        { id: "p2", name: "Pasif", is_active: false },
      ]
    );
    expect(groups.map((g) => g.label)).toEqual(["Banka hesabı", "Ortaklar Hesabı"]);
    expect(groups[1].options.map((o) => o.value)).toEqual(["partner:p1"]);
    expect(groups[1].options[0].label).toContain("Mustafa");
    expect(groups[1].options[0].label).toContain("Ortak");
    const iban = "TR330006200519786457841234";
    const labeled = transferSelectGroups([
      {
        id: "b9",
        type: "bank",
        bank_name: "Kuveyt Türk",
        account_name: "Vadesiz TL Hesabı",
        iban,
        is_integrated: true,
      },
      { id: "k1", type: "cash_box", account_name: "Merkez kasa" },
    ]);
    expect(labeled.map((g) => g.label)).toEqual(["Banka hesabı", "Kasa"]);
    expect(labeled[0].options[0].label).toContain("Kuveyt Türk");
    expect(labeled[0].options[0].label).toContain("…1234");
    expect(labeled[0].options[0].label).toContain("entegre");
    expect(labeled[0].options[0].label).not.toContain(iban);
    expect(labeled[0].options[0].disabled).toBe(true);
    expect(labeled[1].options[0].disabled).toBe(false);
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
      category: null,
      contact_id: "c1",
      invoice_id: null,
      target_account_id: null,
      as_expense: false,
      employee_id: null,
      personnel_pay_kind: null,
      expense_id: null,
    });
    const transfer = matchPayload({ ...base, mode: "transfer", contact_id: "c1", target_account_id: "acc2" });
    expect(transfer.contact_id).toBeNull();
    expect(transfer.target_account_id).toBe("acc2");
    const expense = matchPayload({ ...base, mode: "expense", contact_id: "c1", category: "Yakıt" });
    expect(expense.as_expense).toBe(true);
    expect(expense.category).toBe("Yakıt");
    expect(expense.contact_id).toBeNull();
    expect(expense.employee_id).toBeNull();
    const personnel = matchPayload({
      ...base,
      mode: "expense",
      category: "Personel Masrafı",
      employee_id: "e1",
      personnel_pay_kind: "salary",
    });
    expect(personnel.as_expense).toBe(true);
    expect(personnel.employee_id).toBe("e1");
    expect(personnel.personnel_pay_kind).toBe("salary");
    expect(personnel.expense_id).toBeNull();
    expect(personnel.contact_id).toBeNull();
    const reimburse = matchPayload({
      ...base,
      mode: "expense",
      category: "Personel Masrafı",
      employee_id: "e1",
      personnel_pay_kind: "reimburse",
      expense_id: "msr-1",
    });
    expect(reimburse.as_expense).toBe(true);
    expect(reimburse.employee_id).toBe("e1");
    expect(reimburse.personnel_pay_kind).toBe("reimburse");
    expect(reimburse.expense_id).toBe("msr-1");
    const advance = matchPayload({
      ...base,
      mode: "expense",
      category: "Personel Masrafı",
      employee_id: "e1",
      personnel_pay_kind: "advance",
      expense_id: "msr-1",
    });
    expect(advance.personnel_pay_kind).toBe("advance");
    expect(advance.expense_id).toBeNull();
    const omitted = matchPayload({
      ...base,
      mode: "expense",
      category: "Personel",
      employee_id: "e1",
      personnel_pay_kind: "" as PersonnelPayKind,
      expense_id: "msr-1",
    });
    expect(omitted.personnel_pay_kind).toBe(DEFAULT_PERSONNEL_PAY_KIND);
    expect(omitted.expense_id).toBeNull();
    const fuel = matchPayload({ ...base, mode: "expense", category: "Yakıt", expense_id: "msr-1" });
    expect(fuel.expense_id).toBeNull();
    expect(fuel.personnel_pay_kind).toBeNull();
    expect(fuel.employee_id).toBeNull();
    const pos = matchPayload({
      ...base,
      mode: "pos_settlement",
      contact_id: "c1",
      invoice_id: "inv-1",
      target_account_id: "pos-1",
      category: "POS Komisyonu",
      pos_gross: "111.11",
      pos_commission: "11.11",
      learn: true,
    });
    expect(pos).toEqual({
      mode: "pos_settlement",
      target_account_id: "pos-1",
      pos_gross: 111.11,
      pos_commission: 11.11,
      category: "POS Komisyonu",
      learn: true,
    });
    expect(pos).not.toHaveProperty("contact_id");
    expect(pos).not.toHaveProperty("invoice_id");
    expect(pos).not.toHaveProperty("as_expense");
    expect(pos).not.toHaveProperty("link_existing_id");
  });

  it("submits POS bloke çözümü only when validation is clean and the category is set", () => {
    const base = emptyMatchDraft({
      type: "inflow",
      amount: 100,
      suggested_match_kind: "pos_settlement",
      suggested_target_account_id: "pos-1",
    });
    expect(canSubmitMatch(base, { type: "inflow", amount: 100 }, 500)).toBe(true);
    expect(canSubmitMatch({ ...base, category: "  " }, { type: "inflow", amount: 100 }, 500)).toBe(false);
    expect(canSubmitMatch({ ...base, target_account_id: "" }, { type: "inflow", amount: 100 }, 500)).toBe(false);
    expect(canSubmitMatch({ ...base, pos_gross: "50" }, { type: "inflow", amount: 100 }, 500)).toBe(false);
    expect(canSubmitMatch({ ...base, pos_commission: "-1" }, { type: "inflow", amount: 100 }, 500)).toBe(false);
    expect(canSubmitMatch(base, { type: "outflow", amount: 100 }, 500)).toBe(false);
    expect(canSubmitMatch({ ...base, pos_gross: "600", pos_commission: "500" }, { type: "inflow", amount: 100 }, 500)).toBe(false);
    expect(canSubmitMatch({ ...base, pos_gross: "" }, { type: "inflow", amount: 100 }, 500)).toBe(false);
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
    expect(matchResultLabel({
      match_kind: "pos_settlement",
      target_account_name: "Sanal POS",
      category: "POS Komisyonu",
    })).toBe("Sanal POS · POS Komisyonu");
    const posAccounts = posAccountGroups([
      { id: "b", type: "bank", account_name: "Vadesiz", current_balance: 9 },
      { id: "p", type: "pos", account_name: "Sanal POS", current_balance: 10 },
      { id: "o", type: "okc_pos", account_name: "ÖKC", current_balance: 3 },
    ]);
    expect(posAccounts[0].options.map((o) => o.value)).toEqual(["p", "o"]);
    expect(posAccounts[0].options[0].label).toContain("bloke bakiye");
    expect(posAccounts[0].options[0].label).toContain("Sanal POS");
    expect(suggestionLabel({ contact_name: "X", target_account_name: "Kasa", category: "Virman" })).toBe("X · Kasa (virman) · Virman");
    expect(ruleLabel({ pattern: "trendyol", contact_name: "Trendyol" })).toBe('"trendyol" → Trendyol');
  });

  it("marks the suggested contact in the select list", () => {
    const groups = contactSelectGroups([{ id: "c1", name: "Ali" }, { id: "c2", name: "Veli" }], "c2");
    expect(groups[0].options[1].label).toBe("Veli ★");
  });
});
