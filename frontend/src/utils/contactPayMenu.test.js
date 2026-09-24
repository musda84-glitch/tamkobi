import {
  CONTACT_PAY_MENU_ITEMS,
  CONTACT_PAY_MENU_SECTIONS,
  buildContactPayForm,
  contactPayModalMeta,
  pickPayAccount,
} from "./contactPayMenu";

test("tahsilat menu matches Bizim Hesap sections and labels", () => {
  expect(CONTACT_PAY_MENU_SECTIONS.map((s) => s.id)).toEqual(["instruments", "ledger", "transfer"]);
  expect(CONTACT_PAY_MENU_ITEMS.map((i) => i.label)).toEqual([
    "Nakit - Kredi Kartı - Banka",
    "Temassız Kredi Kartı",
    "Çek",
    "Müşteriden Senet Al",
    "Müşteriye Senet Ver",
    "Bakiye düzelt",
    "Borç-Alacak Fişleri",
    "Cari Virman",
  ]);
  expect(CONTACT_PAY_MENU_ITEMS.find((i) => i.id === "virman")).toMatchObject({
    action: "virman",
    badge: "yeni",
  });
  expect(CONTACT_PAY_MENU_ITEMS.find((i) => i.id === "cash").preset.menuId).toBe("cash");
});

test("buildContactPayForm presets cash, cheque, promissory and ledger", () => {
  const accounts = [
    { id: "cash1", type: "cash_box", account_name: "Kasa" },
    { id: "pos1", type: "pos", account_name: "POS" },
    { id: "cc1", type: "credit_card", account_name: "Kart" },
  ];
  const cash = buildContactPayForm({ balance: 120 }, accounts, { method: "cash", menuId: "cash" });
  expect(cash).toMatchObject({ method: "cash", type: "inflow", account_id: "cash1", description: "Cari tahsilat", menuId: "cash" });

  const contactless = buildContactPayForm({ balance: 50 }, accounts, { method: "cash", preferPos: true, menuId: "contactless" });
  expect(contactless.account_id).toBe("pos1");
  expect(contactless.description).toBe("Temassız tahsilat");
  expect(contactless.type).toBe("inflow");

  const cheque = buildContactPayForm({ balance: 10 }, accounts, { method: "cheque", type: "inflow", menuId: "cheque" });
  expect(cheque).toMatchObject({ method: "cheque", type: "inflow", description: "Alınan çek" });

  const senetIn = buildContactPayForm({ balance: 0 }, accounts, { method: "promissory", type: "inflow", menuId: "promissory_in" });
  expect(senetIn).toMatchObject({ method: "promissory", type: "inflow", description: "Alınan senet" });

  const senetOut = buildContactPayForm({ balance: -20 }, accounts, { method: "promissory", type: "outflow", menuId: "promissory_out" });
  expect(senetOut).toMatchObject({ method: "promissory", type: "outflow", description: "Verilen senet" });

  const ledger = buildContactPayForm({ balance: 5 }, accounts, { method: "ledger", menuId: "ledger_slips" });
  expect(ledger).toMatchObject({ method: "ledger", slip: "debit", description: "Borç fişi" });
});

test("bakiye düzelt chooses slip and amount from contact balance", () => {
  const accounts = [{ id: "cash1", type: "cash_box" }];
  const receivable = buildContactPayForm({ balance: 250.5 }, accounts, { method: "ledger", balanceFix: true, menuId: "balance_fix" });
  expect(receivable).toMatchObject({
    method: "ledger",
    slip: "credit",
    amount: "250.50",
    description: "Bakiye düzeltme",
    menuId: "balance_fix",
  });
  const payable = buildContactPayForm({ balance: -80 }, accounts, { method: "ledger", balanceFix: true });
  expect(payable).toMatchObject({ slip: "debit", amount: "80.00", description: "Bakiye düzeltme" });
});

test("contactPayModalMeta locks fields per menu item", () => {
  expect(contactPayModalMeta({ menuId: "cash" })).toMatchObject({
    title: "Nakit / Kredi Kartı / Banka",
    showMethodTabs: false,
    showTypeToggle: true,
  });
  expect(contactPayModalMeta({ menuId: "promissory_in" })).toMatchObject({
    title: "Müşteriden Senet Al",
    showMethodTabs: false,
    showTypeToggle: false,
    lockType: true,
  });
  expect(contactPayModalMeta({ menuId: "balance_fix" })).toMatchObject({
    title: "Bakiye düzelt",
    showSlipToggle: false,
    lockSlip: true,
  });
  expect(contactPayModalMeta({ menuId: "ledger_slips" })).toMatchObject({
    title: "Borç-Alacak Fişi",
    showSlipToggle: true,
  });
  expect(contactPayModalMeta({})).toMatchObject({ showMethodTabs: true });
});

test("pickPayAccount prefers POS when requested and skips credit cards on inflow", () => {
  const accounts = [
    { id: "cc1", type: "credit_card" },
    { id: "bank1", type: "bank" },
    { id: "pos1", type: "okc_pos" },
  ];
  expect(pickPayAccount(accounts, { type: "inflow" })).toBe("bank1");
  expect(pickPayAccount(accounts, { type: "inflow", preferPos: true })).toBe("pos1");
  expect(pickPayAccount(accounts, { type: "outflow" })).toBe("cc1");
});
