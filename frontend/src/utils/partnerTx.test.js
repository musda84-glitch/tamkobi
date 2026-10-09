import { isPartnerCashType, isPartnerExpenseTx, isPartnerLedgerType, partnerBalanceMeta, partnerLedgerBreakdown, partnerSalaryActionLabel, partnerSalaryCardText, partnerSalarySaveMessage, partnerTxBalanceDelta, partnerTxIncreasesBalance, partnerTxLabel, partnerTxSign, salaryDayOf, PARTNER_TX_LABEL } from "./partnerTx";

describe("partnerTx", () => {
  it("labels all partner txs as Giriş or Çıkış only", () => {
    expect(PARTNER_TX_LABEL.debit).toBe("Çıkış");
    expect(PARTNER_TX_LABEL.credit).toBe("Giriş");
    expect(partnerTxLabel({ type: "credit", expense_id: "e1" })).toBe("Giriş");
    expect(partnerTxLabel({ type: "credit", source: "expense" })).toBe("Giriş");
    expect(partnerTxIncreasesBalance("credit")).toBe(true);
    expect(partnerTxLabel({ type: "withdrawal" })).toBe("Çıkış");
    expect(partnerTxLabel({ type: "capital_in" })).toBe("Giriş");
    expect(partnerTxLabel({ type: "salary" })).toBe("Giriş");
    expect(partnerTxLabel({ type: "debit" })).toBe("Çıkış");
    expect(partnerTxLabel({ type: "profit_share", is_paid: false })).toBe("Giriş");
    expect(partnerTxLabel({ type: "profit_share", is_paid: true })).toBe("Çıkış");
    expect(isPartnerExpenseTx({ expense_id: "e1" })).toBe(true);
    expect(isPartnerExpenseTx({ type: "credit" })).toBe(false);
  });

  it("frames balance as money in the partner pocket", () => {
    const credit = partnerBalanceMeta(1200);
    expect(credit.label).toMatch(/cebindeki/i);
    expect(credit.badge).toMatch(/çekilebilir/i);
    expect(credit.hint).toMatch(/cebinde/i);
    expect(credit.side).toBe("credit");

    const debit = partnerBalanceMeta(-705389.78);
    expect(debit.badge).toMatch(/borçlu/i);
    expect(debit.label).toMatch(/eksi/i);
    expect(debit.hint).toMatch(/fazla çek/i);
    expect(debit.side).toBe("debit");
    expect(debit.abs).toBeCloseTo(705389.78);

    expect(partnerBalanceMeta(0).badge).toMatch(/denk/i);
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
      "Kaydedildi. 01.11.2026 tarihinde alacağa yazılacak.",
    );
    expect(partnerSalarySaveMessage({ posted_count: 1, message: "1 maaş kaydı ortak alacağına yazıldı." })).toBe(
      "1 maaş kaydı ortak alacağına yazıldı.",
    );
  });
});
