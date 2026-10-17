/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import fs from "fs";
import path from "path";
import AiMessageText from "./AiMessageText";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function render(text) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(<AiMessageText text={text} />);
  });
  return {
    host,
    cleanup() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

test("**TamKobi** kalın yazılır", () => {
  const view = render("Merhaba **TamKobi**");
  const strong = view.host.querySelector("strong");
  expect(strong).not.toBeNull();
  expect(strong.textContent).toBe("TamKobi");
  expect(view.host.textContent).toBe("Merhaba TamKobi");
  expect(view.host.textContent).not.toContain("**");
  view.cleanup();
});

test("HTML ve script metin olarak kalır, eleman oluşmaz", () => {
  const raw = '<script>alert(1)</script><img src=x onerror="alert(1)">';
  const view = render(raw);
  expect(view.host.querySelector("script")).toBeNull();
  expect(view.host.querySelector("img")).toBeNull();
  expect(view.host.textContent).toContain("<script>alert(1)</script>");
  expect(view.host.innerHTML.toLowerCase()).not.toContain("<script");
  expect(view.host.innerHTML.toLowerCase()).not.toContain("<img");
  view.cleanup();
});

test("liste ve başlık ayrışır", () => {
  const view = render("# Nakit\n\n- tahsilat\n- stok\n\n1. KDV\n2. gelir\n\n## Alt\n### Üç");
  const headings = [...view.host.querySelectorAll("strong")].map((el) => el.textContent);
  expect(headings).toEqual(["Nakit", "Alt", "Üç"]);
  const ul = view.host.querySelector("ul");
  const ol = view.host.querySelector("ol");
  expect([...ul.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["tahsilat", "stok"]);
  expect([...ol.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["KDV", "gelir"]);
  expect(view.host.textContent).not.toContain("#");
  expect(view.host.textContent).not.toMatch(/^[-*] /m);
  view.cleanup();
});

test("eşleşmeyen ** olduğu gibi metin kalır", () => {
  const lone = render("**");
  expect(lone.host.querySelector("strong")).toBeNull();
  expect(lone.host.textContent).toBe("**");
  lone.cleanup();

  const view = render("fiyat ** 10 TL");
  expect(view.host.querySelector("strong")).toBeNull();
  expect(view.host.textContent).toBe("fiyat ** 10 TL");
  view.cleanup();
});

test("italik ve kod düz metin düğümleridir", () => {
  const view = render("Bu *italik* ve _altı_ ve `kod`");
  expect(view.host.querySelector("em").textContent).toBe("italik");
  expect(view.host.querySelectorAll("em")[1].textContent).toBe("altı");
  expect(view.host.querySelector("code").textContent).toBe("kod");
  expect(view.host.textContent).toBe("Bu italik ve altı ve kod");
  view.cleanup();
});

test("kaynak HTML basmaz", () => {
  const src = fs.readFileSync(path.join(__dirname, "AiMessageText.jsx"), "utf8");
  expect(src).not.toContain("dangerouslySetInnerHTML");
  expect(src).not.toMatch(/react-markdown|marked|dompurify/);
});
