/**
 * @jest-environment jsdom
 */
import {
  LABEL_BOX_DEFAULT_STROKE_MM,
  LABEL_BOX_MIN_STROKE_MM,
  labelLineThicknessMm,
  labelStrokeMm,
  labelStrokePx,
} from "./labelBoxStroke";

describe("labelBoxStroke", () => {
  test("allows thin strokes down to 0.1 mm", () => {
    expect(LABEL_BOX_MIN_STROKE_MM).toBe(0.1);
    expect(labelStrokeMm(0.1)).toBe(0.1);
    expect(labelStrokeMm(0.2)).toBe(0.2);
    expect(labelStrokeMm(0.3)).toBe(0.3);
    expect(labelStrokeMm(0.8)).toBe(0.8);
    expect(labelStrokeMm(0.05)).toBe(LABEL_BOX_MIN_STROKE_MM);
    expect(labelStrokeMm(undefined)).toBe(LABEL_BOX_DEFAULT_STROKE_MM);
  });

  test("stroke px scales with mm and zoom", () => {
    expect(labelStrokePx(0.5, 1)).toBeCloseTo(0.5 * 3.78, 5);
    expect(labelStrokePx(0.1, 1.4)).toBeCloseTo(0.1 * 3.78 * 1.4, 5);
  });

  test("line thickness floor", () => {
    expect(labelLineThicknessMm(0.05)).toBe(0.1);
    expect(labelLineThicknessMm(0.2)).toBe(0.2);
    expect(labelLineThicknessMm(1)).toBe(1);
  });
});
