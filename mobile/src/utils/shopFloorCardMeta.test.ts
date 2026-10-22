import { cardTags, cardTitle, matchesLinkFilter, projectColor, projectFilterLabel, stationColor } from "./shopFloorCardMeta";

test("istasyon rengi SHA1 paletinden gelir ve büyük İ katlanır", () => {
  expect(stationColor("Kesim").bg).toBe(stationColor("kesim").bg);
  expect(stationColor("İstasyon").bg).toBe(stationColor("i\u0307stasyon").bg);
  expect(["#0e7490", "#4338ca", "#0369a1", "#0f766e", "#6d28d9", "#1d4ed8"]).toContain(stationColor("HOLZHER").bg);
  expect(stationColor("Kesim istasyonu").id).toBeTruthy();
});

test("boş proje nötr kenar, dolu proje sıcak paletten şerit verir", () => {
  expect(projectColor("").id).toBe("neutral");
  expect(projectColor("none").stripe).toBe("#cbd5e1");
  expect(projectColor("prj-0001").stripe.startsWith("hsl(")).toBe(true);
  expect(projectColor("prj-0001")).toEqual(projectColor("prj-0001"));
});

test("kart başlığı reçeteyi, etiketler boş alanı basmaz", () => {
  expect(cardTitle({ recipe_name: "Dolap-60", step_name: "Kesim", product_name: "Tabla" }).text).toBe("Dolap-60");
  expect(cardTitle({ step_name: "Kesim", product_name: "Tabla" }).source).toBe("step");
  expect(cardTags({ project_number: "PRJ-1", sales_order_no: "", customer_name: "Ada" }).map((tag) => tag.kind)).toEqual(["project", "customer"]);
  expect(cardTags({})).toEqual([]);
  expect(projectFilterLabel({ project_id: "none", job_count: 0 })).toBe("Projesiz (0)");
});

test("proje ve reçete süzgeci boşken elemez", () => {
  expect(matchesLinkFilter({ project_id: "p1" }, "", "")).toBe(true);
  expect(matchesLinkFilter({ project_id: "p1" }, "p2", "")).toBe(false);
  expect(matchesLinkFilter({ project_id: "" }, "none", "")).toBe(true);
  expect(matchesLinkFilter({ project_id: "p1", recipe_id: "r1" }, "p1", "r9")).toBe(false);
});
