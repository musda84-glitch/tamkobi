import { fieldUsesDatePicker, fieldUsesMonthPicker, fieldUsesTimePicker } from "./fieldKind";

describe("field picker routing", () => {
  it("opens a calendar for date fields", () => {
    expect(fieldUsesDatePicker("ot-date-input", "YYYY-MM-DD")).toBe(true);
    expect(fieldUsesDatePicker("leave-start-input", "YYYY-MM-DD")).toBe(true);
    expect(fieldUsesDatePicker("exp-date", "")).toBe(true);
    expect(fieldUsesDatePicker("ot-note-input", "Opsiyonel")).toBe(false);
  });

  it("opens a month picker for period fields", () => {
    expect(fieldUsesMonthPicker("attendance-month-input", "Ay", "2026-09")).toBe(true);
    expect(fieldUsesMonthPicker("personelim-month", "Dönem (YYYY-AA)", "2026-09")).toBe(true);
    expect(fieldUsesMonthPicker("bonus-period", "Dönem", "YYYY-AA")).toBe(true);
    expect(fieldUsesMonthPicker("emp-pay-moves-month", "Dönem", "YYYY-AA")).toBe(true);
    expect(fieldUsesMonthPicker("emp-start", "İşe başlama", "YYYY-AA-GG")).toBe(false);
    expect(fieldUsesMonthPicker("ot-date-input", "Tarih", "YYYY-MM-DD")).toBe(false);
  });

  it("opens a clock for hour fields", () => {
    expect(fieldUsesTimePicker("ot-hours-input")).toBe(true);
    expect(fieldUsesTimePicker("ot-date-input")).toBe(false);
    expect(fieldUsesTimePicker(undefined, "Saat", "Örn: 2")).toBe(true);
    expect(fieldUsesTimePicker("ot-note-input", "Not", "Opsiyonel")).toBe(false);
    expect(fieldUsesTimePicker("emp-ledger-amount", "Tutar (₺)", "Örn: 2500")).toBe(false);
    expect(fieldUsesTimePicker("emp-ledger-amount", "Tutar (₺)", "Kalan bakiye")).toBe(false);
  });
});
