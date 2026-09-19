import { employeeReceivableAmount, unpaidPayrollTotal } from "./employeeReceivable";

describe("employeeReceivableAmount", () => {
  const emp = {
    id: "e1",
    balance: { remaining: 0, unpaid_payroll: 0 },
  };

  it("adds unpaid generated payroll when API remaining is still 0", () => {
    const payrolls = [
      { employee_id: "e1", status: "pending", final_payable: 2800.75, net_salary: 2800.75 },
    ];
    expect(unpaidPayrollTotal(payrolls, emp)).toBe(2800.75);
    expect(employeeReceivableAmount(emp, payrolls)).toBe(2800.75);
  });

  it("does not double-count payroll already in API remaining", () => {
    const withBal = { id: "e1", balance: { remaining: 2800.75, unpaid_payroll: 2800.75 } };
    const payrolls = [
      { employee_id: "e1", status: "pending", final_payable: 2800.75 },
    ];
    expect(employeeReceivableAmount(withBal, payrolls)).toBe(2800.75);
  });

  it("ignores paid payrolls", () => {
    const payrolls = [
      { employee_id: "e1", status: "paid", final_payable: 2800.75 },
    ];
    expect(employeeReceivableAmount(emp, payrolls)).toBe(0);
  });
});
