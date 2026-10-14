import { ikFieldDenied, visibleIkLinks } from "./portalFields";

describe("portal field menu", () => {
  const personel = { role: "personel", employee_id: "e1", features: {} };

  test("unauthorized personnel does not see field links", () => {
    const labels = visibleIkLinks(personel).map((l) => l.label);
    expect(labels).toEqual(["Personelim", "Mesaim"]);
    expect(ikFieldDenied("/atolye", personel)).toBe(true);
    expect(ikFieldDenied("/sayim", personel)).toBe(true);
    expect(ikFieldDenied("/sevk", personel)).toBe(true);
    expect(ikFieldDenied("/personelim", personel)).toBe(false);
  });

  test("granted features appear and the page is allowed", () => {
    const user = { ...personel, features: { portal_atolye: true, portal_sayim: true } };
    const labels = visibleIkLinks(user).map((l) => l.to);
    expect(labels).toContain("/atolye");
    expect(labels).toContain("/sayim");
    expect(labels).not.toContain("/sevk");
    expect(labels).not.toContain("/saha");
    expect(ikFieldDenied("/atolye", user)).toBe(false);
    expect(ikFieldDenied("/sevk", user)).toBe(true);
  });

  test("admin sees every portal link", () => {
    const labels = visibleIkLinks({ role: "admin" }).map((l) => l.to);
    expect(labels).toEqual(expect.arrayContaining(["/atolye", "/sevk", "/sayim", "/saha", "/vehicles"]));
    expect(ikFieldDenied("/vehicles", { role: "admin" })).toBe(false);
  });
});
