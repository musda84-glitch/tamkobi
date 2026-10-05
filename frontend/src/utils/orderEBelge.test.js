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

test("GİB mükellef → e-invoice", () => {
  const contacts = [{ id: "c1", is_e_invoice_user: true, name: "Acme" }];
  expect(orderEBelgeType({ contact_id: "c1" }, contacts)).toBe("e_invoice");
  expect(orderCanIssueEFatura({ contact_id: "c1" }, contacts)).toBe(true);
  expect(contactIsEInvoiceUser(contacts[0])).toBe(true);
});

test("menu: taslak siparişte e-Fatura/e-Arşiv yok", () => {
  expect(orderCanShowEBelgeMenu({ contact_id: "x", is_invoiced: false })).toBe(false);
  expect(eBelgeMenuItems({ contact_id: "x" }, []).map((i) => i.eType)).toEqual([]);
  expect(eBelgeMenuItems({ contact_id: "c1", invoice_id: "inv1" }, [{ id: "c1", is_e_invoice_user: true }])).toEqual([]);
});

test("menu: faturalaşmış siparişte yalnızca e-archive unless mükellef", () => {
  expect(eBelgeMenuItems({ contact_id: "x", is_invoiced: true }, []).map((i) => i.eType)).toEqual(["e_archive"]);
  expect(eBelgeMenuItems({ contact_id: "c1", is_invoiced: true }, [{ id: "c1", is_e_invoice_user: true }]).map((i) => i.eType))
    .toEqual(["e_invoice", "e_archive"]);
});

test("menu: GİB kesilmiş siparişte e-belge kesimi yok", () => {
  expect(eBelgeMenuItems({ is_invoiced: true, einvoice_state: "sent" }, [])).toEqual([]);
});

test("resolveOrderContact falls back to order flags", () => {
  expect(resolveOrderContact({ contact_is_e_invoice_user: true })?.is_e_invoice_user).toBe(true);
});
