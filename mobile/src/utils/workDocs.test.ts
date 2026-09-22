import {
  applyTaskAssignee,
  assigneeSelectGroups,
  cleanProjectTasks,
  emptyItem,
  emptyProjectTask,
  namedItems,
  removeWorkItem,
  PROJECT_QUOTE_ACTION,
  PROJECT_NEW_QUOTE_ACTION,
  PROJECT_MAPS_ACTION,
  SURVEY_MAPS_ACTION,
  projectQuoteNavParams,
  canCompleteProject,
  PROJECT_STATUSES,
  newButtonLabel,
  projectStatusSelectGroups,
  workStatusSelectGroups,
  projectCardBits,
  addressToggleLabel,
  shouldCollapseAddress,
  projectsForContact,
  mergeContactProjects,
  projectMetricSectionOrder,
  quotesForProject,
  projectPayload,
  projectTaskRows,
  projectTaskSummary,
  projectTrackingPayload,
  quoteListSubtitle,
  quoteListTitle,
  quoteStatusTone,
  workStatusDotColor,
  workStatusTone,
  isSurveyConverted,
  surveyListSubtitle,
  surveyStatusTone,
  quotePayload,
  quoteProjectSyncPayload,
  quoteToProjectAction,
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
  workItemPrintImage,
  bumpWorkItemQty,
  workItemPriceFromGross,
  workItemLineGross,
  workItemNameHits,
  workItemNoteOpen,
  workItemTotals,
  hydrateWorkItem,
  itemStripe,
  workItemLineKind,
  workGalleryWithoutLinePhotos,
  QUOTE_ITEM_THUMB,
  QUOTE_SERVICE_THUMB,
  QUOTE_ITEM_THUMB_SIZE,
  toggleWorkItemService,
  workItemNeedsStockCard,
  matchProductByName,
  rememberStockCreate,
  stockCardNameKey,
  quoteLineSku,
  quoteLineProductPayload,
  attachProductToWorkItem,
} from "./workDocs";

describe("workDocs", () => {
  it("does not add VAT again when stock price already includes it", () => {
    const t = workItemTotals([
      { name: "Koltuk", quantity: 1, unit_price: 120, vat_rate: 20, unit: "Adet", price_includes_vat: true },
    ]);
    expect(t.subtotal).toBe(100);
    expect(t.vat).toBe(20);
    expect(t.grandTotal).toBe(120);
    expect(bumpWorkItemQty(1, 1)).toBe(2);
    expect(bumpWorkItemQty(1, -1)).toBe(0);
    expect(bumpWorkItemQty(0, -1)).toBe(0);
    expect(bumpWorkItemQty(1.5, 1)).toBe(2.5);
    expect(workItemPriceFromGross({ quantity: 1, vat_rate: 10 }, 260)).toBeCloseTo(236.3636, 3);
    expect(workItemPriceFromGross({ quantity: 2, vat_rate: 20 }, 240)).toBe(100);
    expect(workItemPriceFromGross({ quantity: 1, vat_rate: 20, price_includes_vat: true }, 120)).toBe(120);
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

  it("searches stock from the line name and toggles ürün / hizmet", async () => {
    const products = [
      { id: "p1", name: "Dekorasyon Profili", sku: "DL120", barcode: "868", category: "Profil" },
      { id: "p2", name: "Kapı kolu", sku: "KK-1", barcode: "111", category: "Aksesuar" },
    ];
    expect(workItemNameHits(products, { name: "D", is_service: false })).toEqual([]);
    expect(workItemNameHits(products, { name: "dekor", is_service: false }).map((p) => p.id)).toEqual(["p1"]);
    expect(workItemNameHits(products, { name: "dekor", is_service: true })).toEqual([]);
    expect(workItemNameHits(products, { name: "Dekorasyon Profili", product_id: "p1", is_service: false })).toEqual([]);
    expect(workItemNameHits(products, {
      name: "*Koli içi 14 boy*Boy ölçüsü 290cm* DL120-ANT-G74 Dekorasyon Profili (Decoration Profile)",
      is_service: false,
    }).map((p) => p.id)).toEqual(["p1"]);
    expect(workItemNameHits(products, { name: "DL120", is_service: false }).map((p) => p.id)).toEqual(["p1"]);
    const service = toggleWorkItemService({ ...emptyItem(), product_id: "p1", name: "Profil", image_url: "x.jpg", thumbnail_url: "x.jpg" });
    expect(service.is_service).toBe(true);
    expect(service.product_id).toBe("");
    expect(service.print_image_url).toBe("x.jpg");
    expect(workItemPrintImage(service, { image_url: "stock.jpg" })).toBe("x.jpg");
    expect(workItemImage(service, { image_url: "stock.jpg" })).toBe("x.jpg");
    expect(quoteLineProductPayload({ name: "Montaj", unit_price: 10, vat_rate: 20, unit: "Adet", image_url: undefined }, "c", "M-1").image_url).toBeUndefined();
    expect(toggleWorkItemService(service).is_service).toBe(false);
    const fromSvc = workItemFromProduct({ id: "s1", name: "Montaj", type: "service", sale_price: 500 });
    expect(fromSvc.is_service).toBe(true);
    expect(fromSvc.product_id).toBe("");
    expect(QUOTE_ITEM_THUMB.width).toBe(44);
    expect(QUOTE_ITEM_THUMB.height).toBe(44);
    expect(QUOTE_SERVICE_THUMB.height).toBeGreaterThan(QUOTE_SERVICE_THUMB.width);
    expect(QUOTE_ITEM_THUMB_SIZE).toBe(QUOTE_ITEM_THUMB.height);
    expect(workItemNoteOpen({ description: "" })).toBe(false);
    expect(workItemNoteOpen({ description: "Kesim notu" })).toBe(true);
    expect(workItemNoteOpen({ description: "Kesim notu" }, false)).toBe(false);
    const q = quotePayload("comp", { contact_id: "c1", contact_name: "Acme", title: "T", valid_until: "", notes: "" }, [
      { ...emptyItem(), name: "İşçilik", is_service: true, description: "Montaj" },
    ]);
    expect(q.items[0].is_service).toBe(true);
    expect(q.items[0].description).toBe("Montaj");
    expect(workItemNeedsStockCard({ name: "a", is_service: false })).toBe(true);
    expect(workItemNeedsStockCard({ name: "a", is_service: true })).toBe(false);
    expect(workItemNeedsStockCard({ name: "a", product_id: "p1", is_service: false })).toBe(false);
    expect(workItemNeedsStockCard({ name: "  ", is_service: false })).toBe(false);
    expect(matchProductByName([{ id: "p1", name: "A" }, { id: "p2", name: "Raf" }], "a")?.id).toBe("p1");
    expect(stockCardNameKey("  Raf ")).toBe(stockCardNameKey("raf"));
    expect(quoteLineSku("çelik raf", "ab12")).toBe("CELIK-RAF-AB12");
    expect(quoteLineSku("", "x")).toBe("STOK-X");
    const body = quoteLineProductPayload({ name: "a", unit_price: 236.36, vat_rate: 10, unit: "Adet", image_url: "blob:x" }, "comp_1", "A-1");
    expect(body).toMatchObject({ company_id: "comp_1", name: "a", sku: "A-1", sale_price: 236.36, vat_rate: 10, type: "product" });
    expect(body.image_url).toBeUndefined();
    expect(quoteLineProductPayload({ name: "Raf", unit_price: 10, vat_rate: 20, unit: "Adet", image_url: "/api/files/raf.jpg" }, "comp_1", "RAF-1").image_url).toBe("/api/files/raf.jpg");
    expect(attachProductToWorkItem({ ...emptyItem(), name: "a" }, { id: "p9", image_url: "raf.jpg" }).product_id).toBe("p9");
    const inflight = new Map<string, Promise<{ id: string }>>();
    let calls = 0;
    const factory = () => {
      calls += 1;
      return Promise.resolve({ id: "p1" });
    };
    const first = rememberStockCreate(inflight, "Raf", factory);
    const second = rememberStockCreate(inflight, "raf", factory);
    expect(first).toBe(second);
    expect(await first).toEqual({ id: "p1" });
    expect(await second).toEqual({ id: "p1" });
    expect(calls).toBe(1);
    expect(rememberStockCreate(inflight, "  ", factory)).toBeNull();
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
    expect(quoteToProjectAction({}).title).toBe("Projeye dönüştür");
    expect(quoteToProjectAction({}).testID).toBe("quote-to-project");
    expect(quoteToProjectAction({ project_id: "p1" }).title).toBe("Güncelle");
    expect(quoteToProjectAction({ project_id: "p1" }).mode).toBe("update");
    expect(quoteToProjectAction({ project_id: "p1" }).testID).toBe("quote-update-project");
    expect(quoteProjectSyncPayload({
      title: "Villa",
      quote_number: "TKF-1",
      contact_id: "c1",
      contact_name: "Acme",
      notes: "revize",
      grand_total: 240,
      images: ["/api/files/a.jpg", ""],
    })).toEqual({
      name: "Villa",
      contact_id: "c1",
      contact_name: "Acme",
      budget: 240,
      description: "revize",
      images: ["/api/files/a.jpg"],
    });
    expect(quoteProjectSyncPayload({ quote_number: "TKF-2" }).name).toBe("TKF-2 projesi");
    expect(quoteProjectSyncPayload({}).name).toBe("Teklif projesi");
    expect(quoteProjectSyncPayload({ images: [] }).images).toBeUndefined();
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
      expense_total: 18.5,
    });
    expect(bits.codes).toBe("PRJ-2026-0011 · TKF-2026-0004");
    expect(bits.contactName).toBe("Mustafa BAL");
    expect(bits.address).toBe("Kadıköy");
    expect(bits.contact).toBe("Mustafa BAL · Kadıköy");
    expect(shouldCollapseAddress("Kadıköy")).toBe(false);
    expect(shouldCollapseAddress("Kayabaşı Mah. Ulubatlı Hasan Cad. GİRİŞ KAYAŞEHİR")).toBe(true);
    expect(addressToggleLabel(false)).toBe("Göster");
    expect(addressToggleLabel(true)).toBe("Gizle");
    expect(bits.quoteCount).toBe(1);
    expect(bits.quoted).toBe(52.8);
    expect(bits.expense).toBe(18.5);
  });

  it("keeps only the selected contact's projects for the cari tab", () => {
    const rows = [
      { id: "p1", contact_id: "c1", name: "A" },
      { id: "p2", contact_id: "c2", name: "B" },
      { id: "p3", contact_id: "c1", name: "C" },
    ];
    expect(projectsForContact(rows, "c1").map((p) => p.id)).toEqual(["p1", "p3"]);
    expect(projectsForContact(rows, "")).toEqual([]);
  });

  it("enriches overlay contact projects with light list metrics", () => {
    const overlay = [{ id: "p1", contact_id: "c1", name: "A", budget: 10 }];
    const light = [{ id: "p1", contact_id: "c1", name: "A", budget: 10, quote_count: 2, quoted_total: 80, expense_total: 5 }];
    expect(mergeContactProjects(overlay, null)).toEqual(overlay);
    expect(mergeContactProjects(overlay, light)[0].quoted_total).toBe(80);
    expect(mergeContactProjects([], light)).toEqual(light);
  });

  it("picks quotes linked to a project and puts the focused metric first", () => {
    const quotes = [
      { id: "q1", project_id: "p1", quote_number: "TKF-1" },
      { id: "q2", project_id: "p2", quote_number: "TKF-2" },
      { id: "q3", quote_number: "TKF-3" },
    ];
    expect(quotesForProject(quotes, { id: "p1" }).map((q) => q.id)).toEqual(["q1"]);
    expect(quotesForProject(quotes, { id: "p9", quote_id: "q3" }).map((q) => q.id)).toEqual(["q3"]);
    expect(projectMetricSectionOrder("expenses")).toEqual(["expenses", "quotes", "invoices"]);
    expect(projectMetricSectionOrder("")).toEqual(["quotes", "invoices", "expenses"]);
  });

  it("labels create buttons like web", () => {
    expect(newButtonLabel("quote")).toBe("Yeni Teklif");
    expect(newButtonLabel("project")).toBe("Yeni Proje");
    expect(newButtonLabel("survey")).toBe("Yeni Keşif");
    expect(PROJECT_QUOTE_ACTION).toBe("Projeyi Tamamla");
    expect(PROJECT_NEW_QUOTE_ACTION).toBe("Yeni Teklif");
    expect(PROJECT_MAPS_ACTION).toBe("Konuma Git");
    expect(SURVEY_MAPS_ACTION).toBe("Konuma Git");
    expect(projectQuoteNavParams({
      id: "4de8de86-b709-4ff5-9371-09280e82a39b",
      name: "Aa",
      contact_id: "c1",
      contact_name: "Mustafa BAL",
    })).toEqual({
      project_id: "4de8de86-b709-4ff5-9371-09280e82a39b",
      contact_id: "c1",
      contact_name: "Mustafa BAL",
      title: "Aa",
    });
    expect(canCompleteProject("active")).toBe(true);
    expect(canCompleteProject("planning")).toBe(true);
    expect(canCompleteProject("completed")).toBe(false);
  });

  it("builds a stage dropdown that can grow with new statuses", () => {
    const groups = projectStatusSelectGroups("planning");
    expect(groups[0].label).toBe("Aşamalar");
    expect(groups[0].options.map((o) => o.value)).toEqual(PROJECT_STATUSES.map((s) => s.key));
    expect(groups[0].options.map((o) => o.label)).toEqual(["Planlama", "Devam Ediyor", "Beklemede", "Tamamlandı"]);
    const extra = projectStatusSelectGroups("keşif");
    expect(extra[0].options.some((o) => o.value === "keşif" && o.label === "keşif")).toBe(true);
    const custom = projectStatusSelectGroups("active", [{ key: "active", label: "Uygulama" }, { key: "done", label: "Bitti", is_final: true }]);
    expect(custom[0].options.map((o) => o.label)).toEqual(["Uygulama", "Bitti"]);
    expect(workStatusSelectGroups("quote", "draft")[0].options.map((o) => o.value)).toEqual(["draft", "sent", "accepted", "rejected"]);
    expect(workStatusSelectGroups("survey", "planned")[0].label).toBe("Durum");
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

  it("uses the quote item line for both quote and survey", () => {
    expect(workItemLineKind("quote")).toBe("quote");
    expect(workItemLineKind("survey")).toBe("quote");
    expect(workItemLineKind("project")).toBeNull();
  });

  it("keeps line photos off the quote gallery", () => {
    expect(workGalleryWithoutLinePhotos(
      ["/api/files/line.jpg", "/api/files/gallery.jpg", "/api/files/print.jpg", ""],
      [{ image_url: "/api/files/line.jpg", print_image_url: "/api/files/print.jpg" }],
    )).toEqual(["/api/files/gallery.jpg"]);
    expect(workGalleryWithoutLinePhotos(["/api/files/a.jpg"], [])).toEqual(["/api/files/a.jpg"]);
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

  it("puts cari on top of the quote list, number underneath, and omits empty dates", () => {
    expect(quoteListTitle({ contact_name: "Mustafa BAL" })).toBe("Mustafa BAL");
    expect(quoteListTitle({ contact_name: "Mustafa BAL", valid_until: "2026-10-01" })).toBe("Mustafa BAL · 1 Eki 2026");
    expect(quoteListSubtitle({ quote_number: "TKF-2026-0012" })).toBe("TKF-2026-0012");
    expect(quoteListSubtitle({ title: "Villa teklifi" })).toBe("Villa teklifi");
  });

  it("colors quote statuses for the list badge", () => {
    expect(quoteStatusTone("sent")).toBe("amber");
    expect(quoteStatusTone("accepted")).toBe("green");
    expect(quoteStatusTone("rejected")).toBe("red");
    expect(quoteStatusTone("draft")).toBe("slate");
    expect(quoteStatusTone("")).toBe("slate");
    expect(workStatusTone("quote", "sent")).toBe("amber");
    expect(workStatusTone("survey", "done")).toBe("indigo");
    expect(workStatusTone("project", "active")).toBe("green");
    expect(workStatusDotColor("quote", "rejected")).toBe("#E11D48");
  });

  it("shows survey status until the survey is converted to a quote", () => {
    expect(surveyStatusTone("planned")).toBe("slate");
    expect(surveyStatusTone("done")).toBe("indigo");
    expect(isSurveyConverted({ status: "planned" })).toBe(false);
    expect(isSurveyConverted({ status: "done" })).toBe(false);
    expect(isSurveyConverted({ status: "quoted" })).toBe(true);
    expect(isSurveyConverted({ status: "done", quote_id: "q1" })).toBe(true);
    expect(surveyListSubtitle({ contact_name: "Mudenen", address: "", survey_date: "2026-09-18" })).toBe("Mudenen · 18 Eyl 2026");
  });
});
