import { isPartnerCashType, isPartnerExpenseTx, isPartnerLedgerType, partnerBalanceMeta, partnerSalaryActionLabel, partnerSalaryCardText, partnerSalarySaveMessage, partnerTxIncreasesBalance, partnerTxLabel, partnerTxSign, salaryDayOf, PARTNER_TX_LABEL } from "./partnerTx";

describe("partnerTx", () => {
  it("labels debit and credit slips", () => {
    expect(PARTNER_TX_LABEL.debit).toMatch(/borç/i);
    expect(PARTNER_TX_LABEL.credit).toMatch(/alacak/i);
  });

  it("labels partner-paid company expense as Masraf Ödemesi (credit / alacak)", () => {
    expect(partnerTxLabel({ type: "credit", expense_id: "e1" })).toBe("Masraf Ödemesi");
    expect(partnerTxLabel({ type: "credit", source: "expense" })).toBe("Masraf Ödemesi");
    expect(partnerTxIncreasesBalance("credit")).toBe(true);
    expect(partnerTxLabel({ type: "withdrawal" })).toBe("Para Çekişi");
    expect(partnerTxLabel({ type: "capital_in" })).toBe("Sermaye Girişi");
    expect(isPartnerExpenseTx({ expense_id: "e1" })).toBe(true);
    expect(isPartnerExpenseTx({ type: "credit" })).toBe(false);
  });

  it("explains partner balance sign for company vs partner", () => {
    const credit = partnerBalanceMeta(1200);
    expect(credit.badge).toMatch(/alacaklı/i);
    expect(credit.hint).toMatch(/şirket/i);
    expect(credit.side).toBe("credit");

    const debit = partnerBalanceMeta(-705389.78);
    expect(debit.badge).toMatch(/borçlu/i);
    expect(debit.label).toMatch(/borcu/i);
    expect(debit.hint).toMatch(/kasa alacaklı/i);
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

  it("classifies ledger vs cash types", () => {
    expect(isPartnerLedgerType("debit")).toBe(true);
    expect(isPartnerLedgerType("credit")).toBe(true);
    expect(isPartnerLedgerType("salary")).toBe(true);
    expect(isPartnerCashType("capital_in")).toBe(true);
    expect(isPartnerCashType("debit")).toBe(false);
    expect(isPartnerCashType("salary")).toBe(false);
  });

  it("treats monthly salary like a receivable credit", () => {
    expect(PARTNER_TX_LABEL.salary).toMatch(/maaş/i);
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
