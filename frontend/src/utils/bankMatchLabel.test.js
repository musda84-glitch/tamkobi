import { matchActorTitle, matchStatusLabel, matchTargetLabel } from "./bankMatchLabel";

describe("bankMatchLabel", () => {
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
});
