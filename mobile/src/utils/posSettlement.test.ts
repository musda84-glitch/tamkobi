import { formatTrAmount } from "./money";
import {
  POS_COMMISSION_CATEGORY,
  calcCommission,
  commissionRate,
  formatSummary,
  grossFromRate,
  isPosAccount,
  round2,
  validatePosSettlement,
} from "./posSettlement";

describe("round2", () => {
  it("rounds to kuruş and rejects non-numbers", () => {
    expect(round2(10)).toBe(10);
    expect(round2(1.234)).toBe(1.23);
    expect(round2(1.236)).toBe(1.24);
    expect(round2("12.3")).toBe(12.3);
    expect(round2(NaN)).toBeNaN();
    expect(round2("x")).toBeNaN();
    expect(round2(null)).toBe(0);
    expect(round2(undefined)).toBeNaN();
  });
});

describe("calcCommission", () => {
  it("is the rounded difference of gross and net", () => {
    expect(calcCommission(49000, 47168.38)).toBe(1831.62);
    expect(calcCommission(100, 90)).toBe(10);
    expect(calcCommission(100, 100)).toBe(0);
    expect(calcCommission("x", 10)).toBeNaN();
    expect(calcCommission(10, null)).toBe(10);
  });
});

describe("grossFromRate", () => {
  it("divides net by one minus the rate", () => {
    expect(grossFromRate(47168.38, 0.03738)).toBe(49000);
    expect(grossFromRate(100, 0.1)).toBe(111.11);
  });

  it("keeps net when the rate is 0, negative, or at least 1", () => {
    expect(grossFromRate(80, 0)).toBe(80);
    expect(grossFromRate(80, -0.2)).toBe(80);
    expect(grossFromRate(80, 1)).toBe(80);
    expect(grossFromRate(80, 1.5)).toBe(80);
    expect(grossFromRate(80, Number.NaN)).toBe(80);
    expect(grossFromRate("yok", 0.1)).toBeNaN();
  });
});

describe("commissionRate", () => {
  it("returns commission over gross, or 0 when gross is not positive", () => {
    expect(commissionRate(100, 10)).toBe(0.1);
    expect(commissionRate(49000, 1831.62)).toBeCloseTo(1831.62 / 49000);
    expect(commissionRate(0, 10)).toBe(0);
    expect(commissionRate(-5, 1)).toBe(0);
    expect(commissionRate(Number.NaN, 1)).toBe(0);
    expect(commissionRate(10, Number.NaN)).toBe(0);
  });
});

describe("validatePosSettlement", () => {
  const ok = {
    gross: 49000,
    net: 47168.38,
    commission: 1831.62,
    posBalance: 49000,
    isInflow: true,
  };

  it("lists every error message", () => {
    expect(validatePosSettlement({ ...ok, isInflow: false })).toContain(
      "POS bloke çözümü yalnızca giriş hareketlerinde yapılabilir.",
    );
    expect(validatePosSettlement({ ...ok, gross: "" })).toContain("Brüt tutar girin.");
    expect(validatePosSettlement({ ...ok, gross: null })).toContain("Brüt tutar girin.");
    expect(validatePosSettlement({ ...ok, net: "" })).toContain("Bankaya gelen tutar geçersiz.");
    expect(validatePosSettlement({ ...ok, net: null })).toContain("Bankaya gelen tutar geçersiz.");
    expect(validatePosSettlement({ ...ok, commission: "" })).toContain("Komisyon girin.");
    expect(validatePosSettlement({ ...ok, commission: null })).toContain("Komisyon girin.");
    expect(validatePosSettlement({ ...ok, gross: 50, net: 90, commission: 0 })).toContain(
      "Brüt tutar bankaya gelen tutardan küçük olamaz.",
    );
    expect(validatePosSettlement({ ...ok, commission: -1 })).toContain("Komisyon negatif olamaz.");
    expect(validatePosSettlement({ ...ok, gross: 50000, posBalance: 49000 })).toContain(
      "Brüt tutar POS bakiyesini aşıyor.",
    );
  });

  it("accepts a settlement inside the 0.005 tolerance and skips an empty balance", () => {
    expect(validatePosSettlement(ok)).toEqual([]);
    expect(validatePosSettlement({ ...ok, gross: 100, net: 100, commission: 0, posBalance: 100 })).toEqual([]);
    expect(validatePosSettlement({
      gross: 100,
      net: 99.996,
      commission: 0.004,
      posBalance: 100.004,
      isInflow: true,
    })).toEqual([]);
    expect(validatePosSettlement({ ...ok, posBalance: null })).toEqual([]);
    expect(validatePosSettlement({ ...ok, posBalance: "" })).toEqual([]);
  });
});

describe("formatSummary", () => {
  it("uses the TR money formatter for gross and net", () => {
    const text = formatSummary({ posName: "Sanal POS", gross: 49000, net: 47168.38 });
    expect(text).toBe(
      `Sanal POS −${formatTrAmount(49000)} · Banka +${formatTrAmount(47168.38)} · Masraf komisyon`,
    );
    expect(text).toContain("Sanal POS");
    expect(text).toContain("Banka");
    expect(text).toContain("Masraf komisyon");
  });

  it("falls back to POS when the account name is blank", () => {
    expect(formatSummary({ posName: "  ", gross: 1, net: 2 })).toBe(
      `POS −${formatTrAmount(1)} · Banka +${formatTrAmount(2)} · Masraf komisyon`,
    );
  });
});

describe("isPosAccount", () => {
  it("accepts only pos and okc_pos", () => {
    expect(POS_COMMISSION_CATEGORY).toBe("POS Komisyonu");
    expect(isPosAccount({ type: "pos" })).toBe(true);
    expect(isPosAccount({ type: "okc_pos" })).toBe(true);
    expect(isPosAccount({ type: "bank" })).toBe(false);
    expect(isPosAccount({ type: "cash_box" })).toBe(false);
    expect(isPosAccount({ type: "" })).toBe(false);
    expect(isPosAccount(null)).toBe(false);
    expect(isPosAccount(undefined)).toBe(false);
  });
});
