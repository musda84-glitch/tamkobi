import {
  applyTaskAssignee,
  assigneeSelectGroups,
  cleanProjectTasks,
  emptyItem,
  emptyProjectTask,
  namedItems,
  removeWorkItem,
  PROJECT_QUOTE_ACTION,
  PROJECT_STATUSES,
  newButtonLabel,
  projectCardBits,
  projectPayload,
  projectTaskRows,
  projectTaskSummary,
  projectTrackingPayload,
  quotePayload,
  surveyPayload,
  trackingAbsoluteLink,
  trackingBadgeLabel,
  trackingShareMessage,
  validateProjectName,
  validateQuoteItems,
  shouldAttachQuoteDraftInvoice,
  quoteSaveMessage,
  workItemFromProduct,
  workItemImage,
  workItemLineGross,
  workItemTotals,
  hydrateWorkItem,
  itemStripe,
} from "./workDocs";

describe("workDocs", () => {
  it("does not add VAT again when stock price already includes it", () => {
    const t = workItemTotals([
      { name: "Koltuk", quantity: 1, unit_price: 120, vat_rate: 20, unit: "Adet", price_includes_vat: true },
    ]);
    expect(t.subtotal).toBe(100);
    expect(t.vat).toBe(20);
    expect(t.grandTotal).toBe(120);
    expect(workItemLineGross({ name: "Koltuk", quantity: 1, unit_price: 120, vat_rate: 20, unit: "Adet", price_includes_vat: true })).toBe(120);
    const fromCard = workItemFromProduct({ id: "p1", name: "Koltuk", sale_price: 120, vat_rate: 20, price_includes_vat: true, thumbnail_url: "koltuk.jpg" });
    expect(fromCard.price_includes_vat).toBe(true);
    expect(fromCard.image_url).toBe("koltuk.jpg");
    expect(workItemTotals([fromCard]).grandTotal).toBe(120);
    const saved = hydrateWorkItem({ name: "Koltuk", quantity: 1, unit_price: 100, unit_price_incl: 120, vat_rate: 20, unit: "Adet", price_includes_vat: true });
    expect(saved.price_includes_vat).toBe(false);
    expect(workItemTotals([saved]).grandTotal).toBe(120);
    const stale = hydrateWorkItem(
      { name: "Raf", quantity: 1, unit_price: 260, unit_price_incl: 286, vat_rate: 10, unit: "Adet" },
      { price_includes_vat: true, sale_price: 260 },
    );
    expect(stale.price_includes_vat).toBe(true);
    expect(stale.unit_price_incl).toBeUndefined();
    expect(workItemTotals([stale]).grandTotal).toBe(260);
    const fromLite = hydrateWorkItem(
      { name: "Raf", quantity: 2, unit_price: 260, vat_rate: 10, unit: "Adet" },
      { price_includes_vat: true, sale_price: 260 },
    );
    expect(workItemTotals([fromLite]).grandTotal).toBe(520);
  });

  it("keeps the selected quote VAT rate on the payload and total", () => {
    const line = { name: "Kapı", quantity: 1, unit_price: 100, vat_rate: 10, unit: "Adet" };
    expect(workItemLineGross(line)).toBe(110);
    expect(workItemTotals([line]).vat).toBe(10);
    expect(workItemTotals([{ ...line, vat_rate: 0 }]).grandTotal).toBe(100);
    const q = quotePayload("comp", { contact_id: "c1", contact_name: "Acme", title: "T", valid_until: "", notes: "" }, [line]);
    expect(q.items[0].vat_rate).toBe(10);
  });

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

  it("removes a quote or survey line and keeps one empty row", () => {
    const a = { ...emptyItem(), name: "Kapı" };
    const b = { ...emptyItem(), name: "Kasa" };
    expect(removeWorkItem([a, b], 0)).toEqual([b]);
    expect(removeWorkItem([a], 0)).toEqual([emptyItem()]);
  });

  it("attaches a draft invoice on save only when cari exists and quote is not invoiced", () => {
    expect(shouldAttachQuoteDraftInvoice(null, "c1")).toBe(true);
    expect(shouldAttachQuoteDraftInvoice({ invoice_id: "" }, "c1")).toBe(true);
    expect(shouldAttachQuoteDraftInvoice({ invoice_id: "inv1" }, "c1")).toBe(false);
    expect(shouldAttachQuoteDraftInvoice(null, "")).toBe(false);
    expect(quoteSaveMessage({ createdInvoiceNumber: "NX202600000004", hasContact: true, alreadyInvoiced: false }))
      .toBe("Teklif kaydedildi. Taslak fatura NX202600000004 cariye işlendi.");
    expect(quoteSaveMessage({ hasContact: false, alreadyInvoiced: false })).toBe("Teklif kaydedildi. Taslak fatura için cari seçin.");
    expect(quoteSaveMessage({ hasContact: true, alreadyInvoiced: true })).toBe("Teklif güncellendi.");
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

  it("builds project list cards like the web grid", () => {
    const bits = projectCardBits({
      project_number: "PRJ-2026-0011",
      quote_number: "TKF-2026-0004",
      name: "Fiyat Teklifi",
      contact_name: "Mustafa BAL",
      address: "Kadıköy",
      status: "planning",
      budget: 0,
      quote_count: 1,
      quoted_total: 52.8,
      invoiced_total: 0,
    });
    expect(bits.codes).toBe("PRJ-2026-0011 · TKF-2026-0004");
    expect(bits.contact).toBe("Mustafa BAL · Kadıköy");
    expect(bits.quoteCount).toBe(1);
    expect(bits.quoted).toBe(52.8);
  });

  it("labels create buttons like web", () => {
    expect(newButtonLabel("quote")).toBe("Yeni Teklif");
    expect(newButtonLabel("project")).toBe("Yeni Proje");
    expect(newButtonLabel("survey")).toBe("Yeni Keşif");
    expect(PROJECT_QUOTE_ACTION).toBe("Teklifi Tamamla");
  });

  it("keeps project stages as a single icon row", () => {
    expect(PROJECT_STATUSES.map((s) => s.key)).toEqual(["planning", "active", "on_hold", "completed"]);
    expect(PROJECT_STATUSES.every((s) => s.icon && s.short && s.color)).toBe(true);
    expect(PROJECT_STATUSES.map((s) => s.short)).toEqual(["Plan", "Devam", "Bekle", "Bitti"]);
  });

  it("prefers the line photo then the stock card image", () => {
    expect(workItemImage({ image_url: "line.jpg" }, { thumbnail_url: "card.jpg" })).toBe("line.jpg");
    expect(workItemImage({}, { image_url: "card.jpg" })).toBe("card.jpg");
    expect(workItemImage({})).toBe("");
    const hydrated = hydrateWorkItem({ name: "Raf", quantity: 1, unit_price: 10, vat_rate: 20, unit: "Adet" }, { image_url: "raf.jpg" });
    expect(hydrated.image_url).toBe("raf.jpg");
  });

  it("stripes item rows in alternating tones", () => {
    expect(itemStripe(0).backgroundColor).toBe("#F1F5F9");
    expect(itemStripe(1).backgroundColor).toBe("#EEF2FF");
    expect(itemStripe(2).backgroundColor).not.toBe(itemStripe(1).backgroundColor);
  });

  it("summarizes project tasks and assignee options like the web card", () => {
    expect(projectTaskSummary([])).toBeNull();
    expect(projectTaskSummary([
      { id: "t1", title: "Keşif", done: true, assignee_name: "Ali" },
      { id: "t2", title: "Montaj", assignee_id: "e2" },
      { id: "t3", title: "  " },
    ])).toEqual({ done: 1, total: 2, assigned: 2, label: "1/2 görev · 2 atanmış" });
    const rows = projectTaskRows([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("");
    expect(cleanProjectTasks([{ ...emptyProjectTask("t1"), title: " Keşif " }, emptyProjectTask("t2")])).toEqual([
      { id: "t1", title: "Keşif", done: false, assignee_id: null, assignee_name: null },
    ]);
    expect(applyTaskAssignee(rows[0], [{ id: "e1", full_name: "Ayşe" }], "e1")).toMatchObject({
      assignee_id: "e1",
      assignee_name: "Ayşe",
    });
    expect(assigneeSelectGroups([{ id: "e1", full_name: "Ayşe", position: "Usta" }])[0].options[0]).toEqual({
      value: "e1",
      label: "Ayşe · Usta",
    });
  });

  it("builds a public tracking link and share text", () => {
    expect(trackingBadgeLabel({})).toBeNull();
    expect(trackingBadgeLabel({ token: "abc" })).toBe("Takip linki hazır");
    expect(trackingBadgeLabel({ token: "abc", sent_count: 1 })).toBe("Takip linki gönderildi");
    expect(trackingBadgeLabel({ token: "abc", sent_count: 1, view_count: 3 })).toBe("Takip · 3 görüntüleme");
    expect(trackingAbsoluteLink({ link: "/proje/tok" }, null, "https://tamkobi.com/api")).toBe("https://tamkobi.com/proje/tok");
    expect(trackingAbsoluteLink({ token: "tok" }, { link: "https://ornek.tamkobi.com/proje/tok" }, "https://tamkobi.com")).toBe("https://ornek.tamkobi.com/proje/tok");
    expect(projectTrackingPayload(["whatsapp"], " 0555 ", "", "https://tamkobi.com/")).toEqual({
      channels: ["whatsapp"],
      phone: "0555",
      email: "",
      base_url: "https://tamkobi.com",
    });
    expect(trackingShareMessage({ project_number: "PRJ-1", name: "Villa", contact_name: "Mustafa" }, "https://x/proje/t"))
      .toContain("Mustafa");
    expect(trackingShareMessage({ project_number: "PRJ-1", name: "Villa" }, "https://x/proje/t")).toContain("https://x/proje/t");
  });
});
