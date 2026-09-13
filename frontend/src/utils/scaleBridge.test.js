import { isWeighableUnit, parseScaleWeight } from "./scaleBridge";

test("isWeighableUnit detects kg-like units", () => {
  expect(isWeighableUnit("Kg")).toBe(true);
  expect(isWeighableUnit("kg")).toBe(true);
  expect(isWeighableUnit("Adet")).toBe(false);
  expect(isWeighableUnit("Lt")).toBe(true);
});

test("parseScaleWeight reads common scale formats", () => {
  expect(parseScaleWeight("1.250 kg")).toBe(1.25);
  expect(parseScaleWeight("ST,GS,+  0.500kg")).toBe(0.5);
  expect(parseScaleWeight("500 g")).toBe(0.5);
});
