import { isPartnerCashType, isPartnerLedgerType, partnerTxIncreasesBalance, partnerTxSign, PARTNER_TX_LABEL } from "./partnerTx";

describe("partnerTx", () => {
  it("labels debit and credit slips", () => {
    expect(PARTNER_TX_LABEL.debit).toMatch(/borç/i);
    expect(PARTNER_TX_LABEL.credit).toMatch(/alacak/i);
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
    expect(isPartnerCashType("capital_in")).toBe(true);
    expect(isPartnerCashType("debit")).toBe(false);
  });
});
