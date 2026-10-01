import React from "react";
import { TimeInput, normalizeTime24 } from "../components/TimeInput";

describe("TimeInput", () => {
  test("exports a 24h-oriented time field", () => {
    expect(typeof TimeInput).toBe("function");
    const el = TimeInput({ value: "09:00", "data-testid": "t", onChange: () => {} });
    expect(el.type).toBe("input");
    expect(el.props.type).toBe("time");
    expect(el.props.lang).toBe("tr-TR");
    expect(el.props.value).toBe("09:00");
    expect(el.props.step).toBe(60);
  });

  test("text24 mode never uses AM/PM picker", () => {
    const el = TimeInput({
      text24: true,
      step: 1,
      value: "06:43:22",
      "data-testid": "edit-inv-issue-time",
      onChange: () => {},
    });
    expect(el.props.type).toBe("text");
    expect(el.props.placeholder).toBe("SS:DD:SS");
    expect(el.props.value).toBe("06:43:22");
    expect(el.props["data-testid"]).toBe("edit-inv-issue-time");
  });
});

describe("normalizeTime24", () => {
  test("keeps 24h values and strips AM/PM", () => {
    expect(normalizeTime24("06:43:22", { withSeconds: true })).toBe("06:43:22");
    expect(normalizeTime24("18:05:09", { withSeconds: true })).toBe("18:05:09");
    expect(normalizeTime24("6:43:22 AM", { withSeconds: true })).toBe("06:43:22");
    expect(normalizeTime24("06:43:22 PM", { withSeconds: true })).toBe("18:43:22");
    expect(normalizeTime24("12:15", { withSeconds: false })).toBe("12:15");
    expect(normalizeTime24("12:15 PM")).toBe("12:15");
    expect(normalizeTime24("12:15 AM")).toBe("00:15");
  });
});
