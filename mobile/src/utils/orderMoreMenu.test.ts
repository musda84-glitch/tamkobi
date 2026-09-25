import {
  isIntegrationOrder,
  isPanelOrder,
  mobilePrimaryAction,
  orderHasEInvoiceIssued,
  orderMoreMenuItems,
  orderMoreMenuKind,
  integrationEInvoiceMoreItems,
  panelDraftMoreItems,
  panelEInvoiceMoreItems,
  isYmd,
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

  it("detects e-invoice issued", () => {
    expect(orderHasEInvoiceIssued({ is_invoiced: true, e_type: "e_archive" })).toBe(true);
    expect(orderHasEInvoiceIssued({ einvoice_state: "sent" })).toBe(true);
    expect(orderHasEInvoiceIssued({ is_invoiced: true, e_type: "paper" })).toBe(false);
    expect(orderHasEInvoiceIssued({ invoice_id: "x", is_invoiced: false })).toBe(false);
  });

  it("B2B draft uses Faturalaştır / Kargola — not the default E-Belge list", () => {
    const ord = { channel: "b2b", is_invoiced: false, order_number: "B2B-2026-0011" };
    expect(orderMoreMenuKind(ord)).toBe("panel_draft");
    expect(orderMoreMenuItems(ord).items.map((i) => i.label)).toEqual([
      "Faturalaştır",
      "Mini Kargo Etiketi Yazdır",
      "Mini Kargo Etiketi Yazdır 10X10",
      "Fatura Tarihi Değiştir",
      "Kargola",
      "Siparişi Sil",
    ]);
    expect(mobilePrimaryAction(ord)).toEqual({ id: "faturalastir", label: "Faturalaştır" });
    expect(orderMoreMenuItems(ord).items.map((i) => i.label).join(" ")).not.toMatch(/İade Al|Üretim emri|E-İrsaliye/);
  });

  it("B2B + GİB e-belge uses panel e-invoice ops menu", () => {
    const ord = { channel: "b2b", is_invoiced: true, e_type: "e_archive", order_number: "B2B-2026-0009" };
    expect(orderMoreMenuKind(ord)).toBe("panel_einvoice");
    expect(orderMoreMenuItems(ord).items.map((i) => i.label)).toEqual(panelEInvoiceMoreItems().map((i) => i.label));
    expect(mobilePrimaryAction(ord)).toEqual({ id: "mini_10x15", label: "E-Arşiv" });
    expect(orderMoreMenuItems(ord).items.map((i) => i.label)).not.toContain("E-Fatura Oluştur");
  });

  it("panel invoiced shows E-Fatura Oluştur menu", () => {
    const ord = { channel: "b2b", is_invoiced: true, e_type: "paper" };
    expect(orderMoreMenuKind(ord)).toBe("panel_invoiced");
    expect(orderMoreMenuItems(ord).items.map((i) => i.label)).toEqual([
      "E-Fatura Oluştur",
      "Mini Kargo Etiketi Yazdır",
      "Mini Kargo Etiketi Yazdır 10X10",
      "Fatura Tarihi Değiştir",
      "Kargola",
    ]);
    expect(orderMoreMenuItems(ord).items.map((i) => i.id)).not.toContain("delete");
    expect(mobilePrimaryAction(ord)?.label).toBe("E-Fatura");
  });

  it("integration + e-invoice uses marketplace fulfillment menu", () => {
    const ord = { channel: "trendyol", is_invoiced: true, e_type: "e_archive" };
    expect(orderMoreMenuKind(ord)).toBe("integration_einvoice");
    expect(orderMoreMenuItems(ord).items.map((i) => i.label)).toEqual(
      integrationEInvoiceMoreItems().map((i) => i.label),
    );
    expect(orderMoreMenuItems(ord).items.map((i) => i.label)).toContain("Kargola");
    expect(orderMoreMenuItems(ord).items.map((i) => i.id)).toContain("kargola");
    expect(orderMoreMenuItems(ord).items.map((i) => i.label)).not.toContain("Navlungo Siparişi Oluştur");
    expect(orderMoreMenuItems(ord).items.map((i) => i.label)).toContain("Pazaryeri Kargo Firmasını Değiştir");
    expect(orderMoreMenuItems(ord).items.map((i) => i.label)).not.toContain("Paketli Siparişin Kargo Firmasını Değiştir");
  });

  it("default menu keeps E-Belge + edit / irsaliye / iade", () => {
    const ord = { channel: "trendyol", is_invoiced: false };
    expect(orderMoreMenuKind(ord)).toBe("default");
    const labels = orderMoreMenuItems(ord, {
      eBelgeItems: [{ eType: "e_archive", label: "E-Arşiv kes (GİB)", testIdSuffix: "earsiv" }],
    }).items.map((i) => i.label);
    expect(labels[0]).toBe("E-Arşiv kes (GİB)");
    expect(labels).toContain("Siparişi Düzenle");
    expect(labels).toContain("İade Al");
    expect(labels).toContain("Siparişi Sil");
    expect(labels).not.toContain("Üretim emri");
  });

  it("panel draft ids match web", () => {
    expect(panelDraftMoreItems().map((i) => i.id)).toEqual([
      "faturalastir",
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
    expect(orderMoreMenuItems({ channel: "b2b", is_invoiced: true, e_type: "e_archive" }).items.map((i) => i.id)).not.toContain("delete");
  });

  it("held / active cart menus only expose delete", () => {
    for (const ord of [
      { channel: "b2b", order_status: "held_cart", is_held_cart: true },
      { channel: "b2b", order_status: "active_cart", is_active_cart: true },
    ]) {
      expect(orderMoreMenuKind(ord)).toBe("held_cart");
      expect(orderMoreMenuItems(ord).items.map((i) => i.id)).toEqual(["delete"]);
      expect(mobilePrimaryAction(ord)).toEqual({ id: "delete", label: "Sil" });
    }
  });
});
