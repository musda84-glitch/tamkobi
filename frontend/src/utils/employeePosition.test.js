import { positionOptionsFromRoles } from "./employeePosition";

describe("positionOptionsFromRoles", () => {
  it("maps role names and keeps a legacy current value", () => {
    const roles = [
      { code: "production", name: "Üretim" },
      { code: "sales", name: "Satış" },
      { code: "dup", name: "Satış" },
    ];
    expect(positionOptionsFromRoles(roles).map((o) => o.value)).toEqual(["Üretim", "Satış"]);
    expect(positionOptionsFromRoles(roles, "Uzman")[0]).toEqual({ value: "Uzman", label: "Uzman (kayıtlı)", code: "" });
    expect(positionOptionsFromRoles(roles, "Üretim").some((o) => o.label.includes("kayıtlı"))).toBe(false);
  });
});
