import { findWorkPark, officeTaskPayload, parkSelectGroups, stationNamesFromParks, validateOfficeTaskAssign, normalizeWorkParks } from "./workParks";

describe("work parks", () => {
  it("normalizes and validates office assign", () => {
    const parks = normalizeWorkParks(["Makina parkuru", { id: "p2", name: "Kaynak" }]);
    expect(parks[0].name).toBe("Makina parkuru");
    expect(findWorkPark(parks, "p2")?.name).toBe("Kaynak");
    expect(validateOfficeTaskAssign("")).toBe("Parkur seçin.");
    expect(validateOfficeTaskAssign("p2")).toBeNull();
    expect(officeTaskPayload({ id: "p2", name: "Kaynak" }, "")).toEqual({
      park_id: "p2", park_name: "Kaynak", title: "Kaynak",
    });
    expect(parkSelectGroups(parks)[0].options.map((o) => o.label)).toEqual(["Makina parkuru", "Kaynak"]);
    expect(stationNamesFromParks([{ name: "Genel" }, "OEMAK", { name: "OMAKSAN" }, "oemak"])).toEqual(["Genel", "OEMAK", "OMAKSAN"]);
    expect(stationNamesFromParks([], ["Montaj Hattı 1", "QC"])).toEqual(["Montaj Hattı 1", "QC"]);
    expect(stationNamesFromParks(["Genel"], ["QC", "Genel"])).toEqual(["Genel"]);
  });
});
