import { intradayLeaveMinutes, intradayLeavePayload, validateIntradayLeave } from "./intradayLeave";

describe("validateIntradayLeave", () => {
  test("requires reason and both times", () => {
    expect(validateIntradayLeave("ab", "14:00", "16:00")).toMatch(/neden/);
    expect(validateIntradayLeave("doktor randevusu", "", "16:00")).toMatch(/Çıkış saati/);
    expect(validateIntradayLeave("doktor randevusu", "14:00", "")).toMatch(/Dönüş/);
    expect(validateIntradayLeave("doktor randevusu", "16:00", "14:00")).toMatch(/sonra/);
    expect(validateIntradayLeave("doktor randevusu", "14:00", "16:00")).toBeNull();
  });
});

describe("intradayLeavePayload / minutes", () => {
  test("normalizes HH:MM and duration", () => {
    expect(intradayLeavePayload(" doktor ", "9:05", "11:00")).toEqual({
      reason: "doktor",
      out_time: "09:05",
      return_time: "11:00",
    });
    expect(intradayLeaveMinutes("14:00", "16:30")).toBe(150);
    expect(intradayLeaveMinutes("14:00", "14:00")).toBeNull();
  });
});
