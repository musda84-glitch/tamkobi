import { dateSortKey, expenseListDateLines, fmtDmy, fmtDmyTime } from "./dateFormat";
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

describe("fmtDmyTime", () => {
  it("formats ISO datetime with local clock", () => {
    expect(fmtDmyTime("2026-10-26")).toBe("26.10.2026");
    expect(fmtDmyTime("")).toBe("");
    // Sabit offset: yerel saate çevrilir; gün + HH:mm formu korunur
    const out = fmtDmyTime("2026-10-26T14:05:00+03:00");
    expect(out).toMatch(/^\d{2}\.\d{2}\.2026 \d{2}:\d{2}$/);
  });
});

describe("expenseListDateLines", () => {
  it("shows belge tarihi dmy and işlem with time", () => {
    const lines = expenseListDateLines({
      date: "2026-10-26",
      created_at: "2026-10-26T14:05:00+03:00",
    });
    expect(lines.date).toBe("26.10.2026");
    expect(lines.txn).toMatch(/\d{2}\.\d{2}\.2026 \d{2}:\d{2}/);
    expect(lines.txnLabel).toBe("İşlem");
  });

  it("omits txn when created_at missing", () => {
    expect(expenseListDateLines({ date: "2026-10-26" }).txn).toBe("");
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
