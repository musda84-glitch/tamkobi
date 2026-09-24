import { describe, expect, it } from "vitest";
import {
  isIntegrationOrder,
  isPanelOrder,
  orderHasEInvoiceIssued,
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
    expect(labels).toEqual(integrationEInvoiceMoreItems().map((i) => i.label));
    expect(labels[0]).toBe("Siparişin Güncel Durumunu Getir");
    expect(labels).toContain("E-Fatura XML'i İndir");
    expect(labels).toContain("Navlungo Siparişi Oluştur");
  });

  it("panel draft keeps default edit/e-belge style menu", () => {
    const ord = { channel: "b2b", is_invoiced: false, order_number: "B2B-1" };
    expect(orderMoreMenuKind(ord)).toBe("panel_draft");
    const { items } = orderMoreMenuItems(ord, {
      eBelgeItems: [{ eType: "e_archive", label: "E-Arşiv kes (GİB)", testIdSuffix: "earsiv" }],
    });
    expect(items.some((i) => i.id === "edit")).toBe(true);
    expect(items.some((i) => i.id === "ebelge_e_archive")).toBe(true);
    expect(items.some((i) => i.id === "navlungo_create")).toBe(false);
  });
});
