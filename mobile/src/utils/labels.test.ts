import { channelTr, leaveTr, statusTr } from "./labels";

describe("labels", () => {
  it("maps known statuses", () => {
    expect(statusTr("pending")).toBe("Beklemede");
    expect(statusTr("shipped")).toBe("Kargolandı");
    expect(statusTr("")).toBe("—");
    expect(statusTr("custom_x")).toBe("custom_x");
  });

  it("maps channels", () => {
    expect(channelTr("saha")).toBe("Saha");
    expect(channelTr("trendyol")).toBe("Trendyol");
  });

  it("maps leave and bonus-like statuses", () => {
    expect(leaveTr("annual")).toBe("Yıllık");
    expect(leaveTr("sick")).toBe("Hastalık");
    expect(statusTr("advance")).toBe("Avans");
    expect(statusTr("in_progress")).toBe("Devam");
  });
});
