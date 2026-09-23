import {
  B2B_LOGIN_LEGAL_KEY,
  allLegalChecked,
  emptyLegalConsent,
  parseStoredLegalConsent,
} from "./LegalConsent";

test("login legal boxes start unchecked", () => {
  expect(B2B_LOGIN_LEGAL_KEY).toBe("tamkobi_b2b_login_legal");
  expect(emptyLegalConsent()).toEqual({ mss: false, obf: false, kvkk: false });
  expect(allLegalChecked(emptyLegalConsent())).toBe(false);
  expect(allLegalChecked({ mss: true, obf: true, kvkk: true })).toBe(true);
});

test("parseStoredLegalConsent keeps explicit checks and ignores missing", () => {
  expect(parseStoredLegalConsent(null)).toEqual({ mss: false, obf: false, kvkk: false });
  expect(parseStoredLegalConsent("{")).toEqual({ mss: false, obf: false, kvkk: false });
  expect(parseStoredLegalConsent(JSON.stringify({ kvkk: true, "mesafeli-satis": true }))).toEqual({
    mss: true,
    obf: false,
    kvkk: true,
  });
});
