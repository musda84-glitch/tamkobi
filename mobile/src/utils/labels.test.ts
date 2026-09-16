import { channelTr, contactTypeTr, paymentMethodTr, statusTr } from "./labels";

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

  it("maps cari type and payment method", () => {
    expect(contactTypeTr("supplier")).toBe("Tedarikçi");
    expect(contactTypeTr("both")).toBe("Müşteri & Tedarikçi");
    expect(paymentMethodTr("transfer")).toBe("Havale/EFT");
  });
});
