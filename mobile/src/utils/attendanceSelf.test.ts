import { earlyLeavePayload, validateEarlyLeave } from "./attendanceSelf";

describe("early leave request", () => {
  it("requires a reason and optional HH:MM", () => {
    expect(validateEarlyLeave("ab")).toBe("Erken çıkış nedeni en az 3 karakter olmalı.");
    expect(validateEarlyLeave("doktor", "9")).toBe("Planlanan saat HH:MM formatında olmalı.");
    expect(validateEarlyLeave("doktor randevusu", "14:30")).toBeNull();
    expect(validateEarlyLeave("doktor randevusu", "14:30:00")).toBeNull();
    expect(earlyLeavePayload(" doktor ", "14:30")).toEqual({
      reason: "doktor",
      planned_time: "14:30",
    });
    expect(earlyLeavePayload("doktor", "9:05:00")).toEqual({ reason: "doktor", planned_time: "09:05" });
    expect(earlyLeavePayload("doktor", "")).toEqual({ reason: "doktor" });
  });
});
