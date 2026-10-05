import {
  canUploadBankStatement,
  defaultStatementKind,
  isCardAccount,
  statementAmountPositive,
} from "./bankStatementUpload";

describe("bankStatementUpload", () => {
  it("shows AI upload only on non-integrated non-card accounts", () => {
    expect(canUploadBankStatement({ type: "bank", is_integrated: false })).toBe(true);
    expect(canUploadBankStatement({ type: "cash_box" })).toBe(true);
    expect(canUploadBankStatement({ type: "pos", is_integrated: false })).toBe(true);
    expect(canUploadBankStatement({ type: "bank", is_integrated: true })).toBe(false);
    expect(canUploadBankStatement({ type: "credit_card", is_integrated: false })).toBe(false);
    expect(canUploadBankStatement(null)).toBe(false);
  });

  it("defaults bank lines to islem unless a contact is suggested", () => {
    expect(defaultStatementKind({ amount: -250, description: "EFT" }, false)).toBe("islem");
    expect(defaultStatementKind({ amount: 1000, suggested_contact_id: "c1" }, false)).toBe("cari_odeme");
    expect(defaultStatementKind({ amount: 80 }, true)).toBe("masraf");
    expect(defaultStatementKind({ amount: -50 }, true)).toBe("islem");
  });

  it("colors inflows green on bank, refunds green on card", () => {
    expect(isCardAccount({ type: "credit_card" })).toBe(true);
    expect(statementAmountPositive(100, false)).toBe(true);
    expect(statementAmountPositive(-25, false)).toBe(false);
    expect(statementAmountPositive(-50, true)).toBe(true);
    expect(statementAmountPositive(80, true)).toBe(false);
  });
});
