import {
  contactIsEInvoiceUser,
  eBelgeMenuItems,
  orderCanIssueEFatura,
  orderCanShowEBelgeMenu,
  orderEBelgeType,
  resolveOrderContact,
} from "./orderEBelge";

test("missing mükellef info defaults to e-archive", () => {
  expect(orderEBelgeType({ contact_id: "c1" }, [])).toBe("e_archive");
  expect(orderEBelgeType({}, [])).toBe("e_archive");
  expect(orderCanIssueEFatura({ contact_id: "c1" }, [{ id: "c1", is_e_invoice_user: false }])).toBe(false);
});

test("cari bayrağı e-fatura kararı vermez; canlı GİB sonucu verir", () => {
  const contacts = [{ id: "c1", is_e_invoice_user: true, name: "Acme" }];
  expect(orderEBelgeType({ contact_id: "c1" }, contacts)).toBe("e_archive");
  expect(orderCanIssueEFatura({ contact_id: "c1" }, contacts)).toBe(false);
  const gib = { is_e_invoice_user: true, suggested_e_type: "e_invoice" };
  expect(orderEBelgeType({ contact_id: "c1" }, contacts, gib)).toBe("e_invoice");
  expect(orderCanIssueEFatura({ contact_id: "c1" }, contacts, gib)).toBe(true);
  expect(contactIsEInvoiceUser(contacts[0])).toBe(true);
});

test("menu: taslak siparişte e-Fatura/e-Arşiv yok", () => {
  expect(orderCanShowEBelgeMenu({ contact_id: "x", is_invoiced: false })).toBe(false);
  expect(eBelgeMenuItems({ contact_id: "x" }, []).map((i) => i.eType)).toEqual([]);
  expect(eBelgeMenuItems({ contact_id: "c1", invoice_id: "inv1" }, [{ id: "c1", is_e_invoice_user: true }])).toEqual([]);
});

test("menu: faturalaşmış siparişte e-fatura yalnız GİB mükellefiyse", () => {
  expect(eBelgeMenuItems({ contact_id: "x", is_invoiced: true }, []).map((i) => i.eType)).toEqual(["e_archive"]);
  expect(eBelgeMenuItems({ contact_id: "c1", is_invoiced: true }, [{ id: "c1", is_e_invoice_user: true }]).map((i) => i.eType))
    .toEqual(["e_archive"]);
  const gib = { is_e_invoice_user: true, suggested_e_type: "e_invoice" };
  expect(eBelgeMenuItems({ contact_id: "c1", is_invoiced: true }, [], gib).map((i) => i.eType))
    .toEqual(["e_invoice", "e_archive"]);
});

test("menu: GİB kesilmiş siparişte e-belge kesimi yok", () => {
  expect(eBelgeMenuItems({
    is_invoiced: true,
    e_type: "e_archive",
    einvoice_state: "sent",
    gib_uuid: "u-1",
  }, [])).toEqual([]);
});

test("resolveOrderContact falls back to order flags", () => {
  expect(resolveOrderContact({ contact_is_e_invoice_user: true })?.is_e_invoice_user).toBe(true);
});
