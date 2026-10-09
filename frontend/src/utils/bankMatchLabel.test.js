import { matchActorTitle, matchStatusLabel, matchTargetLabel, txCreatedByLabel, txDescriptionLabel } from "./bankMatchLabel";

describe("bankMatchLabel", () => {
  it("txDescriptionLabel prefers real description and counterparty over generic Banka Hareketi", () => {
    expect(txDescriptionLabel({
      description: "Banka Hareketi",
      counterparty: "AHMET YILMAZ",
      type: "outflow",
    })).toBe("AHMET YILMAZ");
    expect(txDescriptionLabel({
      description: "EFT Ücreti",
      counterparty: "Garanti",
    })).toBe("EFT Ücreti · Garanti");
    expect(txDescriptionLabel({
      description: "Banka Hareketi",
      type: "inflow",
      suggested_contact_name: "Trendyol",
    })).toBe("Gelen · Trendyol");
    expect(txDescriptionLabel({
      description: "Banka Hareketi",
      type: "outflow",
      external_id: "KT-99",
    })).toBe("Giden · ref KT-99");
    expect(txDescriptionLabel({
      description: "Havale · Mustafa Bal",
      contact_name: "Mustafa Bal",
    })).toBe("Havale · Mustafa Bal");
  });

  it("shows contact, then actor who matched", () => {
    expect(matchStatusLabel({
      contact_name: "Mustafa Bal",
      matched_by_name: "Ayşe Yılmaz",
    })).toBe("EŞLEŞTİ: Mustafa Bal · Ayşe Yılmaz");
  });

  it("uses arrow for account/partner target", () => {
    expect(matchTargetLabel({ target_account_name: "Mustafa Bal" })).toBe("Mustafa Bal");
    expect(matchStatusLabel({
      target_account_name: "Mustafa Bal",
      matched_by_name: "Admin",
    })).toBe("EŞLEŞTİ → Mustafa Bal · Admin");
  });

  it("omits actor when unknown (eski kayıtlar)", () => {
    expect(matchStatusLabel({ contact_name: "ERSAY" })).toBe("EŞLEŞTİ: ERSAY");
  });

  it("titles actor with match path", () => {
    expect(matchActorTitle({ matched_by_name: "Ayşe", matched_via: "manual" })).toBe("Ayşe eşleştirdi (manuel)");
    expect(matchActorTitle({ matched_by_name: "Sistem", matched_via: "auto" })).toBe("Sistem eşleştirdi (otomatik)");
    expect(matchActorTitle({})).toBe("");
  });

  it("txCreatedByLabel prefers created_by, then match actor, then bank source", () => {
    expect(txCreatedByLabel({ created_by_name: "Ayşe" })).toBe("Ayşe");
    expect(txCreatedByLabel({ matched_by_name: "Ali", source: "bank_sync" })).toBe("Ali");
    expect(txCreatedByLabel({ source: "bank_sync" })).toBe("Banka");
    expect(txCreatedByLabel({ source: "bank_sync", is_simulated: true })).toBe("Simüle");
    expect(txCreatedByLabel({ source: "ledger" })).toBe("Sistem");
    expect(txCreatedByLabel({})).toBe("");
  });
});
