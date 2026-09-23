import {
  contactIsEInvoiceUser,
  eBelgeMenuItems,
  orderCanIssueEFatura,
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

test("menu: only e-archive unless mükellef", () => {
  expect(eBelgeMenuItems({ contact_id: "x" }, []).map((i) => i.eType)).toEqual(["e_archive"]);
  expect(eBelgeMenuItems({ contact_id: "c1" }, [{ id: "c1", is_e_invoice_user: true }]).map((i) => i.eType))
    .toEqual(["e_invoice", "e_archive"]);
});

test("resolveOrderContact falls back to order flags", () => {
  expect(resolveOrderContact({ contact_is_e_invoice_user: true })?.is_e_invoice_user).toBe(true);
});
