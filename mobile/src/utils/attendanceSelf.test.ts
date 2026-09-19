import { checkoutConfirmMessage, earlyLeavePayload, validateEarlyLeave, validateIntradayLeave, intradayLeavePayload } from "./attendanceSelf";

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

describe("intraday leave request", () => {
  it("requires reason and out/return times with return after out", () => {
    expect(validateIntradayLeave("ab", "14:00", "16:00")).toMatch(/neden/);
    expect(validateIntradayLeave("doktor randevusu", "14", "16:00")).toMatch(/Çıkış saati/);
    expect(validateIntradayLeave("doktor randevusu", "16:00", "14:00")).toMatch(/sonra/);
    expect(validateIntradayLeave("doktor randevusu", "14:00", "16:30")).toBeNull();
    expect(intradayLeavePayload(" doktor ", "9:05", "11:00")).toEqual({
      reason: "doktor",
      out_time: "09:05",
      return_time: "11:00",
    });
  });
});

describe("checkoutConfirmMessage", () => {
  it("warns that checkout cannot be undone and mentions check-in when known", () => {
    expect(checkoutConfirmMessage("12:25")).toContain("giriş 12:25");
    expect(checkoutConfirmMessage("12:25")).toMatch(/geri alınamaz/);
    expect(checkoutConfirmMessage("")).toMatch(/Yanlışlıkla bastıysanız vazgeçin/);
    expect(checkoutConfirmMessage(null)).not.toContain("giriş");
  });
});
