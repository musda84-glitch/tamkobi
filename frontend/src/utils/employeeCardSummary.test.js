import {
  empStatusLabel,
  formatTrDate,
  performanceTone,
  remainingTone,
} from "./employeeCardSummary";

describe("employee card summary helpers", () => {
  it("labels status and formats TR dates", () => {
    expect(empStatusLabel("active")).toBe("Aktif");
    expect(empStatusLabel("terminated")).toBe("İşten ayrıldı");
    expect(empStatusLabel("on_leave")).toBe("İzinli");
    expect(formatTrDate("2026-09-19")).toBe("19.09.2026");
    expect(formatTrDate("")).toBe("—");
    expect(formatTrDate(null)).toBe("—");
  });

  it("tones performance and remaining receivable", () => {
    expect(performanceTone(100)).toBe("emerald");
    expect(performanceTone(80)).toBe("emerald");
    expect(performanceTone(50)).toBe("amber");
    expect(performanceTone(10)).toBe("rose");
    expect(remainingTone(1500)).toBe("emerald");
    expect(remainingTone(0)).toBe("slate");
    expect(remainingTone(-200)).toBe("rose");
  });
});
