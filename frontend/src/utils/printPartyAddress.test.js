import {
  resolvePrintPartyAddress,
  resolvePrintPartyCity,
  resolvePrintPartyPhone,
} from "./printPartyAddress";

test("prefers document shipping_address", () => {
  expect(resolvePrintPartyAddress(
    { shipping_address: "Cadde 1", address: "X" },
    { address: "Cari Adres" },
  )).toBe("Cadde 1");
});

test("falls back to contact address when doc empty or dash", () => {
  expect(resolvePrintPartyAddress({ shipping_address: "-" }, { address: "Cari Cad." })).toBe("Cari Cad.");
  expect(resolvePrintPartyAddress({}, { address: "Cari Cad." })).toBe("Cari Cad.");
});

test("uses district/city when street missing", () => {
  expect(resolvePrintPartyAddress({}, { district: "Kadıköy", city: "İstanbul" })).toBe("Kadıköy / İstanbul");
});

test("city omitted when already in address", () => {
  expect(resolvePrintPartyCity({ city: "Ankara" }, null, "Cadde Ankara")).toBe("");
  expect(resolvePrintPartyCity({ city: "Ankara" }, null, "Cadde 9")).toBe("Ankara");
});

test("phone from doc then contact", () => {
  expect(resolvePrintPartyPhone({ customer_phone: "0532" }, { phone: "0212" })).toBe("0532");
  expect(resolvePrintPartyPhone({}, { phone: "0212" })).toBe("0212");
});
