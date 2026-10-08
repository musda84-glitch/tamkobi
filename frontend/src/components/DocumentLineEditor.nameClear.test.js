/**
 * @jest-environment jsdom
 */
import { computeLine, emptyLine } from "../utils/documentLines";

/** DocumentLineEditor patch senkronu: name temizlenince product_name da boşalır. */
function patchName(item, value) {
  const updated = { ...item, name: value, product_name: value };
  return computeLine(updated, "name");
}

test("kalem adı tamamen silinebilir", () => {
  let row = computeLine({
    ...emptyLine(),
    name: "Namaz Kıble Ibadet Mihrab",
    product_name: "Namaz Kıble Ibadet Mihrab",
    quantity: 1,
    unit_price: 100,
  });
  row = patchName(row, "Namaz");
  expect(row.name).toBe("Namaz");
  row = patchName(row, "");
  expect(row.name).toBe("");
  expect(row.product_name).toBe("");
});
