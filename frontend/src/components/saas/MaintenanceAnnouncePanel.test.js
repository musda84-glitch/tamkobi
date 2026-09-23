import { pickDemoCompany } from "./MaintenanceAnnouncePanel";

describe("pickDemoCompany", () => {
  it("prefers exact DEMO name", () => {
    const rows = [
      { id: "1", name: "Demo Shop" },
      { id: "2", name: "DEMO" },
      { id: "3", name: "Acme" },
    ];
    expect(pickDemoCompany(rows)?.id).toBe("2");
  });

  it("falls back to name containing demo", () => {
    const rows = [
      { id: "1", name: "Acme" },
      { id: "2", name: "Demo Test AŞ" },
    ];
    expect(pickDemoCompany(rows)?.id).toBe("2");
  });

  it("returns null when none", () => {
    expect(pickDemoCompany([{ id: "1", name: "Acme" }])).toBeNull();
    expect(pickDemoCompany([])).toBeNull();
  });
});
