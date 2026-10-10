import {
  isIntegrationOrder,
  isPanelOrder,
  mobilePrimaryAction,
  orderHasEInvoiceIssued,
  orderGibInvoiceNumber,
  orderInvoiceBadge,
  orderMoreMenuItems,
  orderMoreMenuKind,
  integrationEInvoiceMoreItems,
  integrationDraftMoreItems,
  panelDraftMoreItems,
  panelEInvoiceMoreItems,
  isYmd,
  INVOICE_PRINT_SHARE_HINT,
  invoicePrintShareMessage,
} from "./orderMoreMenu";

describe("orderMoreMenu web variants", () => {
  it("classifies marketplace vs panel channels", () => {
    expect(isIntegrationOrder({ channel: "trendyol" })).toBe(true);
    expect(isIntegrationOrder({ channel: "n11" })).toBe(true);
    expect(isPanelOrder({ channel: "b2b" })).toBe(true);
    expect(isPanelOrder({ channel: "manual" })).toBe(true);
    expect(isPanelOrder({ channel: "saha" })).toBe(true);
    expect(isPanelOrder({})).toBe(true);
  });

  it("detects e-invoice issued only after real GİB / integrator send", () => {
    expect(orderHasEInvoiceIssued({ is_invoiced: true, e_type: "e_archive", channel: "b2b" })).toBe(false);
    expect(orderHasEInvoiceIssued({ is_invoiced: true, e_type: "e_archive", channel: "b2b", einvoice_state: "sent" })).toBe(true);
    expect(orderHasEInvoiceIssued({ einvoice_state: "sent" })).toBe(true);
    expect(orderHasEInvoiceIssued({ is_invoiced: true, e_type: "paper", channel: "b2b" })).toBe(false);
    expect(orderHasEInvoiceIssued({ invoice_id: "x", is_invoiced: false })).toBe(false);
    expect(orderHasEInvoiceIssued({ channel: "trendyol", is_invoiced: true, e_type: "e_archive" })).toBe(false);
    expect(orderHasEInvoiceIssued({ channel: "trendyol", is_invoiced: true, e_type: "e_archive", einvoice_state: "sent" })).toBe(true);
    expect(orderHasEInvoiceIssued({ invoice_gib_uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" })).toBe(true);
    expect(orderHasEInvoiceIssued({ invoice_gib_status: "Ziplenmiş — GİB iletimi bekleniyor" })).toBe(true);
    expect(orderHasEInvoiceIssued({ invoice_gib_status: "GİB'e Gönderildi", channel: "b2b" })).toBe(true);
    expect(orderHasEInvoiceIssued({ gib_invoice_id: "U052026000000090" })).toBe(true);
  });

  it("exposes GİB invoice number for the order cell", () => {
    expect(orderGibInvoiceNumber({ gib_invoice_id: "U052026000000090", order_number: "B2B-1" })).toBe("U052026000000090");
    expect(orderGibInvoiceNumber({
      invoice_number: "U052026000000090",
      order_number: "B2B-1",
      einvoice_state: "sent",
    })).toBe("U052026000000090");
    expect(orderGibInvoiceNumber({
      invoice_number: "NX202623431210",
      order_number: "ORD-2026-0060",
      invoice_gib_status: "GİB'e Gönderildi",
    })).toBe("NX202623431210");
    expect(orderGibInvoiceNumber({
      invoice_number: "NX202600000682",
      order_number: "ORD-1",
      invoice_id: "inv1",
      invoice_gib_status: "Taslak",
    })).toBe("");
    expect(orderGibInvoiceNumber({ order_number: "B2B-1", invoice_number: "B2B-1" })).toBe("");
  });

  it("invoice badge: taslak sarı → faturalaştı yeşil → faturalaşmış e-belge kırmızı", () => {
    expect(orderInvoiceBadge({ invoice_id: "i1", is_invoiced: false })).toEqual(
      expect.objectContaining({ label: "Taslak", testId: "draft", interactive: true, tone: "amber" }),
    );
    expect(orderInvoiceBadge({ is_invoiced: true, channel: "b2b", e_type: "e_archive" })).toEqual(
      expect.objectContaining({ label: "Faturalaştı", testId: "invoiced", interactive: true, tone: "green" }),
    );
    expect(orderInvoiceBadge({ is_invoiced: true, channel: "trendyol", e_type: "e_archive" })).toEqual(
      expect.objectContaining({ label: "Faturalaştı", testId: "invoiced", tone: "green" }),
    );
    expect(orderInvoiceBadge({ is_invoiced: true, channel: "b2b", e_type: "e_archive", einvoice_state: "sent" })).toEqual(
      expect.objectContaining({
        label: "Faturalaşmış (E-Arşiv)",
        testId: "ebelge-earsiv",
        interactive: false,
        tone: "rose",
      }),
    );
  });

  it("panel draft hides mini cargo labels until shipment", () => {
    const ord = { channel: "b2b", is_invoiced: false, order_number: "B2B-2026-0011" };
    expect(orderMoreMenuKind(ord)).toBe("panel_draft");
    expect(orderMoreMenuItems(ord).items.map((i) => i.label)).toEqual([
      "Faturalaştır",
      "İrsaliye olarak kaydet",
      "Fatura Tarihi Değiştir",
      "Kargola",
      "Siparişi Sil",
      "Siparişi Excel İndir",
      "Siparişi PDF İndir",
    ]);
    expect(mobilePrimaryAction(ord)).toEqual({ id: "faturalastir", label: "Faturalaştır" });
  });

  it("panel draft shows mini cargo labels after cargo dispatch", () => {
    const ord = {
      channel: "b2b",
      is_invoiced: false,
      order_number: "B2B-1",
      cargo_tracking_number: "YK123",
    };
    const labels = orderMoreMenuItems(ord).items.map((i) => i.label);
    expect(labels).toContain("Mini Kargo Etiketi Yazdır");
    expect(labels).toContain("Mini Kargo Etiketi Yazdır 10X10");
  });

  it("B2B + GİB e-belge uses panel e-invoice ops menu", () => {
    const ord = { channel: "b2b", is_invoiced: true, e_type: "e_archive", einvoice_state: "sent", order_number: "B2B-2026-0009" };
    expect(orderMoreMenuKind(ord)).toBe("panel_einvoice");
    expect(orderMoreMenuItems(ord).items.map((i) => i.label)).toEqual(panelEInvoiceMoreItems(ord).map((i) => i.label));
    expect(mobilePrimaryAction(ord)).toEqual({ id: "mini_10x15", label: "E-Arşiv" });
    expect(orderMoreMenuItems(ord).items.map((i) => i.label)).not.toContain("E-Fatura Oluştur");
  });

  it("panel invoiced shows E-Fatura Oluştur menu (no GİB yet)", () => {
    const ord = { channel: "b2b", is_invoiced: true, e_type: "e_archive" };
    expect(orderMoreMenuKind(ord)).toBe("panel_invoiced");
    expect(orderMoreMenuItems(ord).items.map((i) => i.label)).toEqual([
      "E-Fatura Oluştur",
      "Kargola",
    ]);
    expect(orderMoreMenuItems(ord).items.map((i) => i.id)).not.toContain("delete");
    expect(mobilePrimaryAction(ord)?.label).toBe("E-Fatura");
  });

  it("integration invoiced without GİB shows Faturalaştı menu", () => {
    const ord = { channel: "trendyol", is_invoiced: true, e_type: "e_archive", order_number: "908188687" };
    expect(orderMoreMenuKind(ord)).toBe("panel_invoiced");
    expect(orderInvoiceBadge(ord)?.label).toBe("Faturalaştı");
    expect(orderMoreMenuItems(ord).items.map((i) => i.label)).toEqual([
      "E-Fatura Oluştur",
      "Mini Kargo Etiketi Yazdır",
      "Mini Kargo Etiketi Yazdır 10X10",
      "Kargola",
    ]);
  });

  it("integration + GİB e-invoice uses marketplace fulfillment menu", () => {
    const ord = { channel: "trendyol", is_invoiced: true, e_type: "e_archive", einvoice_state: "sent" };
    expect(orderMoreMenuKind(ord)).toBe("integration_einvoice");
    const labels = orderMoreMenuItems(ord).items.map((i) => i.label);
    expect(labels.slice(0, -2)).toEqual(integrationEInvoiceMoreItems().map((i) => i.label));
    expect(labels).toContain("Kargola");
    expect(labels).toContain("Depo Bilgisi Güncelle");
    expect(labels).toContain("Paketli Siparişin Kargo Firmasını Değiştir");
    expect(labels).toContain("E-Fatura PDF İndir");
    expect(labels).toContain("Siparişi Excel İndir");
  });

  it("uninvoiced marketplace uses reference fulfillment menu", () => {
    const ord = { channel: "trendyol", is_invoiced: false, order_number: "11693105570" };
    expect(orderMoreMenuKind(ord)).toBe("integration_draft");
    const labels = orderMoreMenuItems(ord).items.map((i) => i.label);
    expect(labels).toEqual(integrationDraftMoreItems().map((i) => i.label));
    expect(labels).toEqual([
      "Siparişin Güncel Durumunu Getir",
      "Faturalaştır",
      "Mini Kargo Etiketi Yazdır",
      "Mini Kargo Etiketi Yazdır 10X10",
      "Fatura Tarihi Değiştir",
      "Kargo Takip Kodu Bildir",
      "Dijital Kod Bildir",
      "Depo Bilgisi Güncelle",
      "Kargola",
      "Paketli Siparişin Kargo Firmasını Değiştir",
    ]);
    expect(labels).not.toContain("Siparişi Düzenle");
    expect(labels).not.toContain("Siparişi Excel İndir");
    expect(labels).not.toContain("Siparişi Sil");
    expect(mobilePrimaryAction(ord)).toEqual({ id: "faturalastir", label: "Faturalaştır" });
  });

  it("panel draft ids match web", () => {
    expect(panelDraftMoreItems({ channel: "b2b", cargo_tracking_number: "X" }).map((i) => i.id)).toEqual([
      "faturalastir",
      "dispatch",
      "cargo_mini",
      "cargo_10x10",
      "invoice_date",
      "kargola",
    ]);
    expect(isYmd("2026-09-24")).toBe(true);
    expect(isYmd("24.09.2026")).toBe(false);
  });

  it("hides delete when a draft or issued invoice exists", () => {
    expect(orderMoreMenuItems({ channel: "b2b", is_invoiced: false, invoice_id: "inv1" }).items.map((i) => i.id)).not.toContain("delete");
    expect(orderMoreMenuItems({ channel: "b2b", is_invoiced: true, e_type: "e_archive", einvoice_state: "sent" }).items.map((i) => i.id)).not.toContain("delete");
  });

  it("held / active cart menus expose no more-menu actions", () => {
    for (const ord of [
      { channel: "b2b", order_status: "held_cart", is_held_cart: true },
      { channel: "b2b", order_status: "active_cart", is_active_cart: true },
    ]) {
      expect(orderMoreMenuKind(ord)).toBe("held_cart");
      expect(orderMoreMenuItems(ord).items.map((i) => i.id)).toEqual([]);
      expect(mobilePrimaryAction(ord)).toBeNull();
    }
  });

  it("Yazdır & Gönder is print/email/WhatsApp only", () => {
    const share = panelEInvoiceMoreItems({ e_type: "e_archive", einvoice_state: "sent" }).find((i) => i.id === "earsiv_send");
    expect(share?.hint).toBe(INVOICE_PRINT_SHARE_HINT);
    const msg = invoicePrintShareMessage({ customer_name: "Acme", gib_invoice_id: "U05", e_type: "e_invoice" }, "https://x/pdf");
    expect(msg).toContain("Acme");
    expect(msg).toContain("E-Fatura");
    expect(msg).toContain("https://x/pdf");
    expect(msg.toLowerCase()).not.toContain("gib gönder");
  });
});
