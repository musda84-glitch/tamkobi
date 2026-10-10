import { filterGroups, visibleSelectGroups, type SelectGroup } from "./groupedSelectFilter";

const groups: SelectGroup[] = [
  {
    label: "Kasa",
    options: [
      { value: "k1", label: "Merkez kasa · 10,00 ₺" },
      { value: "k2", label: "Şube kasa · 5,00 ₺" },
    ],
  },
  {
    label: "Ortaklar Hesabı",
    options: [{ value: "partner:p1", label: "Mustafa Bal (Ortak · %50 · 1,00 ₺)" }],
  },
  {
    label: "Cariler",
    searchOnly: true,
    options: [
      { value: "contact:c1", label: "4.etap d.14 d.42 · 0,00 ₺" },
      { value: "contact:c2", label: "Acme Ltd · 1.200,00 ₺" },
      { value: "contact:c3", label: "Beta AŞ · 50,00 ₺" },
    ],
  },
];

describe("visibleSelectGroups", () => {
  it("keeps kasa/ortak visible and hides cari until search", () => {
    const empty = visibleSelectGroups(groups, "", "");
    expect(empty.find((g) => g.label === "Kasa")?.options).toHaveLength(2);
    expect(empty.find((g) => g.label === "Ortaklar Hesabı")?.options).toHaveLength(1);
    expect(empty.find((g) => g.label === "Cariler")?.options).toEqual([]);

    const short = visibleSelectGroups(groups, "a", "");
    expect(short.find((g) => g.label === "Cariler")?.options).toEqual([]);
    expect(short.find((g) => g.label === "Kasa")?.options).toHaveLength(2);
  });

  it("filters only cari by query and keeps selected cari", () => {
    const hit = visibleSelectGroups(groups, "acme", "");
    expect(hit.find((g) => g.label === "Cariler")?.options.map((o) => o.value)).toEqual(["contact:c2"]);
    expect(hit.find((g) => g.label === "Kasa")?.options).toHaveLength(2);

    const selected = visibleSelectGroups(groups, "", "contact:c1");
    expect(selected.find((g) => g.label === "Cariler")?.options.map((o) => o.value)).toEqual(["contact:c1"]);
  });

  it("falls back to filtering all groups when none are searchOnly", () => {
    const plain = groups.map(({ label, options }) => ({ label, options }));
    expect(filterGroups(plain, "merkez").map((g) => g.label)).toEqual(["Kasa"]);
    expect(visibleSelectGroups(plain, "merkez", "").map((g) => g.label)).toEqual(["Kasa"]);
  });
});
