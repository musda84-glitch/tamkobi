/**
 * @jest-environment jsdom
 */
import {
  LABEL_BOX_MIN_STROKE_MM,
  labelLineThicknessMm,
  labelStrokeMm,
  labelStrokePx,
} from "./labelBoxStroke";

describe("labelBoxStroke", () => {
  test("enforces minimum stroke for thermal", () => {
    expect(labelStrokeMm(0.1)).toBe(LABEL_BOX_MIN_STROKE_MM);
    expect(labelStrokeMm(0.3)).toBe(LABEL_BOX_MIN_STROKE_MM);
    expect(labelStrokeMm(0.8)).toBe(0.8);
    expect(labelStrokeMm(undefined)).toBe(LABEL_BOX_MIN_STROKE_MM);
  });

  test("stroke px scales with mm and zoom", () => {
    expect(labelStrokePx(0.5, 1)).toBeCloseTo(0.5 * 3.78, 5);
    expect(labelStrokePx(0.1, 1.4)).toBeCloseTo(LABEL_BOX_MIN_STROKE_MM * 3.78 * 1.4, 5);
  });

  test("line thickness floor", () => {
    expect(labelLineThicknessMm(0.2)).toBe(0.5);
    expect(labelLineThicknessMm(1)).toBe(1);
  });
});
