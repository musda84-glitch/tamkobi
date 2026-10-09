import { isPartnerCashType, isPartnerExpenseTx, isPartnerLedgerType, partnerBalanceMeta, partnerLedgerBreakdown, partnerSalaryActionLabel, partnerSalaryCardText, partnerSalarySaveMessage, partnerTxBalanceDelta, partnerTxIncreasesBalance, partnerTxIsCashInflow, partnerTxLabel, partnerTxSign, salaryDayOf, PARTNER_TX_LABEL } from "./partnerTx";

describe("partnerTx", () => {
  it("labels txs by cash direction (masraf=Çıkış, tahsilat=Giriş)", () => {
    expect(PARTNER_TX_LABEL.debit).toBe("Çıkış");
    expect(PARTNER_TX_LABEL.credit).toBe("Çıkış");
    // Masraf / alacak fişi: ortak bakiyesi artar ama kasa yönü Çıkış (−)
    expect(partnerTxLabel({ type: "credit", expense_id: "e1" })).toBe("Çıkış");
    expect(partnerTxLabel({ type: "credit", source: "expense" })).toBe("Çıkış");
    expect(partnerTxLabel({ type: "credit", description: "Ortak Alacak Fişi" })).toBe("Çıkış");
    expect(partnerTxIsCashInflow({ type: "credit" })).toBe(false);
    expect(partnerTxSign("credit", { type: "credit" })).toBe("-");
    expect(partnerTxIncreasesBalance("credit")).toBe(true);
    // Cari tahsilat → ortak: bakiye azalır ama işlem Giriş
    expect(partnerTxLabel({ type: "withdrawal", contact_id: "c1", description: "Ferhat: Cari tahsilat" })).toBe("Giriş");
    // Virman / düz para çek: Çıkış
    expect(partnerTxLabel({ type: "withdrawal" })).toBe("Çıkış");
    expect(partnerTxLabel({ type: "withdrawal", description: "Virman → ortak" })).toBe("Çıkış");
    expect(partnerTxLabel({ type: "capital_in" })).toBe("Giriş");
    expect(partnerTxLabel({ type: "capital_in", contact_id: "c1" })).toBe("Çıkış");
    expect(partnerTxLabel({ type: "salary" })).toBe("Giriş");
    expect(partnerTxLabel({ type: "debit" })).toBe("Çıkış");
    expect(partnerTxLabel({ type: "profit_share", is_paid: false })).toBe("Giriş");
    expect(partnerTxLabel({ type: "profit_share", is_paid: true })).toBe("Çıkış");
    expect(isPartnerExpenseTx({ expense_id: "e1" })).toBe(true);
    expect(isPartnerExpenseTx({ type: "credit" })).toBe(false);
    expect(partnerTxIsCashInflow({ type: "credit", expense_id: "e1" })).toBe(false);
    expect(partnerTxIsCashInflow({ type: "withdrawal", contact_id: "c1" })).toBe(true);
    expect(partnerTxSign("credit", { type: "credit", expense_id: "e1" })).toBe("-");
    expect(partnerTxSign("withdrawal", { type: "withdrawal", contact_id: "c1" })).toBe("+");
    // Banka eşleşmesi: Vadesiz çıkışı → ortak cebine Giriş (ekstrenin tersi)
    expect(partnerTxLabel({
      type: "capital_in",
      source: "bank_match",
      bank_tx_type: "outflow",
      description: "Vadesiz TL Hesabı: Banka Hareketi",
    })).toBe("Giriş");
    expect(partnerTxIsCashInflow({
      type: "capital_in",
      source: "bank_match",
      bank_tx_type: "outflow",
    })).toBe(true);
    expect(partnerTxSign("capital_in", {
      type: "capital_in",
      source: "bank_match",
      bank_tx_type: "outflow",
    })).toBe("+");
    // Eski yanlış tip (withdrawal + outflow) bile bank_tx_type ile Giriş olmalı
    expect(partnerTxLabel({
      type: "withdrawal",
      source: "bank_match",
      bank_tx_type: "outflow",
    })).toBe("Giriş");
    expect(partnerTxLabel({
      type: "withdrawal",
      source: "bank_match",
      bank_tx_type: "inflow",
    })).toBe("Çıkış");
    // bank_tx_type yoksa tip geçerli (yeni: outflow→capital_in = Giriş)
    expect(partnerTxLabel({
      type: "capital_in",
      source: "bank_match",
      related_bank_tx_id: "btx1",
      description: "Vadesiz TL Hesabı: Banka Hareketi",
    })).toBe("Giriş");
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
    expect(partnerTxSign("profit_share", { is_paid: false })).toBe("+");
    expect(partnerTxIncreasesBalance("profit_share", { is_paid: true })).toBe(false);
    expect(partnerTxSign("profit_share", { is_paid: true })).toBe("-");
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
    expect(br.inflow).toBeCloseTo(500000 + 150000 + 50000 + 20000, 2);
    expect(br.outflow).toBeCloseTo(31810.22 + 9000, 2);
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

  it("treats monthly salary like pocket inflow (Giriş)", () => {
    expect(PARTNER_TX_LABEL.salary).toBe("Giriş");
    expect(partnerTxIncreasesBalance("salary")).toBe(true);
    expect(partnerTxSign("salary")).toBe("+");
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
