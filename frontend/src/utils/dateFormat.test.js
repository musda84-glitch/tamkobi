import { fmtDmy } from "./dateFormat";

describe("fmtDmy", () => {
  it("prints ISO days as gün.ay.yıl", () => {
    expect(fmtDmy("2026-09-23")).toBe("23.09.2026");
    expect(fmtDmy("2026-09-23T12:38:00")).toBe("23.09.2026");
    expect(fmtDmy("")).toBe("—");
  });
});
