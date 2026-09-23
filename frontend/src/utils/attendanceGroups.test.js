import { attendanceGroupToggleLabel, attendanceRecordsForEmployee, groupAttendanceRecords } from "./attendanceGroups";

describe("attendanceGroups", () => {
  it("groups records by employee and sorts newest first", () => {
    const grouped = groupAttendanceRecords([
      { id: "2", employee_id: "e1", employee_name: "Ali", date: "2026-09-20" },
      { id: "1", employee_id: "e2", employee_name: "Zeynep", date: "2026-09-21" },
      { id: "3", employee_id: "e1", employee_name: "Ali", date: "2026-09-23" },
    ]);
    expect(grouped.map((g) => g.employee_name)).toEqual(["Ali", "Zeynep"]);
    expect(grouped[0].records.map((r) => r.id)).toEqual(["3", "2"]);
    expect(attendanceRecordsForEmployee(grouped.flatMap((g) => g.records), "e2").map((r) => r.id)).toEqual(["1"]);
  });

  it("labels the hideable group toggle", () => {
    expect(attendanceGroupToggleLabel(false, 4)).toBe("Kayıtlar (4)");
    expect(attendanceGroupToggleLabel(true, 4)).toBe("Kayıtları gizle (4)");
  });
});
