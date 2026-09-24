import { describe, expect, it } from "vitest";
import {
  isIntegrationOrder,
  isPanelOrder,
  orderHasEInvoiceIssued,
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

  it("detects e-invoice issued", () => {
    expect(orderHasEInvoiceIssued({ is_invoiced: true, e_type: "e_archive" })).toBe(true);
    expect(orderHasEInvoiceIssued({ einvoice_state: "sent" })).toBe(true);
    expect(orderHasEInvoiceIssued({ is_invoiced: true, e_type: "paper" })).toBe(false);
    expect(orderHasEInvoiceIssued({ invoice_id: "x", is_invoiced: false })).toBe(false);
  });

  it("integration + e-invoice uses marketplace fulfillment menu", () => {
    const ord = { channel: "trendyol", is_invoiced: true, e_type: "e_archive", order_number: "TY-1" };
    expect(orderMoreMenuKind(ord)).toBe("integration_einvoice");
    const { items } = orderMoreMenuItems(ord);
    const labels = items.map((i) => i.label);
    expect(labels.slice(0, -2)).toEqual(integrationEInvoiceMoreItems().map((i) => i.label));
    expect(labels[0]).toBe("Siparişin Güncel Durumunu Getir");
    expect(labels).toContain("E-Fatura XML'i İndir");
    expect(labels).toContain("Navlungo Siparişi Oluştur");
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

  it("panel invoiced shows E-Fatura Oluştur menu", () => {
    const ord = { channel: "b2b", is_invoiced: true, e_type: "paper", order_number: "B2B-2" };
    expect(orderMoreMenuKind(ord)).toBe("panel_invoiced");
    expect(orderMoreMenuItems(ord).items.map((i) => i.label)).toEqual([
      "E-Fatura Oluştur",
      "Mini Kargo Etiketi Yazdır",
      "Mini Kargo Etiketi Yazdır 10X10",
      "Fatura Tarihi Değiştir",
      "Kargola",
      "Siparişi Excel İndir",
      "Siparişi PDF İndir",
    ]);
  });

  it("B2B + GİB e-belge uses panel e-invoice ops menu on web and mobile", () => {
    const ord = { channel: "b2b", is_invoiced: true, e_type: "e_archive", order_number: "B2B-2026-0009" };
    expect(orderMoreMenuKind(ord)).toBe("panel_einvoice");
    expect(orderMoreMenuItems(ord).items.map((i) => i.label).slice(0, -2)).toEqual(panelEInvoiceMoreItems().map((i) => i.label));
    expect(orderMoreMenuItems(ord).items.map((i) => i.label)).toContain("Mini E-Arşiv Yazdır (10X15cm)");
    expect(orderMoreMenuItems(ord).items.map((i) => i.label)).toContain("E-Fatura XML'i İndir");
    expect(orderMoreMenuItems(ord).items.map((i) => i.label)).toContain("Siparişi Excel İndir");
    expect(orderMoreMenuItems(ord).items.map((i) => i.label)).toContain("Siparişi PDF İndir");
    expect(orderMoreMenuItems(ord).items.map((i) => i.label)).not.toContain("E-Fatura Oluştur");
    expect(orderMoreMenuItems(ord).items.map((i) => i.label)).not.toContain("Navlungo Siparişi Oluştur");
  });
});
