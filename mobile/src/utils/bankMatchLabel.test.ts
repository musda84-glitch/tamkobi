import { sanitizeActorLabel, txCreatedSourceLabel, txUserColumnLabel } from "./bankMatchLabel";

describe("bankMatchLabel (mobile)", () => {
  it("shows Sistem (Banka aktarımı) for auto import without created_by", () => {
    expect(txCreatedSourceLabel({ source: "bank_sync" })).toBe("Sistem (Banka aktarımı)");
    expect(txUserColumnLabel({ source: "bank_sync" })).toBe("Sistem (Banka aktarımı)");
  });

  it("shows Oluşturan / Eşleştiren when matched", () => {
    expect(txUserColumnLabel({
      created_by_name: "Ayşe",
      matched_by_name: "Ali",
      match_status: "matched",
    })).toBe("Oluşturan: Ayşe · Eşleştiren: Ali");
    expect(txUserColumnLabel({
      matched_by_name: "Ali",
      match_status: "matched",
      source: "bank_sync",
    })).toBe("Oluşturan: Sistem (Banka aktarımı) · Eşleştiren: Ali");
  });

  it("unmatched shows only creator", () => {
    expect(txUserColumnLabel({ created_by_name: "Ayşe", matched_by_name: "Ali" })).toBe("Ayşe");
  });

  it("sanitizes platform actors", () => {
    expect(sanitizeActorLabel("tamkobi.crm@gmail.com")).toBe("");
    expect(txUserColumnLabel({
      created_by_name: "tamkobi.com",
      source: "bank_sync",
    })).toBe("Sistem (Banka aktarımı)");
  });
});
