import {
  asContactList,
  canUploadBankStatement,
  defaultStatementKind,
  isCardAccount,
  isStatementFile,
  resolveStatementFile,
  statementAmountPositive,
  statementRowsFromPayload,
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

  it("does not treat a click event as the uploaded file", () => {
    const pdf = new File(["ekstre"], "hareket.pdf", { type: "application/pdf" });
    const clickEvent = { type: "click", target: {}, preventDefault() {} };
    expect(isStatementFile(clickEvent)).toBe(false);
    expect(resolveStatementFile(clickEvent, pdf)).toBe(pdf);
    expect(resolveStatementFile(pdf, null)).toBe(pdf);
    expect(resolveStatementFile(clickEvent, null)).toBe(null);
  });

  it("normalizes AI payloads missing statement or transactions so render cannot throw", () => {
    expect(statementRowsFromPayload(null, false)).toEqual({ statement: {}, rows: [], filename: "", mode: "" });
    expect(statementRowsFromPayload("ok", false).statement).toEqual({});
    const parsed = statementRowsFromPayload({ transactions: [{ date: "2026-01-02", description: "EFT", amount: -40 }] }, false);
    expect(parsed.statement.bank).toBeUndefined();
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].kind).toBe("islem");
    expect(statementRowsFromPayload({ statement: null, transactions: { length: 3 } }, false).rows).toEqual([]);
  });

  it("keeps contacts as an array even when the parent passes null", () => {
    expect(asContactList(null)).toEqual([]);
    expect(asContactList([{ id: "c1" }])).toEqual([{ id: "c1" }]);
  });
});
