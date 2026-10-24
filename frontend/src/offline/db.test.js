if (typeof globalThis.structuredClone !== "function") {
  globalThis.structuredClone = (value) => JSON.parse(JSON.stringify(value));
}
require("fake-indexeddb/auto");
const { mergeDelta, openOfflineDb, readContacts, readPriceLists, readProducts, readStock, sanitizeRecord } = require("./db");

test("delta kaydı şirket bazında birleşir ve sırları yazmaz", async () => {
  const db = openOfflineDb(`offline-${Date.now()}`);
  await mergeDelta(db, "co-a", {
    products: [{ id: "p1", name: "Kalem", sale_price: 5, stock_quantity: 3, password: "gizli", token: "abc", updated_at: "2026-01-01T00:00:00Z" }],
    stock: [{ id: "p1", stock_quantity: 3, iban: "TR00" }],
    contacts: [{ id: "c1", name: "Ada", pin: "1234", tax_number_or_id: "11111111111" }],
    price_lists: [{ id: "p1", sale_price: 5, list_price: 6, api_key: "sekret" }],
  });
  await mergeDelta(db, "co-b", {
    products: [{ id: "p9", name: "Yabancı", sale_price: 1 }],
  });

  const products = await readProducts(db, "co-a");
  expect(products).toHaveLength(1);
  expect(products[0].name).toBe("Kalem");
  expect(products[0].password).toBeUndefined();
  expect(products[0].token).toBeUndefined();
  expect(JSON.stringify(products)).not.toMatch(/gizli|abc/);

  const stock = await readStock(db, "co-a");
  expect(stock[0].stock_quantity).toBe(3);
  expect(stock[0].iban).toBeUndefined();

  const contacts = await readContacts(db, "co-a");
  expect(contacts[0].name).toBe("Ada");
  expect(contacts[0].pin).toBeUndefined();
  expect(contacts[0].tax_number_or_id).toBeUndefined();
  expect(JSON.stringify(contacts)).not.toMatch(/11111111111|1234/);

  const prices = await readPriceLists(db, "co-a");
  expect(prices[0].sale_price).toBe(5);
  expect(prices[0].api_key).toBeUndefined();

  await mergeDelta(db, "co-a", { products: [{ id: "p1", name: "Kalem", sale_price: 9, updated_at: "2026-02-01T00:00:00Z" }] });
  expect((await readProducts(db, "co-a"))[0].sale_price).toBe(9);
  expect(await readProducts(db, "co-b")).toEqual([expect.objectContaining({ name: "Yabancı" })]);
  expect(sanitizeRecord({ name: "A", password_hash: "x" })).toEqual({ name: "A" });
  db.close();
});
