
import { SYSTEM_NAV_GROUPS, groupSystemSections } from "./navGroups";

const sections = (...paths) => paths.map((path) => ({ path, label: path }));

test("her bölüm tam bir gruba girer ve gruplar sırasını korur", () => {
  const all = SYSTEM_NAV_GROUPS.flatMap((g) => g.paths);
  const groups = groupSystemSections(sections(...all));
  expect(groups.map((g) => g.id)).toEqual(SYSTEM_NAV_GROUPS.map((g) => g.id));
  expect(groups.flatMap((g) => g.items.map((s) => s.path))).toEqual(all);
});

test("gruptaki fazlalık path bölüm yoksa menüye girmez", () => {
  const groups = groupSystemSections(sections("/sistem"));
  expect(groups).toHaveLength(1);
  expect(groups[0].items.map((s) => s.path)).toEqual(["/sistem"]);
});

test("hiçbir gruba yazılmamış bölüm kaybolmaz, sonda Diğer'de görünür", () => {
  const groups = groupSystemSections(sections("/sistem", "/sistem/yeni"));
  const last = groups[groups.length - 1];
  expect(last.id).toBe("diger");
  expect(last.items.map((s) => s.path)).toEqual(["/sistem/yeni"]);
});

test("bölüm listesi boşken menü de boştur", () => {
  expect(groupSystemSections([])).toEqual([]);
  expect(groupSystemSections(undefined)).toEqual([]);
});
