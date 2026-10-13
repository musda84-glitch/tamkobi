import {
  matchActorTitle,
  matchStatusLabel,
  matchTargetLabel,
  sanitizeActorLabel,
  txCreatedByLabel,
  txCreatedSourceLabel,
  txDescriptionLabel,
  txUserColumnLabel,
} from "./bankMatchLabel";

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
    expect(txDescriptionLabel({
      description: "Gelen EFT",
      counterparty: "MUSTAFA BAL",
      type: "inflow",
      external_id: "1890005877722151",
    })).toBe("MUSTAFA BAL");
    expect(txDescriptionLabel({
      description: "Gelen · ref 1890005877722151",
      counterparty: "ACME A.Ş.",
      type: "inflow",
    })).toBe("ACME A.Ş.");
  });

  it("matchStatusLabel shows target without matcher username", () => {
    expect(matchStatusLabel({
      contact_name: "Mustafa Bal",
      matched_by_name: "Ayşe Yılmaz",
    })).toBe("EŞLEŞTİ: Mustafa Bal");
  });

  it("uses arrow for account/partner target", () => {
    expect(matchTargetLabel({ target_account_name: "Mustafa Bal" })).toBe("Mustafa Bal");
    expect(matchStatusLabel({
      target_account_name: "Mustafa Bal",
      matched_by_name: "Admin",
    })).toBe("EŞLEŞTİ → Mustafa Bal");
  });

  it("omits actor when unknown (eski kayıtlar)", () => {
    expect(matchStatusLabel({ contact_name: "ERSAY" })).toBe("EŞLEŞTİ: ERSAY");
  });

  it("titles actor with match path", () => {
    expect(matchActorTitle({ matched_by_name: "Ayşe", matched_via: "manual" })).toBe("Ayşe eşleştirdi (manuel)");
    expect(matchActorTitle({ matched_by_name: "Sistem", matched_via: "auto" })).toBe("Sistem eşleştirdi (otomatik)");
    expect(matchActorTitle({})).toBe("");
  });

  it("txUserColumnLabel shows Oluşturan / Eşleştiren", () => {
    expect(txUserColumnLabel({ created_by_name: "Ayşe" })).toBe("Ayşe");
    expect(txUserColumnLabel({
      created_by_name: "Ayşe",
      matched_by_name: "Ali",
      match_status: "matched",
      source: "manual",
    })).toBe("Oluşturan: Ayşe · Eşleştiren: Ali");
    expect(txUserColumnLabel({
      created_by_name: "Ayşe",
      matched_by_name: "Ali",
      match_status: "matched",
      source: "bank_sync",
    })).toBe("Oluşturan: Sistem (Banka aktarımı) · Eşleştiren: Ali");
    expect(txUserColumnLabel({
      matched_by_name: "Ali",
      match_status: "matched",
      source: "bank_sync",
    })).toBe("Oluşturan: Sistem (Banka aktarımı) · Eşleştiren: Ali");
    expect(txCreatedSourceLabel({ source: "bank_sync" })).toBe("Sistem (Banka aktarımı)");
    expect(txCreatedSourceLabel({ created_by_name: "Ayşe", source: "bank_sync" })).toBe("Sistem (Banka aktarımı)");
    expect(txUserColumnLabel({ created_by_name: "Ayşe", source: "bank_sync" })).toBe("Sistem (Banka aktarımı)");
    expect(txCreatedSourceLabel({ source: "bank_sync", is_simulated: true })).toBe("Simüle");
    expect(txUserColumnLabel({ source: "ledger" })).toBe("Sistem");
    expect(txUserColumnLabel({})).toBe("");
    expect(txCreatedByLabel({ created_by_name: "Ayşe" })).toBe("Ayşe");
  });

  it("hides site brand / bare domain as actor (tamkobi.com)", () => {
    expect(sanitizeActorLabel("tamkobi.com")).toBe("");
    expect(sanitizeActorLabel("TamKobi")).toBe("");
    expect(sanitizeActorLabel("Ayşe")).toBe("Ayşe");
    expect(txUserColumnLabel({
      created_by_name: "tamkobi.com",
      matched_by_name: "Ali",
      match_status: "matched",
      source: "bank_sync",
    })).toBe("Oluşturan: Sistem (Banka aktarımı) · Eşleştiren: Ali");
    expect(txUserColumnLabel({ created_by_name: "tamkobi.com", source: "bank_sync" })).toBe("Sistem (Banka aktarımı)");
  });

  it("hides platform CRM emails that are not company users", () => {
    expect(sanitizeActorLabel("tamkobi.crm@gmail.com")).toBe("");
    expect(sanitizeActorLabel("destek@tamkobi.com")).toBe("");
    expect(sanitizeActorLabel("mustafa@matek.com")).toBe("mustafa@matek.com");
    expect(txUserColumnLabel({ created_by_name: "tamkobi.crm@gmail.com", source: "bank_sync" })).toBe("Sistem (Banka aktarımı)");
    expect(txUserColumnLabel({
      created_by_name: "tamkobi.crm@gmail.com",
      matched_by_name: "Mustafa BAL",
      match_status: "matched",
      source: "bank_sync",
    })).toBe("Oluşturan: Sistem (Banka aktarımı) · Eşleştiren: Mustafa BAL");
    expect(matchStatusLabel({
      contact_name: "Mustafa Bal",
      matched_by_name: "tamkobi.crm@gmail.com",
    })).toBe("EŞLEŞTİ: Mustafa Bal");
  });
});
