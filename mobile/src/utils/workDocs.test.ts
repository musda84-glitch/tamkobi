import {
  emptyItem,
  namedItems,
  newButtonLabel,
  projectPayload,
  quotePayload,
  surveyPayload,
  validateProjectName,
  validateQuoteItems,
  workItemTotals,
  itemStripe,
} from "./workDocs";

describe("workDocs", () => {
  it("totals quote lines with VAT", () => {
    const t = workItemTotals([
      { name: "Kapı", quantity: 2, unit_price: 100, vat_rate: 20, unit: "Adet" },
      { name: "", quantity: 1, unit_price: 50, vat_rate: 20, unit: "Adet" },
    ]);
    expect(t.subtotal).toBe(200);
    expect(t.vat).toBe(40);
    expect(t.grandTotal).toBe(240);
    expect(namedItems([{ ...emptyItem(), name: "X" }, emptyItem()])).toHaveLength(1);
  });

  it("requires at least one named quote line and a project name", () => {
    expect(validateQuoteItems([emptyItem()])).toBe("En az bir kalem ekleyin.");
    expect(validateQuoteItems([{ ...emptyItem(), name: "İşçilik" }])).toBeNull();
    expect(validateProjectName("")).toBe("Proje adı gerekli.");
    expect(validateProjectName("Villa renovasyon")).toBeNull();
  });

  it("builds quote / project / survey payloads", () => {
    const items = [{ name: "Keşif kalemi", quantity: 1, unit_price: 50, vat_rate: 20, unit: "m2" }];
    const q = quotePayload("comp", { contact_id: "c1", contact_name: "Acme", title: "", valid_until: "2026-10-01", notes: "n" }, items);
    expect(q.title).toBe("Fiyat Teklifi");
    expect(q.items).toHaveLength(1);
    const p = projectPayload("comp", { name: "Villa", contact_id: "c1", contact_name: "Acme", budget: "15000", start_date: "", end_date: "", notes: "", address: "Kadıköy", location_url: "" });
    expect(p.budget).toBe(15000);
    expect(p.latitude).toBeNull();
    const s = surveyPayload("comp", { contact_id: "c1", contact_name: "Acme", address: "Kadıköy", survey_date: "2026-09-16", notes: "", location_url: "" }, items);
    expect(s.measurements[0].unit).toBe("m2");
  });

  it("sends marked coordinates with project and survey", () => {
    const p = projectPayload("comp", {
      name: "Villa", contact_id: "", contact_name: "", budget: "", start_date: "", end_date: "", notes: "", address: "",
      location_url: "https://www.google.com/maps?q=41.0151,28.9795", latitude: "41.0151", longitude: "28.9795",
    });
    expect(p.latitude).toBe(41.0151);
    expect(p.longitude).toBe(28.9795);
    const s = surveyPayload("comp", {
      contact_id: "", contact_name: "", address: "", survey_date: "2026-09-16", notes: "",
      location_url: "", latitude: "39,9255", longitude: "32,8662",
    }, []);
    expect(s.latitude).toBe(39.9255);
    expect(s.longitude).toBe(32.8662);
  });

  it("labels create buttons like web", () => {
    expect(newButtonLabel("quote")).toBe("Yeni Teklif");
    expect(newButtonLabel("project")).toBe("Yeni Proje");
    expect(newButtonLabel("survey")).toBe("Yeni Keşif");
  });

  it("stripes item rows in alternating tones", () => {
    expect(itemStripe(0).backgroundColor).toBe("#F1F5F9");
    expect(itemStripe(1).backgroundColor).toBe("#EEF2FF");
    expect(itemStripe(2).backgroundColor).not.toBe(itemStripe(1).backgroundColor);
  });
});
