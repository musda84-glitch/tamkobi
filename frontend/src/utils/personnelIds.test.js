import { empIdOf } from "./personnelIds";

describe("empIdOf", () => {
  test("prefers employee_id so request/payroll rows match the person", () => {
    expect(empIdOf({ id: "req_1", employee_id: "emp_9" })).toBe("emp_9");
    expect(empIdOf({ _id: "pay_1", employee_id: "emp_9" })).toBe("emp_9");
  });

  test("falls back to id for employee cards", () => {
    expect(empIdOf({ id: "emp_9", full_name: "Ali" })).toBe("emp_9");
    expect(empIdOf({ _id: "emp_8" })).toBe("emp_8");
  });
});
