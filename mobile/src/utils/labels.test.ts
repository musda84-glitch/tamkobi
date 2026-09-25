import { channelLogoUrl, channelTr, contactTypeTr, eTypeTr, invoiceTypeTr, isMarketplaceChannel, leaveTr, orderNumberLabel, paymentMethodTr, productTypeTr, punchLabelColor, punchLabelTone, statusTr, tradeKindTr, trUpper } from "./labels";

describe("labels", () => {
  it("uppercases Turkish i/ı for form labels", () => {
    expect(trUpper("Miktar")).toBe("MİKTAR");
    expect(trUpper("Birim fiyat")).toBe("BİRİM FİYAT");
    expect(trUpper("indir")).toBe("İNDİR");
    expect(trUpper("PDF indir")).toBe("PDF İNDİR");
    expect("Miktar".toUpperCase()).toBe("MIKTAR");
    expect(punchLabelTone("Çıkış saati düzelt")).toBe("out");
    expect(punchLabelTone("Giriş saati")).toBe("in");
    expect(punchLabelTone("GİRİŞ")).toBe("in");
    expect(punchLabelTone("Planlanan saat")).toBeNull();
    expect(punchLabelColor("Çıkış")).toBe("#BE123C");
    expect(punchLabelColor("Giriş")).toBe("#047857");
  });

  it("maps known statuses", () => {
    expect(statusTr("pending")).toBe("Beklemede");
    expect(statusTr("shipped")).toBe("Kargolandı");
    expect(statusTr("present")).toBe("Geldi");
    expect(statusTr("absent")).toBe("Gelmedi");
    expect(statusTr("leave")).toBe("İzinli");
    expect(statusTr("")).toBe("—");
    expect(statusTr("custom_x")).toBe("custom_x");
  });

  it("maps channels", () => {
    expect(channelTr("saha")).toBe("Saha");
    expect(channelTr("trendyol")).toBe("Trendyol");
  });

  it("labels order numbers and marketplace logos", () => {
    expect(orderNumberLabel({ order_number: "11573451170", channel: "trendyol" })).toBe("Trendyol sipariş no 11573451170");
    expect(orderNumberLabel({ order_number: "SO-1", channel: "manual" })).toBe("Sipariş no SO-1");
    expect(orderNumberLabel({ order_number: "B2B-1", channel: "b2b" })).toBe("B2B sipariş no B2B-1");
    expect(orderNumberLabel({})).toBe("Sipariş");
    expect(isMarketplaceChannel("trendyol")).toBe(true);
    expect(isMarketplaceChannel("saha")).toBe(false);
    expect(channelLogoUrl("trendyol")).toContain("dsmcdn");
  });

  it("maps leave and bonus-like statuses", () => {
    expect(leaveTr("annual")).toBe("Yıllık");
    expect(leaveTr("sick")).toBe("Hastalık");
    expect(statusTr("advance")).toBe("Avans");
    expect(statusTr("in_progress")).toBe("Devam");
    expect(statusTr("planning")).toBe("Planlama");
    expect(statusTr("quoted")).toBe("Teklife Dönüştü");
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

  it("maps invoice and e-belge types", () => {
    expect(invoiceTypeTr("dispatch")).toBe("İrsaliye");
    expect(eTypeTr("e_export")).toBe("e-İhracat");
    expect(tradeKindTr("import")).toBe("İthalat");
  });
});
