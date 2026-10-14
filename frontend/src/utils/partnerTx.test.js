import { isPartnerCashType, isPartnerExpenseTx, isPartnerLedgerType, partnerBalanceMeta, partnerLedgerBreakdown, partnerOptionLabel, partnerSalaryActionLabel, partnerSalaryCardText, partnerSalarySaveMessage, partnerSummaryCardMeta, partnerTxBalanceDelta, partnerTxEffect, partnerTxIncreasesBalance, partnerTxIsCashInflow, partnerTxLabel, partnerTxSign, salaryDayOf, PARTNER_TX_LABEL } from "./partnerTx";

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

const ALI_LEHINE = 1079589.78;
const ALI_ALEYHINE = 193400;
const ALI_NET = 886189.78;

describe("partnerTx", () => {
  it("labels txs by partner side (lehine / aleyhine)", () => {
    expect(PARTNER_TX_LABEL.debit).toBe("Ortak aleyhine");
    expect(PARTNER_TX_LABEL.credit).toBe("Ortak lehine");
    expect(partnerTxLabel({ type: "credit", amount: 1, expense_id: "e1" })).toBe("Ortak lehine");
    expect(partnerTxLabel({ type: "credit", amount: 1, source: "expense" })).toBe("Ortak lehine");
    expect(partnerTxLabel({ type: "credit", amount: 1, description: "Ortak Alacak Fişi" })).toBe("Ortak lehine");
    expect(partnerTxIsCashInflow({ type: "credit", amount: 1 })).toBe(true);
    expect(partnerTxSign("credit", { type: "credit", amount: 1 })).toBe("+");
    expect(partnerTxIncreasesBalance("credit")).toBe(true);
    expect(partnerTxLabel({ type: "withdrawal", amount: 1, contact_id: "c1", description: "Ferhat: Cari tahsilat" })).toBe("Ortak aleyhine");
    expect(partnerTxLabel({ type: "withdrawal", amount: 1 })).toBe("Ortak aleyhine");
    expect(partnerTxLabel({ type: "withdrawal", amount: 1, description: "Virman → ortak" })).toBe("Ortak aleyhine");
    expect(partnerTxLabel({ type: "capital_in", amount: 1 })).toBe("Ortak lehine");
    expect(partnerTxLabel({ type: "capital_in", amount: 1, contact_id: "c1" })).toBe("Ortak lehine");
    expect(partnerTxLabel({ type: "salary", amount: 1 })).toBe("Ortak lehine");
    expect(partnerTxLabel({ type: "debit", amount: 1 })).toBe("Ortak aleyhine");
    expect(partnerTxLabel({ type: "profit_share", amount: 1, is_paid: false })).toBe("Ortak lehine");
    expect(partnerTxLabel({ type: "profit_share", amount: 1, is_paid: true })).toBe("Denk");
    expect(isPartnerExpenseTx({ expense_id: "e1" })).toBe(true);
    expect(isPartnerExpenseTx({ type: "credit" })).toBe(false);
    expect(partnerTxIsCashInflow({ type: "credit", amount: 1, expense_id: "e1" })).toBe(true);
    expect(partnerTxIsCashInflow({ type: "withdrawal", amount: 1, contact_id: "c1" })).toBe(false);
    expect(partnerTxSign("credit", { type: "credit", amount: 1, expense_id: "e1" })).toBe("+");
    expect(partnerTxSign("withdrawal", { type: "withdrawal", amount: 1, contact_id: "c1" })).toBe("-");
    expect(partnerTxLabel({
      type: "withdrawal",
      amount: 1,
      source: "bank_match",
      bank_tx_type: "outflow",
      description: "Vadesiz TL Hesabı: Banka Hareketi",
    })).toBe("Ortak aleyhine");
    expect(partnerTxIsCashInflow({
      type: "withdrawal",
      amount: 1,
      source: "bank_match",
      bank_tx_type: "outflow",
    })).toBe(false);
    expect(partnerTxSign("withdrawal", {
      type: "withdrawal",
      amount: 1,
      source: "bank_match",
      bank_tx_type: "outflow",
    })).toBe("-");
    expect(partnerTxLabel({
      type: "capital_in",
      amount: 1,
      source: "bank_match",
      bank_tx_type: "outflow",
    })).toBe("Ortak aleyhine");
    expect(partnerTxLabel({
      type: "capital_in",
      amount: 1,
      source: "bank_match",
      bank_tx_type: "inflow",
    })).toBe("Ortak lehine");
    expect(partnerTxLabel({
      type: "withdrawal",
      amount: 1,
      source: "bank_match",
      related_bank_tx_id: "btx1",
      description: "Vadesiz TL Hesabı: Banka Hareketi",
    })).toBe("Ortak aleyhine");
    expect(partnerTxEffect({ balance_delta: -40, side: "aleyhine", type: "credit" })).toEqual({ delta: -40, side: "aleyhine" });
  });

  it("bank outflow match reduces Alacaklı (856059.78 - 80000 = 776059.78)", () => {
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
    expect(partnerTxBalanceDelta(txs[2])).toBe(-80000);
    const br = partnerLedgerBreakdown(txs, 776059.78);
    expect(br.ledger).toBeCloseTo(776059.78, 2);
    expect(br.drift).toBe(false);
    expect(partnerTxLabel(txs[2])).toBe("Ortak aleyhine");
    expect(partnerBalanceMeta(776059.78).display).toBeCloseTo(-776059.78, 2);
  });

  it("Ali BAL: kart = Σ liste delta = lehine − aleyhine", () => {
    expect(partnerTxBalanceDelta(ALI_BAL_TXS[2])).toBe(-78400);
    expect(partnerTxBalanceDelta(ALI_BAL_TXS[5])).toBeCloseTo(705389.78, 2);
    expect(partnerTxBalanceDelta(ALI_BAL_TXS[6])).toBe(150000);
    expect(partnerTxBalanceDelta(ALI_BAL_TXS[7])).toBe(39200);
    expect(partnerTxBalanceDelta(ALI_BAL_TXS[12])).toBe(0);
    expect(partnerTxLabel(ALI_BAL_TXS[3])).toBe("Ortak aleyhine");
    expect(partnerTxLabel(ALI_BAL_TXS[5])).toBe("Ortak lehine");
    const br = partnerLedgerBreakdown(ALI_BAL_TXS, ALI_NET);
    expect(br.cashIn).toBeCloseTo(ALI_LEHINE, 2);
    expect(br.cashOut).toBeCloseTo(ALI_ALEYHINE, 2);
    expect(br.girisDisplay).toBeCloseTo(ALI_LEHINE, 2);
    expect(br.cikisDisplay).toBeCloseTo(-ALI_ALEYHINE, 2);
    expect(br.netDisplay).toBeCloseTo(ALI_NET, 2);
    expect(br.ledger).toBeCloseTo(ALI_NET, 2);
    expect(br.cardDisplay).toBeCloseTo(ALI_NET, 2);
    expect(br.cardPocket).toBeCloseTo(ALI_NET, 2);
    expect(br.netMatchesCard).toBe(true);
    expect(br.drift).toBe(false);
    expect(partnerBalanceMeta(br.cardPocket).badge).toBe("Alacaklı");
  });

  it("amber card uses the same balance presentation as partner balances", () => {
    const legacy = partnerSummaryCardMeta({ total_balance: -199822.37 });
    expect(legacy.badge).toBe("Borçlu");
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
    expect(cash.badge).toBe("Borçlu");
    expect(cash.display).toBeCloseTo(258082.37, 2);
  });

  it("selector uses Borçlu/Alacaklı instead of a sign", () => {
    const ali = partnerOptionLabel({ name: "Ali BAL", share_percent: 50, balance: -288340.22 });
    const mus = partnerOptionLabel({ name: "Mustafa Bal", share_percent: 50, balance: 30257.85 });
    expect(ali).toBe("Ali BAL (Ortak • %50 · 288.340,22 ₺ Borçlu)");
    expect(mus).toBe("Mustafa Bal (Ortak • %50 · 30.257,85 ₺ Alacaklı)");
    expect(ali).not.toContain("-");
    expect(mus).not.toContain("-");
  });

  it("shows only Alacaklı or Borçlu; Alacaklı display is negative", () => {
    const credit = partnerBalanceMeta(1200);
    expect(credit.label).toBe("Alacaklı");
    expect(credit.badge).toBe("Alacaklı");
    expect(credit.hint).toBe("");
    expect(credit.side).toBe("credit");
    expect(credit.display).toBe(-1200);

    const debit = partnerBalanceMeta(-705389.78);
    expect(debit.badge).toBe("Borçlu");
    expect(debit.label).toBe("Borçlu");
    expect(debit.hint).toBe("");
    expect(debit.side).toBe("debit");
    expect(debit.abs).toBeCloseTo(705389.78);
    expect(debit.display).toBeCloseTo(705389.78);

    expect(partnerBalanceMeta(0).badge).toBe("Denk");
    expect(partnerBalanceMeta(0).hint).toBe("");
    expect(partnerBalanceMeta(0).display).toBe(0);
  });
  it("treats credit like capital_in for balance", () => {
    expect(partnerTxIncreasesBalance("credit")).toBe(true);
    expect(partnerTxIncreasesBalance("capital_in")).toBe(true);
    expect(partnerTxSign("credit")).toBe("+");
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

  it("reconciles card balance to ledger buckets (688189.78 style)", () => {
    const txs = [
      { type: "capital_in", amount: 500000 },
      { type: "salary", amount: 150000 },
      { type: "credit", amount: 50000 },
      { type: "profit_share", amount: 20000, is_paid: false },
      { type: "withdrawal", amount: 31810.22 },
      { type: "profit_share", amount: 9000, is_paid: true },
    ];
    const ledger = 500000 + 150000 + 50000 + 20000 - 31810.22;
    expect(partnerTxBalanceDelta(txs[0])).toBe(500000);
    expect(partnerTxBalanceDelta(txs[5])).toBe(0);
    const br = partnerLedgerBreakdown(txs, ledger);
    expect(br.ledger).toBeCloseTo(688189.78, 2);
    expect(br.drift).toBe(false);
    expect(br.buckets.salary).toBe(150000);
    expect(br.buckets.profit_paid).toBe(9000);
    expect(br.girisDisplay).toBeCloseTo(500000 + 150000 + 50000 + 20000, 2);
    expect(br.cikisDisplay).toBeCloseTo(-31810.22, 2);
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

  it("treats monthly salary as Ortak lehine", () => {
    expect(PARTNER_TX_LABEL.salary).toBe("Ortak lehine");
    expect(partnerTxIncreasesBalance("salary")).toBe(true);
    expect(partnerTxIsCashInflow({ type: "salary", amount: 150000 })).toBe(true);
    expect(partnerTxSign("salary", { type: "salary", amount: 150000 })).toBe("+");
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
