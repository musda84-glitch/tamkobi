import { isLegalAccepted, legalAcceptPayload, seedLegalAccept, toggleLegalAccept } from "./b2bLegal";

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
});
