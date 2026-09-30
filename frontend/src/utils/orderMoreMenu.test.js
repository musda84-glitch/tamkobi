import { describe, expect, it } from "@jest/globals";
import {
  isIntegrationOrder,
  isPanelOrder,
  orderHasEInvoiceIssued,
  orderInvoiceBadge,
  orderMoreMenuKind,
  orderMoreMenuItems,
  integrationEInvoiceMoreItems,
  panelEInvoiceMoreItems,
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
    expect(labels).toContain("Kargola");
    expect(labels).not.toContain("Navlungo Siparişi Oluştur");
    expect(labels).toContain("Pazaryeri Kargo Firmasını Değiştir");
    expect(labels).toContain("Siparişi Excel İndir");
    expect(labels).toContain("Siparişi PDF İndir");
  });

  it("panel draft (B2B/manual) shows Faturalaştır / Kargola menu", () => {
    const ord = { channel: "b2b", is_invoiced: false, order_number: "B2B-1" };
    expect(orderMoreMenuKind(ord)).toBe("panel_draft");
    const { items } = orderMoreMenuItems(ord);
    expect(items.map((i) => i.label)).toEqual([
      "Faturalaştır",
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

  it("panel invoiced ignores eBelgeItems — tek E-Fatura Oluştur satırı", () => {
    const ord = { channel: "b2b", is_invoiced: true, e_type: "paper", order_number: "B2B-3" };
    expect(orderMoreMenuItems(ord, {
      eBelgeItems: [{ eType: "e_invoice", label: "E-Fatura kes (GİB)", testIdSuffix: "efatura" }],
    }).items.map((i) => i.label)[0]).toBe("E-Fatura Oluştur");
  });

  it("B2B + GİB e-belge uses panel e-invoice ops menu on web and mobile", () => {
    const ord = { channel: "b2b", is_invoiced: true, e_type: "e_archive", einvoice_state: "sent", order_number: "B2B-2026-0009" };
    expect(orderMoreMenuKind(ord)).toBe("panel_einvoice");
    expect(orderMoreMenuItems(ord).items.map((i) => i.label).slice(0, -2)).toEqual(panelEInvoiceMoreItems().map((i) => i.label));
    expect(orderMoreMenuItems(ord).items.map((i) => i.label)).toContain("Mini E-Arşiv Yazdır (10X15cm)");
    expect(orderMoreMenuItems(ord).items.map((i) => i.label)).toContain("E-Fatura XML'i İndir");
    expect(orderMoreMenuItems(ord).items.map((i) => i.label)).toContain("Siparişi Excel İndir");
    expect(orderMoreMenuItems(ord).items.map((i) => i.label)).toContain("Siparişi PDF İndir");
    expect(orderMoreMenuItems(ord).items.map((i) => i.label)).not.toContain("E-Belge Kes");
    expect(orderMoreMenuItems(ord).items.map((i) => i.label)).not.toContain("Navlungo Siparişi Oluştur");
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
