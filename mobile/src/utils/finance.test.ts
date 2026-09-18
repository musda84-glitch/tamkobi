import {
  accountPayload,
  accountUpdatePayload,
  draftFromAccount,
  emptyAccountDraft,
  expenseCalc,
  expensePayload,
  groupedAccounts,
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
    expect(validatePartner("", "10")).toBe("Ortak adı gerekli.");
    expect(validatePartner("Ali", "60", 50)).toBe("Toplam ortaklık payı %100'ü aşamaz.");
    expect(validatePartner("Ali", "40", 50)).toBeNull();
  });
});
