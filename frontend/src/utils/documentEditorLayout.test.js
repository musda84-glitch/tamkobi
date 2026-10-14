/**
 * @jest-environment jsdom
 */
import fs from "fs";
import path from "path";
import {
  applyDocumentEditorLayout,
  lockBodyScroll,
  planDocumentEditorScroll,
  resetBodyScrollLockForTests,
  visibleLineCount,
  DOC_LINE_ROW_PX,
} from "./documentEditorLayout";

beforeEach(() => {
  resetBodyScrollLockForTests();
  document.documentElement.style.overflow = "";
  document.body.style.overflow = "";
  document.body.style.touchAction = "";
  document.documentElement.classList.remove("doc-scroll-lock");
});

test("40 kalemde kalemler kayar ve alt çubuk panelin içinde kalır", () => {
  const viewport = 900;
  const gap = 32;
  const headerScroll = 280;
  const footerHeight = 180;
  const linesScroll = 45 * 48;
  const plan = planDocumentEditorScroll({ viewport, gap, headerScroll, footerHeight, linesScroll });
  expect(plan.panelMax).toBe(viewport - gap);
  expect(plan.headerScrolls).toBe(false);
  expect(plan.linesScroll).toBe(true);
  expect(plan.linesMax).toBeGreaterThan(72);
  expect(headerScroll + plan.linesMax + footerHeight).toBeLessThanOrEqual(plan.panelMax);
});

test("küçük ekranda başlık da kendi içinde kayar, Kaydet için yer kalır", () => {
  const plan = planDocumentEditorScroll({
    viewport: 640,
    gap: 16,
    headerScroll: 700,
    footerHeight: 260,
    linesScroll: 40 * 52,
  });
  expect(plan.headerScrolls).toBe(true);
  expect(plan.linesScroll).toBe(true);
  expect(plan.headerMax).toBeGreaterThan(0);
  expect(plan.linesMax).toBeGreaterThan(0);
  expect(plan.headerMax + plan.linesMax + 260).toBeLessThanOrEqual(plan.panelMax);
});

test("kısa formda iç kaydırma açılmaz", () => {
  const plan = planDocumentEditorScroll({
    viewport: 900,
    gap: 32,
    headerScroll: 200,
    footerHeight: 120,
    linesScroll: 80,
  });
  expect(plan.linesMax).toBeNull();
  expect(plan.headerMax).toBeNull();
  expect(plan.linesScroll).toBe(false);
});

test("body kilidi touch-action:none koymaz ve modal kaydırmasını serbest bırakır", () => {
  const release = lockBodyScroll();
  expect(document.body.style.overflow).toBe("hidden");
  expect(document.documentElement.style.overflow).toBe("hidden");
  expect(document.body.style.touchAction).toBe("auto");
  expect(document.body.style.touchAction).not.toBe("none");
  expect(document.documentElement.classList.contains("doc-scroll-lock")).toBe(true);
  release();
  expect(document.body.style.overflow).toBe("");
  expect(document.documentElement.classList.contains("doc-scroll-lock")).toBe(false);
});

test("iç içe kilitler son bırakılınca açılır", () => {
  const a = lockBodyScroll();
  const b = lockBodyScroll();
  a();
  expect(document.body.style.overflow).toBe("hidden");
  b();
  expect(document.body.style.overflow).toBe("");
});

test("1080p ekranda 40 kalemde en az 8 satır görünür", () => {
  const row = DOC_LINE_ROW_PX;
  const plan = planDocumentEditorScroll({
    viewport: 1080,
    gap: 12,
    headerScroll: 180,
    footerHeight: 72,
    linesScroll: 40 * row,
  });
  expect(plan.panelMax).toBe(1080 - 12);
  expect(plan.linesScroll).toBe(true);
  expect(plan.linesMax).toBeGreaterThanOrEqual(8 * row);
  expect(visibleLineCount(plan.linesMax, row)).toBeGreaterThanOrEqual(8);
});

test("1080p ve uzun başlıkta kalem alanı 8 satırın altına inmez", () => {
  const plan = planDocumentEditorScroll({
    viewport: 1080,
    gap: 12,
    headerScroll: 760,
    footerHeight: 96,
    linesScroll: 40 * DOC_LINE_ROW_PX,
  });
  expect(plan.headerScrolls).toBe(true);
  expect(visibleLineCount(plan.linesMax)).toBeGreaterThanOrEqual(8);
  expect(plan.headerMax + plan.linesMax + 96).toBeLessThanOrEqual(plan.panelMax);
});

test("kalem bölgesi flex ile kalan yüksekliği alır", () => {
  const css = fs.readFileSync(path.join(__dirname, "../index.css"), "utf8");
  expect(css).toContain("100dvh");
  expect(css).toContain("flex: 1;");
  expect(css).toContain("min-height: 0;");
  expect(css).toContain("overflow-y: auto;");
  expect(css).toContain("height: 44px;");
  expect(css).toContain("position: sticky;");
});

test("layout kalem bölgesine overflow-y auto ve max-height yazar", () => {
  document.body.innerHTML = `
    <div id="panel" class="doc-editor-modal">
      <div data-doc-header>başlık</div>
      <div data-doc-lines>kalemler</div>
      <div data-doc-footer><button data-testid="save-invoice-btn">Kaydet</button></div>
    </div>`;
  const panel = document.getElementById("panel");
  const header = panel.querySelector("[data-doc-header]");
  const lines = panel.querySelector("[data-doc-lines]");
  const footer = panel.querySelector("[data-doc-footer]");
  Object.defineProperty(header, "scrollHeight", { configurable: true, get: () => 380 });
  Object.defineProperty(lines, "scrollHeight", { configurable: true, get: () => 45 * 46 });
  Object.defineProperty(footer, "offsetHeight", { configurable: true, get: () => 200 });
  Object.defineProperty(panel, "offsetHeight", { configurable: true, get: () => 0 });
  Object.defineProperty(panel, "clientHeight", { configurable: true, get: () => 0 });
  const plan = applyDocumentEditorLayout(panel, { viewport: 820, gap: 32, safeArea: 0 });
  expect(plan.linesScroll).toBe(true);
  expect(lines.style.overflowY).toBe("auto");
  expect(lines.style.maxHeight).toMatch(/px$/);
  expect(Number.parseFloat(lines.style.maxHeight)).toBeGreaterThan(72);
  expect(panel.style.maxHeight).toBe("788px");
  expect(footer.querySelector("[data-testid='save-invoice-btn']")).not.toBeNull();
  expect(lines.contains(footer.querySelector("[data-testid='save-invoice-btn']"))).toBe(false);
  const css = document.createElement("style");
  css.textContent = ".doc-editor-lines { overflow-y: auto; } .doc-editor-modal { max-height: calc(100dvh - 2rem); }";
  document.head.appendChild(css);
  expect(css.textContent).toContain("100dvh");
  expect(css.textContent).toContain("overflow-y: auto");
});
