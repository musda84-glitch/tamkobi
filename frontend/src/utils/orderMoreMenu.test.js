import { describe, expect, it } from "@jest/globals";
import {
  isIntegrationOrder,
  isPanelOrder,
  orderHasEInvoiceIssued,
  orderGibInvoiceNumber,
  orderInvoiceBadge,
  orderMoreMenuKind,
  orderMoreMenuItems,
  integrationEInvoiceMoreItems,
} from "./orderMoreMenu";

describe("orderMoreMenu", () => {
  it("classifies marketplace vs panel channels", () => {
    expect(isIntegrationOrder({ channel: "trendyol" })).toBe(true);
    expect(isIntegrationOrder({ channel: "n11" })).toBe(true);
    expect(isPanelOrder({ channel: "b2b" })).toBe(true);
    expect(isPanelOrder({ channel: "manual" })).toBe(true);
    expect(isPanelOrder({ channel: "saha" })).toBe(true);
    expect(isPanelOrder({})).toBe(true);
  });

  it("detects e-invoice issued only after GİB send on panel", () => {
    expect(orderHasEInvoiceIssued({ is_invoiced: true, e_type: "e_archive", channel: "b2b" })).toBe(false);
    expect(orderHasEInvoiceIssued({ is_invoiced: true, e_type: "e_archive", channel: "b2b", einvoice_state: "sent" })).toBe(true);
    expect(orderHasEInvoiceIssued({ einvoice_state: "sent" })).toBe(true);
    expect(orderHasEInvoiceIssued({ is_invoiced: true, e_type: "paper", channel: "b2b" })).toBe(false);
    expect(orderHasEInvoiceIssued({ invoice_id: "x", is_invoiced: false })).toBe(false);
    expect(orderHasEInvoiceIssued({ channel: "trendyol", is_invoiced: true, e_type: "e_archive" })).toBe(true);
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
    // Taslak / yalnızca invoice_id — GİB satırı yok
    expect(orderGibInvoiceNumber({
      invoice_number: "NX202600000682",
      order_number: "ORD-1",
      invoice_id: "inv1",
      invoice_gib_status: "Taslak",
    })).toBe("");
    expect(orderGibInvoiceNumber({ order_number: "B2B-1", invoice_number: "B2B-1" })).toBe("");
  });

  it("invoice badge: taslak sarı → faturalaştı yeşil → faturalaşmış e-fatura/e-arşiv kırmızı bilgi", () => {
    expect(orderInvoiceBadge({ invoice_id: "i1", is_invoiced: false })).toEqual(
      expect.objectContaining({ label: "Taslak", testId: "draft", interactive: true }),
    );
    expect(orderInvoiceBadge({ is_invoiced: true, channel: "b2b", e_type: "e_archive" })).toEqual(
      expect.objectContaining({ label: "Faturalaştı", testId: "invoiced", interactive: true }),
    );
    expect(orderInvoiceBadge({ is_invoiced: true, channel: "b2b", e_type: "e_archive", einvoice_state: "sent" })).toEqual(
      expect.objectContaining({
        label: "Faturalaşmış (E-Arşiv)",
        line1: "Faturalaşmış",
        line2: "(E-Arşiv)",
        testId: "ebelge-earsiv",
        interactive: false,
        className: expect.stringContaining("rose-600"),
      }),
    );
    expect(orderInvoiceBadge({ is_invoiced: true, channel: "b2b", e_type: "e_invoice", einvoice_state: "sent" })).toEqual(
      expect.objectContaining({
        label: "Faturalaşmış (E-Fatura)",
        line1: "Faturalaşmış",
        line2: "(E-Fatura)",
        testId: "ebelge-efatura",
        interactive: false,
        className: expect.stringContaining("rose-600"),
      }),
    );
  });

  it("integration + e-invoice uses marketplace fulfillment menu", () => {
    const ord = { channel: "trendyol", is_invoiced: true, e_type: "e_archive", order_number: "TY-1" };
    expect(orderMoreMenuKind(ord)).toBe("integration_einvoice");
    const { items } = orderMoreMenuItems(ord);
    const labels = items.map((i) => i.label);
    expect(labels.slice(0, -2)).toEqual(integrationEInvoiceMoreItems().map((i) => i.label));
    expect(labels[0]).toBe("Siparişin Güncel Durumunu Getir");
    expect(labels).toContain("E-Fatura XML'i İndir");
    expect(labels).toContain("E-Fatura PDF İndir");
    expect(labels).toContain("Kargola");
    expect(labels).not.toContain("Navlungo Siparişi Oluştur");
    expect(labels).toContain("Pazaryeri Kargo Firmasını Değiştir");
    expect(labels).toContain("Siparişi Excel İndir");
    expect(labels).toContain("Siparişi PDF İndir");
  });

  it("panel draft (B2B/manual) shows Faturalaştır / İrsaliye / Kargola menu", () => {
    const ord = { channel: "b2b", is_invoiced: false, order_number: "B2B-1" };
    expect(orderMoreMenuKind(ord)).toBe("panel_draft");
    const { items } = orderMoreMenuItems(ord);
    expect(items.map((i) => i.label)).toEqual([
      "Faturalaştır",
      "İrsaliye olarak kaydet",
      "Mini Kargo Etiketi Yazdır",
      "Mini Kargo Etiketi Yazdır 10X10",
      "Fatura Tarihi Değiştir",
      "Kargola",
      "Siparişi Sil",
      "Siparişi Excel İndir",
      "Siparişi PDF İndir",
    ]);
  });

  it("manual panel draft uses same short menu", () => {
    const ord = { channel: "manual", is_invoiced: false, order_number: "ORD-1" };
    expect(orderMoreMenuKind(ord)).toBe("panel_draft");
    expect(orderMoreMenuItems(ord).items.map((i) => i.id)).toContain("faturalastir");
  });

  it("panel invoiced (cari) shows E-Fatura Oluştur + kargo menüsü", () => {
    const ord = { channel: "b2b", is_invoiced: true, e_type: "e_archive", order_number: "B2B-2" };
    expect(orderMoreMenuKind(ord)).toBe("panel_invoiced");
    const { items } = orderMoreMenuItems(ord);
    expect(items.map((i) => i.label)).toEqual([
      "E-Fatura Oluştur",
      "Mini Kargo Etiketi Yazdır",
      "Mini Kargo Etiketi Yazdır 10X10",
      "Kargola",
    ]);
    expect(items[0].id).toBe("efatura_olustur");
    expect(items.map((i) => i.label)).not.toContain("Siparişi Excel İndir");
  });

  it("default uninvoiced marketplace menu hides E-Fatura / E-Arşiv kes", () => {
    const ord = { channel: "trendyol", is_invoiced: false, order_number: "TY-2" };
    const labels = orderMoreMenuItems(ord, {
      eBelgeItems: [{ eType: "e_archive", label: "E-Arşiv kes (GİB)", testIdSuffix: "earsiv" }],
    }).items.map((i) => i.label);
    expect(labels).not.toContain("E-Arşiv kes (GİB)");
    expect(labels).not.toContain("E-Fatura kes (GİB)");
    expect(labels).toContain("Siparişi Düzenle");
  });

  it("panel invoiced ignores eBelgeItems — tek E-Fatura Oluştur satırı", () => {
    const ord = { channel: "b2b", is_invoiced: true, e_type: "paper", order_number: "B2B-3" };
    expect(orderMoreMenuItems(ord, {
      eBelgeItems: [{ eType: "e_invoice", label: "E-Fatura kes (GİB)", testIdSuffix: "efatura" }],
    }).items.map((i) => i.label)[0]).toBe("E-Fatura Oluştur");
  });

  it("B2B + GİB e-belge uses panel e-invoice ops menu (E-Arşiv etiketleri)", () => {
    const ord = { channel: "b2b", is_invoiced: true, e_type: "e_archive", einvoice_state: "sent", order_number: "B2B-2026-0009" };
    expect(orderMoreMenuKind(ord)).toBe("panel_einvoice");
    expect(orderMoreMenuItems(ord).items.map((i) => i.label)).toEqual([
      "Mini E-Arşiv Yazdır (10X15cm)",
      "Mini E-Arşiv Yazdır (8X20cm)",
      "Mini Kargo Etiketi Yazdır",
      "Mini Kargo Etiketi Yazdır 10X10",
      "E-Arşiv Yazdır & Gönder",
      "Kargola",
      "E-Arşiv XML'i İndir",
      "E-Arşiv PDF İndir",
    ]);
    expect(orderMoreMenuItems(ord).items.map((i) => i.label)).not.toContain("E-Fatura Oluştur");
    expect(orderMoreMenuItems(ord).items.map((i) => i.label)).not.toContain("Siparişi Excel İndir");
  });

  it("B2B + GİB e-fatura uses E-Fatura labeled ops menu", () => {
    const ord = { channel: "b2b", is_invoiced: true, e_type: "e_invoice", einvoice_state: "sent", order_number: "B2B-2026-0025" };
    expect(orderMoreMenuKind(ord)).toBe("panel_einvoice");
    expect(orderMoreMenuItems(ord).items.map((i) => i.label)).toEqual([
      "Mini E-Fatura Yazdır (10X15cm)",
      "Mini E-Fatura Yazdır (8X20cm)",
      "Mini Kargo Etiketi Yazdır",
      "Mini Kargo Etiketi Yazdır 10X10",
      "E-Fatura Yazdır & Gönder",
      "Kargola",
      "E-Fatura XML'i İndir",
      "E-Fatura PDF İndir",
    ]);
  });

  it("held / active cart menus expose no more-menu actions", () => {
    for (const ord of [
      { channel: "b2b", order_status: "held_cart", is_held_cart: true, order_number: "BH-1" },
      { channel: "b2b", order_status: "active_cart", is_active_cart: true, order_number: "BA-1" },
    ]) {
      expect(orderMoreMenuKind(ord)).toBe("held_cart");
      expect(orderMoreMenuItems(ord).items.map((i) => i.id)).toEqual([]);
      expect(orderMoreMenuItems(ord).items.map((i) => i.label)).not.toContain("Siparişi Excel İndir");
      expect(orderMoreMenuItems(ord).items.map((i) => i.label)).not.toContain("Siparişi Sil");
    }
  });
});
