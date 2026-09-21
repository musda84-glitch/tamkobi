import { clampColumnWidth, mergeColumnWidths } from "./columnWidths";

const defaults = { customer_name: 335, actions: 400 };
const limits = { min: { customer_name: 120, actions: 220 }, max: { customer_name: 900, actions: 900 } };

test("merge keeps defaults when nothing was saved", () => {
  expect(mergeColumnWidths(defaults, null, limits)).toEqual(defaults);
});

test("merge applies a saved width and drops junk", () => {
  expect(mergeColumnWidths(defaults, { customer_name: 480, actions: "nope", extra: 10 }, limits)).toEqual({
    customer_name: 480,
    actions: 400,
  });
});

test("clamp respects min and max", () => {
  expect(clampColumnWidth(40, 120, 900)).toBe(120);
  expect(clampColumnWidth(2000, 120, 900)).toBe(900);
  expect(clampColumnWidth("210.4", 120, 900)).toBe(210);
});
