import { isPartnerCashType, isPartnerExpenseTx, isPartnerLedgerType, partnerBalanceMeta, partnerLedgerBreakdown, partnerOptionLabel, partnerSalaryActionLabel, partnerSalaryCardText, partnerSalarySaveMessage, partnerSummaryCardMeta, partnerTxBalanceDelta, partnerTxEffect, partnerTxIncreasesBalance, partnerTxIsCashInflow, partnerTxLabel, partnerTxSign, salaryDayOf, PARTNER_PAID_LABEL, PARTNER_RECEIVED_LABEL, PARTNER_TX_LABEL } from "./partnerTx";

/** Mobil finance.test.ts ile aynı Ali BAL hareketleri. */
export const ALI_BAL_TXS = [
  { type: "capital_in", amount: 100000, description: "para koy" },
  { type: "capital_in", amount: 25000, contact_id: "c-pay", description: "cari ödeme" },
  { type: "withdrawal", amount: 78400, contact_id: "c-col", description: "cari tahsilat" },
  { type: "withdrawal", amount: 12000, description: "Virman → ortak" },
  { type: "withdrawal", amount: 8000, description: "hesap→ortak" },
  { type: "credit", amount: 705389.78, description: "Ortak Alacak Fişi" },
  { type: "salary", amount: 150000, description: "Eylül maaşı" },
  { type: "credit", amount: 39200, expense_id: "msr", source: "expense", description: "MSR masraf" },
  { type: "debit", amount: 15000, description: "borç fişi" },
  { type: "withdrawal", amount: 80000, source: "bank_match", bank_tx_type: "outflow", description: "banka çıkış" },
  { type: "capital_in", amount: 40000, source: "bank_match", bank_tx_type: "inflow", description: "banka giriş" },
  { type: "profit_share", amount: 20000, is_paid: false, description: "tahakkuk kâr payı" },
  { type: "profit_share", amount: 9000, is_paid: true, description: "ödenmiş kâr payı" },
];

const ALI_GIRIS = 278400;
const ALI_CIKIS = 994589.78;
const ALI_NET = -716189.78;

describe("partnerTx", () => {
  it("labels cash direction as Giriş / Çıkış", () => {
    expect(PARTNER_TX_LABEL.debit).toBe("Çıkış");
    expect(PARTNER_TX_LABEL.credit).toBe("Çıkış");
    expect(partnerTxLabel({ type: "credit", amount: 1, expense_id: "e1" })).toBe("Çıkış");
    expect(partnerTxLabel({ type: "credit", amount: 1, source: "expense" })).toBe("Çıkış");
    expect(partnerTxLabel({ type: "credit", amount: 1, description: "Ortak Alacak Fişi" })).toBe("Çıkış");
    expect(partnerTxIsCashInflow({ type: "credit", amount: 1 })).toBe(false);
    expect(partnerTxSign("credit", { type: "credit", amount: 1 })).toBe("-");
    expect(partnerTxIncreasesBalance("credit")).toBe(false);
    expect(partnerTxLabel({ type: "withdrawal", amount: 1, contact_id: "c1", description: "Ferhat: Cari tahsilat" })).toBe("Giriş");
    expect(partnerTxLabel({ type: "withdrawal", amount: 1 })).toBe("Çıkış");
    expect(partnerTxLabel({ type: "withdrawal", amount: 1, description: "Virman → ortak" })).toBe("Çıkış");
    expect(partnerTxLabel({ type: "capital_in", amount: 1 })).toBe("Giriş");
    expect(partnerTxLabel({ type: "capital_in", amount: 1, contact_id: "c1" })).toBe("Çıkış");
    expect(partnerTxLabel({ type: "salary", amount: 1 })).toBe("Çıkış");
    expect(partnerTxLabel({ type: "debit", amount: 1 })).toBe("Çıkış");
    expect(partnerTxLabel({ type: "profit_share", amount: 1, is_paid: false })).toBe("Giriş");
    expect(partnerTxLabel({ type: "profit_share", amount: 1, is_paid: true })).toBe("Denk");
    expect(isPartnerExpenseTx({ expense_id: "e1" })).toBe(true);
    expect(isPartnerExpenseTx({ type: "credit" })).toBe(false);
    expect(partnerTxIsCashInflow({ type: "credit", amount: 1, expense_id: "e1" })).toBe(false);
    expect(partnerTxIsCashInflow({ type: "withdrawal", amount: 1, contact_id: "c1" })).toBe(true);
    expect(partnerTxSign("credit", { type: "credit", amount: 1, expense_id: "e1" })).toBe("-");
    expect(partnerTxSign("withdrawal", { type: "withdrawal", amount: 1, contact_id: "c1" })).toBe("+");
    expect(partnerTxLabel({
      type: "withdrawal",
      amount: 1,
      source: "bank_match",
      bank_tx_type: "outflow",
      description: "Vadesiz TL Hesabı: Banka Hareketi",
    })).toBe("Giriş");
    expect(partnerTxIsCashInflow({
      type: "withdrawal",
      amount: 1,
      source: "bank_match",
      bank_tx_type: "outflow",
    })).toBe(true);
    expect(partnerTxSign("withdrawal", {
      type: "withdrawal",
      amount: 1,
      source: "bank_match",
      bank_tx_type: "outflow",
    })).toBe("+");
    expect(partnerTxLabel({
      type: "capital_in",
      amount: 1,
      source: "bank_match",
      bank_tx_type: "outflow",
    })).toBe("Giriş");
    expect(partnerTxLabel({
      type: "capital_in",
      amount: 1,
      source: "bank_match",
      bank_tx_type: "inflow",
    })).toBe("Çıkış");
    expect(partnerTxLabel({
      type: "withdrawal",
      amount: 1,
      source: "bank_match",
      related_bank_tx_id: "btx1",
      description: "Vadesiz TL Hesabı: Banka Hareketi",
    })).toBe("Çıkış");
    expect(partnerTxEffect({ balance_delta: -40, side: "aleyhine", type: "credit", amount: 40 })).toEqual({ delta: -40, side: "cikis" });
    expect(partnerTxEffect({ balance_delta: 10, side: "giris", type: "credit", amount: 40 })).toEqual({ delta: 10, side: "giris" });
  });

  it("bank outflow match is Giriş (816859.78 − 39200 + 80000 = 857659.78)", () => {
    const txs = [
      { type: "capital_in", amount: 816859.78 },
      { type: "credit", amount: 39200, expense_id: "e1", source: "expense" },
      {
        type: "withdrawal",
        amount: 80000,
        source: "bank_match",
        bank_tx_type: "outflow",
      },
    ];
    expect(partnerTxBalanceDelta(txs[2])).toBe(80000);
    const br = partnerLedgerBreakdown(txs, 857659.78);
    expect(br.ledger).toBeCloseTo(857659.78, 2);
    expect(br.drift).toBe(false);
    expect(partnerTxLabel(txs[2])).toBe("Giriş");
    expect(partnerBalanceMeta(857659.78).display).toBeCloseTo(857659.78, 2);
    expect(partnerBalanceMeta(857659.78).label).toBe("Ortak borçlu");
  });

  it("Ali BAL: kart = Σ liste delta = Toplam Giriş − Toplam Çıkış", () => {
    expect(partnerTxBalanceDelta(ALI_BAL_TXS[2])).toBe(78400);
    expect(partnerTxBalanceDelta(ALI_BAL_TXS[5])).toBeCloseTo(-705389.78, 2);
    expect(partnerTxBalanceDelta(ALI_BAL_TXS[6])).toBe(-150000);
    expect(partnerTxBalanceDelta(ALI_BAL_TXS[7])).toBe(-39200);
    expect(partnerTxBalanceDelta(ALI_BAL_TXS[12])).toBe(0);
    expect(partnerTxLabel(ALI_BAL_TXS[3])).toBe("Çıkış");
    expect(partnerTxLabel(ALI_BAL_TXS[5])).toBe("Çıkış");
    const br = partnerLedgerBreakdown(ALI_BAL_TXS, ALI_NET);
    expect(br.cashIn).toBeCloseTo(ALI_GIRIS, 2);
    expect(br.cashOut).toBeCloseTo(ALI_CIKIS, 2);
    expect(br.girisDisplay).toBeCloseTo(ALI_GIRIS, 2);
    expect(br.cikisDisplay).toBeCloseTo(ALI_CIKIS, 2);
    expect(br.netDisplay).toBeCloseTo(ALI_NET, 2);
    expect(br.ledger).toBeCloseTo(ALI_NET, 2);
    expect(br.cardDisplay).toBeCloseTo(ALI_NET, 2);
    expect(br.cardPocket).toBeCloseTo(ALI_NET, 2);
    expect(br.netMatchesCard).toBe(true);
    expect(br.drift).toBe(false);
    expect(partnerBalanceMeta(br.cardPocket).badge).toBe("Ortak alacaklı");
    expect(partnerBalanceMeta(br.cardPocket).display).toBeCloseTo(Math.abs(ALI_NET), 2);
  });

  it("amber card uses the same balance presentation as partner balances", () => {
    const legacy = partnerSummaryCardMeta({ total_balance: -199822.37 });
    expect(legacy.badge).toBe("Ortak alacaklı");
    expect(legacy.display).toBeCloseTo(199822.37, 2);
    expect(legacy.fromCash).toBe(false);

    const cash = partnerSummaryCardMeta({
      total_balance: -258082.37,
      total_card_pocket: -258082.37,
      total_cash_net: 236013.99,
      total_cash_in: 173100,
      total_cash_out: 949159.78,
    });
    expect(cash.fromCash).toBe(true);
    expect(cash.badge).toBe("Ortak alacaklı");
    expect(cash.display).toBeCloseTo(258082.37, 2);
  });

  it("selector uses Ortak borçlu / Ortak alacaklı instead of a sign", () => {
    const ali = partnerOptionLabel({ name: "Ali BAL", share_percent: 50, balance: -288340.22, balance_label: "Borçlu" });
    const mus = partnerOptionLabel({ name: "Mustafa Bal", share_percent: 50, balance: 30257.85, balance_label: "Alacaklı" });
    expect(ali).toBe("Ali BAL (Ortak • %50 · 288.340,22 ₺ Ortak alacaklı)");
    expect(mus).toBe("Mustafa Bal (Ortak • %50 · 30.257,85 ₺ Ortak borçlu)");
    expect(ali).not.toContain("-");
    expect(mus).not.toContain("-");
    expect(partnerOptionLabel({ name: "Kapalı Ortak", share_percent: 10, balance: 0, balance_label: "Denk" })).toBe("Kapalı Ortak (Ortak • %10 · 0,00 ₺ Kapalı)");
  });

  it("positive balance is Ortak borçlu, negative is Ortak alacaklı, zero is Kapalı", () => {
    const debt = partnerBalanceMeta(1200);
    expect(debt.label).toBe("Ortak borçlu");
    expect(debt.badge).toBe("Ortak borçlu");
    expect(debt.hint).toBe("");
    expect(debt.side).toBe("debit");
    expect(debt.display).toBe(1200);
    expect(debt.color).toBe("#E11D48");
    expect(debt.amountCls).toBe("text-rose-700");
    expect(debt.badgeCls).toContain("rose");
    expect(debt.receivedLabel).toBe(PARTNER_RECEIVED_LABEL);
    expect(debt.paidLabel).toBe(PARTNER_PAID_LABEL);
    expect(PARTNER_RECEIVED_LABEL).toBe("Aldığı");
    expect(PARTNER_PAID_LABEL).toBe("Ödediği");

    const credit = partnerBalanceMeta(-705389.78);
    expect(credit.badge).toBe("Ortak alacaklı");
    expect(credit.label).toBe("Ortak alacaklı");
    expect(credit.hint).toBe("");
    expect(credit.side).toBe("credit");
    expect(credit.abs).toBeCloseTo(705389.78);
    expect(credit.display).toBeCloseTo(705389.78);
    expect(credit.color).toBe("#059669");
    expect(credit.amountCls).toBe("text-emerald-700");
    expect(credit.badgeCls).toContain("emerald");

    const closed = partnerBalanceMeta(0);
    expect(closed.badge).toBe("Kapalı");
    expect(closed.label).toBe("Kapalı");
    expect(closed.hint).toBe("");
    expect(closed.display).toBe(0);
    expect(closed.color).toBe("#64748B");
    expect(closed.amountCls).toBe("text-slate-500");
    expect(closed.badgeCls).toContain("slate");
    expect(partnerBalanceMeta("nope").badge).toBe("Kapalı");
  });
  it("treats credit as Çıkış and capital_in as Giriş", () => {
    expect(partnerTxIncreasesBalance("credit")).toBe(false);
    expect(partnerTxIncreasesBalance("capital_in")).toBe(true);
    expect(partnerTxSign("credit")).toBe("-");
    expect(partnerTxSign("capital_in")).toBe("+");
    expect(partnerTxSign("debit")).toBe("-");
    expect(partnerTxIncreasesBalance("debit")).toBe(false);
    expect(partnerTxIncreasesBalance("withdrawal")).toBe(false);
  });

  it("marks accrued profit share as increasing balance, paid as cash out", () => {
    expect(partnerTxIncreasesBalance("profit_share", { is_paid: false })).toBe(true);
    expect(partnerTxSign("profit_share", { is_paid: false, amount: 1 })).toBe("+");
    expect(partnerTxIncreasesBalance("profit_share", { is_paid: true })).toBe(false);
    expect(partnerTxSign("profit_share", { is_paid: true, amount: 1 })).toBe("");
  });

  it("reconciles card balance to Giriş − Çıkış", () => {
    const txs = [
      { type: "capital_in", amount: 500000 },
      { type: "salary", amount: 150000 },
      { type: "credit", amount: 50000 },
      { type: "profit_share", amount: 20000, is_paid: false },
      { type: "withdrawal", amount: 31810.22 },
      { type: "profit_share", amount: 9000, is_paid: true },
    ];
    const ledger = 500000 - 150000 - 50000 + 20000 - 31810.22;
    expect(partnerTxBalanceDelta(txs[0])).toBe(500000);
    expect(partnerTxBalanceDelta(txs[5])).toBe(0);
    const br = partnerLedgerBreakdown(txs, ledger);
    expect(br.ledger).toBeCloseTo(288189.78, 2);
    expect(br.drift).toBe(false);
    expect(br.buckets.salary).toBe(150000);
    expect(br.buckets.profit_paid).toBe(9000);
    expect(br.girisDisplay).toBeCloseTo(500000 + 20000, 2);
    expect(br.cikisDisplay).toBeCloseTo(150000 + 50000 + 31810.22, 2);
    expect(br.cardDisplay).toBeCloseTo(br.netDisplay, 2);
    expect(br.netMatchesCard).toBe(true);
    expect(partnerLedgerBreakdown(txs, ledger + 1).drift).toBe(true);
  });

  it("classifies ledger vs cash types", () => {
    expect(isPartnerLedgerType("debit")).toBe(true);
    expect(isPartnerLedgerType("credit")).toBe(true);
    expect(isPartnerLedgerType("salary")).toBe(true);
    expect(isPartnerCashType("capital_in")).toBe(true);
    expect(isPartnerCashType("debit")).toBe(false);
    expect(isPartnerCashType("salary")).toBe(false);
  });

  it("treats monthly salary as Çıkış", () => {
    expect(PARTNER_TX_LABEL.salary).toBe("Çıkış");
    expect(partnerTxIncreasesBalance("salary")).toBe(false);
    expect(partnerTxIsCashInflow({ type: "salary", amount: 150000 })).toBe(false);
    expect(partnerTxSign("salary", { type: "salary", amount: 150000 })).toBe("-");
  });
  it("prompts to set salary on the partner card when amount is empty", () => {
    expect(partnerSalaryActionLabel(0)).toBe("Belirle");
    expect(partnerSalaryActionLabel("")).toBe("Belirle");
    expect(partnerSalaryActionLabel(12500)).toBe(null);
  });

  it("shows monthly entitlement day on the partner card", () => {
    expect(partnerSalaryCardText({ monthly_salary: 150000, salary_start_date: "2026-10-05", salary_recurring: true }, (n) => String(n))).toBe("150000 ₺ · her ayın 5'i");
    expect(partnerSalaryCardText({ monthly_salary: 150000, salary_day: 15, salary_recurring: false }, (n) => String(n))).toBe("150000 ₺");
    expect(partnerSalaryCardText({ monthly_salary: 0 })).toBe("Belirle");
    expect(salaryDayOf({ salary_start_date: "2026-10-05" })).toBe(5);
    expect(salaryDayOf({ salary_day: 31 })).toBe(31);
  });

  it("tells the user a future hak ediş date posts later", () => {
    expect(partnerSalarySaveMessage({ posted_count: 0, scheduled_date: "2026-11-01" }, "2026-11-01")).toBe(
      "Kaydedildi. 01.11.2026 tarihinde cebine yazılacak.",
    );
    expect(partnerSalarySaveMessage({ posted_count: 1, message: "1 maaş kaydı ortak alacağına yazıldı." })).toBe(
      "1 maaş kaydı cebine yazıldı.",
    );
  });
});
