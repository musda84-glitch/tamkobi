import {
  isRadialBlankTarget,
  normalizeRadialSlots,
  DEFAULT_RADIAL_SLOTS,
  RADIAL_SLOT_COUNT,
  radialTaskOptions,
  specialById,
} from "./radialQuickMenu";

describe("isRadialBlankTarget", () => {
  test("allows empty panel surface", () => {
    document.body.innerHTML = `<main data-testid="surface"><div class="p-8">boş alan</div></main>`;
    const el = document.querySelector("[data-testid='surface'] div");
    expect(isRadialBlankTarget(el)).toBe(true);
  });

  test("blocks buttons links and inputs", () => {
    document.body.innerHTML = `
      <button id="b">x</button>
      <a href="/panel" id="a">y</a>
      <input id="i" />
      <div role="button" id="rb">z</div>
    `;
    expect(isRadialBlankTarget(document.getElementById("b"))).toBe(false);
    expect(isRadialBlankTarget(document.getElementById("a"))).toBe(false);
    expect(isRadialBlankTarget(document.getElementById("i"))).toBe(false);
    expect(isRadialBlankTarget(document.getElementById("rb"))).toBe(false);
  });
});

describe("normalizeRadialSlots", () => {
  test("pads and truncates to slot count", () => {
    expect(normalizeRadialSlots(["/panel", "/stock"]).length).toBe(RADIAL_SLOT_COUNT);
    expect(normalizeRadialSlots(["/panel", "/stock"])[0]).toBe("/panel");
    expect(normalizeRadialSlots(["/panel", "/stock"])[1]).toBe("/stock");
    expect(normalizeRadialSlots(["/panel", "/stock"])[2]).toBe("");
  });

  test("falls back to defaults for null", () => {
    expect(normalizeRadialSlots(null)).toEqual(DEFAULT_RADIAL_SLOTS);
  });
});

describe("radialTaskOptions", () => {
  test("includes special actions and menu paths", () => {
    const opts = radialTaskOptions([{ path: "/reports", label: "Raporlar" }]);
    expect(opts.some((o) => o.value === "action:invoice-new")).toBe(true);
    expect(opts.some((o) => o.value === "/reports" && o.label === "Raporlar")).toBe(true);
    expect(specialById("action:virman")?.href).toContain("virman");
  });
});
