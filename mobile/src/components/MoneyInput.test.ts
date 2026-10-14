import { applyMoneyEdit, formatMoneyBlur, parseTrNumber } from "../utils/trMoneyInput";

function typeDigits(start: string, digits: string) {
  let text = start;
  let caret = text.length;
  let value: number | null = null;
  for (const ch of digits) {
    const next = text.slice(0, caret) + ch + text.slice(caret);
    caret += 1;
    const res = applyMoneyEdit(text, next, caret);
    text = res.text;
    caret = res.caret;
    value = res.value;
  }
  return { text, caret, value };
}

describe("MoneyInput biçimleme ve ayrıştırma", () => {
  test("20000 yazılınca 20.000, odakta çıkınca 20.000,00", () => {
    const typed = typeDigits("", "20000");
    expect(typed.text).toBe("20.000");
    expect(typed.caret).toBe("20.000".length);
    expect(typed.value).toBe(20000);
    expect(formatMoneyBlur(20000, 2)).toBe("20.000,00");
    expect(formatMoneyBlur(20000.5, 2)).toBe("20.000,50");
    expect(formatMoneyBlur(236.3636, 2)).toBe("236,3636");
  });

  test("virgül ondalık, nokta binlik; yapıştırılan 20000.5 ve 20.000,50", () => {
    expect(parseTrNumber("20.000,50")).toBe(20000.5);
    expect(parseTrNumber("20000.5")).toBe(20000.5);
    expect(parseTrNumber("20000,5")).toBe(20000.5);
    expect(parseTrNumber("1,250.50")).toBe(1250.5);
    expect(parseTrNumber("1.250,50")).toBe(1250.5);
    expect(parseTrNumber("2.10")).toBe(2.1);
    expect(parseTrNumber("2,10")).toBe(2.1);
    const en = applyMoneyEdit("", "20000.5", 7, { inputType: "insertFromPaste" });
    expect(en.text).toBe("20.000,5");
    expect(en.value).toBe(20000.5);
    const tr = applyMoneyEdit("", "20.000,50", 9);
    expect(tr.text).toBe("20.000,50");
    expect(tr.value).toBe(20000.5);
  });

  test("boş değer boş kalır", () => {
    expect(parseTrNumber("")).toBeNull();
    expect(parseTrNumber("   ")).toBeNull();
    expect(formatMoneyBlur("", 2)).toBe("");
    expect(formatMoneyBlur(null, 2)).toBe("");
    expect(applyMoneyEdit("20.000", "", 0)).toEqual({ text: "", value: null, caret: 0 });
  });

  test("imleç binlik ayıracı ve silmede bozulmaz", () => {
    const step = applyMoneyEdit("200", "2000", 4);
    expect(step.text).toBe("2.000");
    expect(step.caret).toBe(5);
    const mid = applyMoneyEdit("20.000", "210.000", 2);
    expect(mid.text).toBe("210.000");
    expect(mid.caret).toBe(2);
    expect(mid.value).toBe(210000);
    const appended = applyMoneyEdit("2.000", "2.0000", 6);
    expect(appended.text).toBe("20.000");
    expect(appended.caret).toBe(6);
    const del = applyMoneyEdit("20.000", "20000", 2);
    expect(del.text).toBe("2.000");
    expect(del.value).toBe(2000);
    expect(del.caret).toBe(1);
    const dot = applyMoneyEdit("20.000", "20.000.", 7);
    expect(dot.text).toBe("20.000,");
    expect(dot.caret).toBe(7);
    expect(dot.value).toBe(20000);
  });
});
