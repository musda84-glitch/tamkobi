import { dateSortKey, fmtDmy } from "./dateFormat";
import { fmtDate } from "./money";

describe("fmtDmy", () => {
  it("prints ISO days as gün.ay.yıl", () => {
    expect(fmtDmy("2026-09-23")).toBe("23.09.2026");
    expect(fmtDmy("2026-09-23T12:38:00")).toBe("23.09.2026");
    expect(fmtDmy("")).toBe("—");
    expect(fmtDate("2026-09-21")).toBe("21.09.2026");
  });

  it("normalizes already-dmy and slash dates", () => {
    expect(fmtDmy("22.09.2026")).toBe("22.09.2026");
    expect(fmtDmy("2.9.2026")).toBe("02.09.2026");
    expect(fmtDmy("22/09/2026")).toBe("22.09.2026");
  });
});

describe("dateSortKey", () => {
  it("normalizes ISO and DMY to YYYY-MM-DD for chronological compare", () => {
    expect(dateSortKey("2026-10-03")).toBe("2026-10-03");
    expect(dateSortKey("22.09.2026")).toBe("2026-09-22");
    expect(dateSortKey("3.10.2026")).toBe("2026-10-03");
    expect(dateSortKey("15/10/2026")).toBe("2026-10-15");
    expect(dateSortKey("")).toBe("");
  });
});
