import { guessTaxSourceKind, taxKindLabel, taxSourceById } from "./taxObligations";

test("guess tax source from filename", () => {
  expect(guessTaxSourceKind({ name: "matek bordro 2026-09.pdf" })).toBe("bordro");
  expect(guessTaxSourceKind({ name: "Eylul-Mizan.pdf" })).toBe("mizan");
  expect(guessTaxSourceKind({ name: "KDV-tahakkuk.pdf" })).toBe("tahakkuk");
  expect(guessTaxSourceKind({ name: "dispatch (7).pdf" })).toBe("");
});

test("kind labels", () => {
  expect(taxKindLabel("sgk")).toMatch(/SGK/);
  expect(taxKindLabel("kdv")).toBe("KDV");
  expect(taxSourceById("tahakkuk").label).toBe("Tahakkuk");
});
