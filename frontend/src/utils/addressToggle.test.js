import { addressToggleLabel, shouldCollapseAddress } from "./addressToggle";

describe("address toggle", () => {
  it("collapses long site addresses", () => {
    expect(shouldCollapseAddress("Kadıköy")).toBe(false);
    expect(shouldCollapseAddress("Kayabaşı Mah. Ulubatlı Hasan Cad. GİRİŞ KAYAŞEHİR")).toBe(true);
    expect(addressToggleLabel(false)).toBe("Göster");
    expect(addressToggleLabel(true)).toBe("Gizle");
  });
});
