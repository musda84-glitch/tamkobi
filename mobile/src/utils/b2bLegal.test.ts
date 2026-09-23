import {
  B2B_LOGIN_LEGAL_KEY,
  allLoginLegalAccepted,
  isLegalAccepted,
  isLoginLegalAccepted,
  legalAcceptPayload,
  parseLoginLegalAccept,
  seedLegalAccept,
  serializeLoginLegalAccept,
  toggleLegalAccept,
  toggleLoginLegalAccept,
} from "./b2bLegal";

describe("b2bLegal", () => {
  test("missing slugs are treated as checked", () => {
    expect(isLegalAccepted({}, "mesafeli-satis")).toBe(true);
    expect(isLegalAccepted(undefined, "kvkk")).toBe(true);
    expect(isLegalAccepted({ kvkk: false }, "kvkk")).toBe(false);
  });

  test("seedLegalAccept checks new docs and keeps user unchecks", () => {
    const docs = [{ slug: "mesafeli-satis" }, { slug: "on-bilgilendirme" }, { slug: "kvkk" }];
    const seeded = seedLegalAccept({ "mesafeli-satis": false }, docs);
    expect(seeded).toEqual({
      "mesafeli-satis": false,
      "on-bilgilendirme": true,
      kvkk: true,
    });
  });

  test("toggleLegalAccept flips a pre-checked slug to false", () => {
    expect(toggleLegalAccept({}, "mesafeli-satis")).toEqual({ "mesafeli-satis": false });
    expect(toggleLegalAccept({ "mesafeli-satis": false }, "mesafeli-satis")).toEqual({ "mesafeli-satis": true });
  });

  test("legalAcceptPayload maps slugs to accept_* flags, defaulting true", () => {
    expect(legalAcceptPayload({})).toEqual({
      accept_mss: true,
      accept_obf: true,
      accept_kvkk: true,
    });
    expect(legalAcceptPayload({ "on-bilgilendirme": false })).toEqual({
      accept_mss: true,
      accept_obf: false,
      accept_kvkk: true,
    });
  });

  test("login legal boxes start unchecked and stay checked after toggle", () => {
    expect(B2B_LOGIN_LEGAL_KEY).toBe("tamkobi.b2b_login.legal");
    expect(isLoginLegalAccepted({}, "kvkk")).toBe(false);
    expect(isLoginLegalAccepted(undefined, "mesafeli-satis")).toBe(false);
    expect(allLoginLegalAccepted({})).toBe(false);
    const once = toggleLoginLegalAccept({}, "kvkk");
    expect(once).toEqual({ kvkk: true });
    expect(isLoginLegalAccepted(once, "kvkk")).toBe(true);
    expect(allLoginLegalAccepted({ "mesafeli-satis": true, "on-bilgilendirme": true, kvkk: true })).toBe(true);
    expect(toggleLoginLegalAccept(once, "kvkk")).toEqual({ kvkk: false });
  });

  test("login legal persist round-trips only explicit true", () => {
    expect(parseLoginLegalAccept(null)).toEqual({});
    expect(parseLoginLegalAccept("{")).toEqual({});
    expect(parseLoginLegalAccept(JSON.stringify({ kvkk: true, mss: true }))).toEqual({
      kvkk: true,
      "mesafeli-satis": true,
    });
    const raw = serializeLoginLegalAccept({ kvkk: true, "mesafeli-satis": false });
    expect(JSON.parse(raw)).toEqual({
      "mesafeli-satis": false,
      "on-bilgilendirme": false,
      kvkk: true,
    });
    expect(parseLoginLegalAccept(raw)).toEqual({
      "mesafeli-satis": false,
      "on-bilgilendirme": false,
      kvkk: true,
    });
  });
});
