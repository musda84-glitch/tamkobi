
import { SYSTEM_NAV_GROUPS, groupSystemSections, nextAccordionOpen } from "./navGroups";

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

test("e-fatura tasarım entegrasyon klasöründe", () => {
  const groups = groupSystemSections(sections(...SYSTEM_NAV_GROUPS.flatMap((g) => g.paths)));
  const entegrasyon = groups.find((g) => g.id === "entegrasyon");
  expect(entegrasyon.items.map((s) => s.path)).toContain("/sistem/e-fatura-tasarim");
});

test("bölüm listesi boşken menü de boştur", () => {
  expect(groupSystemSections([])).toEqual([]);
  expect(groupSystemSections(undefined)).toEqual([]);
});

test("paket başlığı açılınca diğerleri kapanır, aynı başlık tekrar kapanır", () => {
  expect(nextAccordionOpen(["finans", "raporlama"], "satis")).toEqual(["satis"]);
  expect(nextAccordionOpen(["raporlama"], "raporlama")).toEqual([]);
  expect(nextAccordionOpen([], "muhasebe")).toEqual(["muhasebe"]);
  expect(nextAccordionOpen(null, "ik")).toEqual(["ik"]);
});
