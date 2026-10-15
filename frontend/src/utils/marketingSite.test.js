import {
  marketingSlug,
  showsPackageVitrin,
  isSitePreviewSearch,
  publishedCards,
} from "./marketingSite";

test("host selects the marketing site and leaves tamkobi.com unchanged", () => {
  expect(marketingSlug("tamkobi.com")).toBe("tamkobi");
  expect(marketingSlug("www.tamkobi.com")).toBe("tamkobi");
  expect(marketingSlug("taiyazilim.com")).toBe("tai");
  expect(marketingSlug("www.taiyazilim.com")).toBe("tai");
  expect(marketingSlug("ynt.taiyazilim.com")).toBe("tamkobi");
  expect(marketingSlug("app.tamkobi.com")).toBe("tamkobi");
});

test("preview query works on ynt and localhost only", () => {
  expect(marketingSlug("ynt.taiyazilim.com", "?site=tai&onizleme=1")).toBe("tai");
  expect(marketingSlug("localhost", "?site=tai")).toBe("tai");
  expect(marketingSlug("tamkobi.com", "?site=tai")).toBe("tamkobi");
  expect(marketingSlug("taiyazilim.com", "?site=tamkobi")).toBe("tai");
  expect(isSitePreviewSearch("?site=tai&onizleme=1")).toBe(true);
  expect(isSitePreviewSearch("?site=tai")).toBe(false);
});

test("package vitrin stays on tamkobi", () => {
  expect(showsPackageVitrin("tamkobi")).toBe(true);
  expect(showsPackageVitrin("tai")).toBe(false);
});

test("published cards keep order and drop hidden ones", () => {
  const rows = publishedCards([
    { id: "b", title: "B", sort: 2, published: true },
    { id: "a", title: "A", sort: 0, published: false },
    { id: "c", title: "C", sort: 1, published: true },
  ]);
  expect(rows.map((r) => r.id)).toEqual(["c", "b"]);
});
