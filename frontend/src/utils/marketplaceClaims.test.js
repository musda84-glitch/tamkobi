import {
  claimCanApprove,
  claimCanExpenseSlip,
  claimCanReject,
  claimCargoArrived,
  claimStatusLabel,
} from "./marketplaceClaims";

describe("marketplaceClaims", () => {
  it("labels WaitingInAction as cargo arrived", () => {
    expect(claimStatusLabel("WaitingInAction")).toBe("Kargo Ulaştı");
    expect(claimCargoArrived({ status: "WaitingInAction" })).toBe(true);
    expect(claimCargoArrived({ status: "Created" })).toBe(false);
    expect(claimCargoArrived({ items: [{ status: "WaitingInAction" }] })).toBe(true);
  });

  it("allows approve/reject only when cargo arrived and not closed", () => {
    expect(claimCanApprove({ status: "WaitingInAction" })).toBe(true);
    expect(claimCanReject({ status: "WaitingInAction" })).toBe(true);
    expect(claimCanApprove({ status: "Created" })).toBe(false);
    expect(claimCanApprove({ status: "Accepted", cargo_arrived: true })).toBe(false);
  });

  it("expense slip when arrived + invoice and not already issued", () => {
    expect(claimCanExpenseSlip({
      status: "WaitingInAction",
      invoice_id: "inv1",
      can_expense_slip: true,
    })).toBe(true);
    expect(claimCanExpenseSlip({
      status: "WaitingInAction",
      invoice_id: "inv1",
      expense_slip_id: "gp1",
    })).toBe(false);
    expect(claimCanExpenseSlip({ status: "Created", invoice_id: "inv1" })).toBe(false);
  });
});
