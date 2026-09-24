import {
  canReturnOrder,
  dispatchMenuLabel,
  eBelgeMenuItems,
  orderMoreMenuSections,
  orderNotifyMessage,
  orderNotifySubject,
  orderToolbarKeys,
  printMenuLabel,
} from "./orderMoreMenu";

describe("orderMoreMenu web ⋮ layout", () => {
  it("keeps toolbar as delete / faturala / kargo / onay / yazdır / more", () => {
    expect(orderToolbarKeys({
      showDelete: true,
      showInvoice: true,
      showCargo: true,
      showApprove: true,
    })).toEqual(["delete", "invoice", "cargo", "approve", "print", "more"]);
  });

  it("shows Faturalandı instead of Faturala and always ends with print + more", () => {
    expect(orderToolbarKeys({ showInvoiced: true })).toEqual(["invoiced", "print", "more"]);
    expect(orderToolbarKeys({})).toEqual(["print", "more"]);
  });

  it("groups E-Belge then edit / irsaliye / iade / etiket / form / bildirim", () => {
    const sections = orderMoreMenuSections({
      showEBelge: true,
      showEFatura: true,
      showEdit: true,
      showReturn: true,
      showProduce: true,
    });
    expect(sections[0]).toEqual({ title: "E-Belge (GİB)", keys: ["efatura", "earsiv"] });
    expect(sections[1].keys).toEqual(["edit", "dispatch", "return", "label", "print", "notify", "prod"]);
  });

  it("hides E-Fatura and iade like web when not allowed", () => {
    expect(eBelgeMenuItems(false).map((i) => i.eType)).toEqual(["e_archive"]);
    expect(eBelgeMenuItems(true).map((i) => i.label)).toEqual(["E-Fatura kes (GİB)", "E-Arşiv kes (GİB)"]);
    const sections = orderMoreMenuSections({ showEBelge: true, showEFatura: false, showReturn: false });
    expect(sections[0].keys).toEqual(["earsiv"]);
    expect(sections[1].keys).toEqual(["dispatch", "label", "print", "notify"]);
    expect(canReturnOrder("returned")).toBe(false);
    expect(canReturnOrder("pending")).toBe(true);
  });

  it("labels dispatch / print / notify like the web menu", () => {
    expect(dispatchMenuLabel(null)).toBe("E-İrsaliye Oluştur & Yazdır");
    expect(dispatchMenuLabel("IRS-1")).toBe("İrsaliye: IRS-1");
    expect(printMenuLabel(false)).toBe("Sipariş Formu Yazdır");
    expect(printMenuLabel(true)).toBe("Sipariş Formu (yazdırıldı)");
    expect(orderNotifySubject("ORD-1")).toBe("Siparişiniz Yola Çıktı - ORD-1");
    expect(orderNotifyMessage({
      customer_name: "Ada",
      order_number: "ORD-1",
      cargo_carrier: "Yurtiçi",
      cargo_tracking_number: "YK123",
    })).toMatch(/Ada.*ORD-1.*Yurtiçi.*YK123/);
  });
});
