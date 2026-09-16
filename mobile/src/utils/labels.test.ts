import { channelTr, contactTypeTr, leaveTr, paymentMethodTr, productTypeTr, statusTr } from "./labels";

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

  it("maps cari type and payment method", () => {
    expect(contactTypeTr("supplier")).toBe("Tedarikçi");
    expect(contactTypeTr("both")).toBe("Müşteri & Tedarikçi");
    expect(paymentMethodTr("transfer")).toBe("Havale/EFT");
  });

  it("maps product types", () => {
    expect(productTypeTr("raw_material")).toBe("Hammadde");
    expect(productTypeTr("finished_good")).toBe("Mamul");
  });
});
