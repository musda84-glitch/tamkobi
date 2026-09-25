import { findWorkPark, findOfficeTaskType, officeTaskPayload, parkSelectGroups, officeTaskTypeSelectGroups, stationNamesFromParks, validateOfficeTaskAssign, normalizeWorkParks, normalizeOfficeTaskTypes } from "./workParks";

describe("work parks vs office task types", () => {
  it("normalizes parks and office types separately", () => {
    const parks = normalizeWorkParks(["Makina parkuru", { id: "p2", name: "Kaynak" }]);
    expect(parks[0].name).toBe("Makina parkuru");
    expect(findWorkPark(parks, "p2")?.name).toBe("Kaynak");
    const types = normalizeOfficeTaskTypes(["CNC bakım", { id: "t1", name: "Ambar sayım" }]);
    expect(findOfficeTaskType(types, "t1")?.name).toBe("Ambar sayım");
    expect(parkSelectGroups(parks)[0].options.map((o) => o.label)).toEqual(["Makina parkuru", "Kaynak"]);
    expect(officeTaskTypeSelectGroups(types)[0].label).toBe("İç görevler");
  });

  it("builds office task payload from task type", () => {
    expect(officeTaskPayload({ id: "t2", name: "Ambar" }, "")).toEqual({
      task_type_id: "t2",
      task_type_name: "Ambar",
      park_id: "t2",
      park_name: "Ambar",
      title: "Ambar",
    });
    expect(validateOfficeTaskAssign("")).toMatch(/İç görev/);
    expect(validateOfficeTaskAssign("t2")).toBeNull();
  });

  it("station names come from parks only", () => {
    expect(stationNamesFromParks([{ id: "a", name: "CNC" }], ["X"])).toEqual(["CNC"]);
    expect(stationNamesFromParks([], ["X", "Y"])).toEqual(["X", "Y"]);
  });
});
