import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import {
  MoneyInput,
  QuantityInput,
  applyMoneyEdit,
  formatMoneyBlur,
  parseTrNumber,
} from "./MoneyInput";

function typeDigits(start, digits, options) {
  let text = start;
  let caret = text.length;
  let value = null;
  for (const ch of digits) {
    const next = text.slice(0, caret) + ch + text.slice(caret);
    caret += 1;
    const res = applyMoneyEdit(text, next, caret, options);
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
    expect(parseTrNumber("12a.3b0")).toBe(12.3);

    const en = applyMoneyEdit("", "20000.5", 7, { inputType: "insertFromPaste" });
    expect(en.text).toBe("20.000,5");
    expect(en.value).toBe(20000.5);
    expect(en.caret).toBe(en.text.length);

    const tr = applyMoneyEdit("", "20.000,50", 9);
    expect(tr.text).toBe("20.000,50");
    expect(tr.value).toBe(20000.5);
  });

  test("boş değer boş kalır ve sayı üretmez", () => {
    expect(parseTrNumber("")).toBeNull();
    expect(parseTrNumber("   ")).toBeNull();
    expect(parseTrNumber("abc")).toBeNull();
    expect(formatMoneyBlur("", 2)).toBe("");
    expect(formatMoneyBlur(null, 2)).toBe("");
    const cleared = applyMoneyEdit("20.000", "", 0);
    expect(cleared).toEqual({ text: "", value: null, caret: 0 });
    expect(formatMoneyBlur(0, 2)).toBe("0,00");
  });

  test("imleç binlik nokta eklenince ve ortada yazınca kaymaz", () => {
    const step = applyMoneyEdit("200", "2000", 4);
    expect(step.text).toBe("2.000");
    expect(step.caret).toBe(5);
    expect(step.value).toBe(2000);

    const mid = applyMoneyEdit("20.000", "210.000", 2);
    expect(mid.text).toBe("210.000");
    expect(mid.caret).toBe(2);
    expect(mid.value).toBe(210000);

    const appended = applyMoneyEdit("2.000", "2.0000", 6);
    expect(appended.text).toBe("20.000");
    expect(appended.caret).toBe(6);
    expect(appended.value).toBe(20000);
  });

  test("binlik noktayı silmek önceki rakamı siler; yazılan nokta virgül olur", () => {
    const del = applyMoneyEdit("20.000", "20000", 2);
    expect(del.text).toBe("2.000");
    expect(del.value).toBe(2000);
    expect(del.caret).toBe(1);

    const dot = applyMoneyEdit("20.000", "20.000.", 7);
    expect(dot.text).toBe("20.000,");
    expect(dot.value).toBe(20000);
    expect(dot.caret).toBe(7);

    const frac = applyMoneyEdit(dot.text, `${dot.text}5`, dot.caret + 1);
    expect(frac.text).toBe("20.000,5");
    expect(frac.value).toBe(20000.5);
    expect(frac.caret).toBe(frac.text.length);
  });

  test("miktar odakta çıkınca gereksiz ,00 eklemez", () => {
    expect(formatMoneyBlur(20000, 0)).toBe("20.000");
    expect(formatMoneyBlur(2.5, 0, { maxFractionDigits: 3 })).toBe("2,5");
    const qtyRender = QuantityInput.render || QuantityInput;
    expect(typeof qtyRender).toBe("function");
  });
});

function Host() {
  const [value, setValue] = useState(null);
  return <MoneyInput value={value} onChange={setValue} data-testid="money" />;
}

describe("MoneyInput bileşeni", () => {
  test("boş başlar, yazınca biçimler, blurda kuruş ekler, state sayı kalır", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<Host />);
    });
    const input = host.querySelector("[data-testid='money']");
    expect(input.value).toBe("");

    await act(async () => {
      input.focus();
    });
    let text = "";
    for (const ch of "20000") {
      text += ch;
      const caret = text.length;
      await act(async () => {
        const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
        proto.set.call(input, text);
        input.selectionStart = caret;
        input.selectionEnd = caret;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      text = input.value;
    }
    expect(input.value).toBe("20.000");
    expect(input.selectionStart).toBe(6);

    await act(async () => {
      input.blur();
      input.dispatchEvent(new Event("blur", { bubbles: true }));
    });
    expect(input.value).toBe("20.000,00");

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });
});
