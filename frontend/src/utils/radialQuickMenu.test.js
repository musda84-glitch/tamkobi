import { isRadialBlankTarget } from "../utils/radialQuickMenu";

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
