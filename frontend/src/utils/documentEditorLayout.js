/**
 * Belge düzenleme modalları (fatura, sipariş, teklif, irsaliye, alış).
 *
 * Panel yüksekliği: 100dvh - küçük boşluk. Başlık üstte (gerekirse kendi
 * içinde kayar), kalem tablosu kalan alanın tamamını alır (flex: 1,
 * min-height: 0, overflow-y: auto), toplamlar ve Kaydet altta kalır.
 * 1080p ve üzeri yükseklikte kalem bölgesi en az 8 satır (~44px) ayırır.
 *
 * Body scroll kilidi yalnızca html/body overflow'unu kapatır. position:fixed
 * ve touch-action:none kullanılmaz; ikisi iOS'ta modal içi kaydırmayı keser.
 */

/** Kompakt kalem satırı yüksekliği (px). */
export const DOC_LINE_ROW_PX = 44;

let locks = 0;
let snapshot = null;

export function lockBodyScroll() {
  if (typeof document === "undefined") return () => {};
  const html = document.documentElement;
  const body = document.body;
  if (locks === 0) {
    snapshot = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyTouch: body.style.touchAction,
      bodyOverscroll: body.style.overscrollBehavior,
    };
    html.classList.add("doc-scroll-lock");
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.touchAction = "auto";
    body.style.overscrollBehavior = "none";
  }
  locks += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks = Math.max(0, locks - 1);
    if (locks > 0 || !snapshot) return;
    html.style.overflow = snapshot.htmlOverflow;
    body.style.overflow = snapshot.bodyOverflow;
    body.style.touchAction = snapshot.bodyTouch;
    body.style.overscrollBehavior = snapshot.bodyOverscroll;
    html.classList.remove("doc-scroll-lock");
    snapshot = null;
  };
}

export function resetBodyScrollLockForTests() {
  locks = 0;
  snapshot = null;
  if (typeof document === "undefined") return;
  document.documentElement.classList.remove("doc-scroll-lock");
}

/** Görünür yükseklik: tarayıcı çubuğu ve klavye visualViewport'u küçültür. */
export function visibleViewportHeight() {
  if (typeof window === "undefined") return 800;
  const layout = window.innerHeight || 800;
  const visual = window.visualViewport?.height || layout;
  return Math.min(layout, visual);
}

export function safeAreaInsetY() {
  if (typeof document === "undefined") return 0;
  const el = document.createElement("div");
  el.style.cssText = "position:fixed;left:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);";
  document.body.appendChild(el);
  const cs = getComputedStyle(el);
  const y = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  el.remove();
  return y;
}

/**
 * Görünür kalem sayısı. linesMax null ise içerik sığıyor demektir.
 * @param {number | null} linesMax
 * @param {number} [rowPx]
 */
export function visibleLineCount(linesMax, rowPx = DOC_LINE_ROW_PX) {
  if (linesMax == null || !(rowPx > 0)) return null;
  return Math.floor(linesMax / rowPx);
}

/**
 * @param {{ viewport: number, gap?: number, headerScroll: number, footerHeight: number, linesScroll: number }} m
 */
export function planDocumentEditorScroll({ viewport, gap = 16, headerScroll, footerHeight, linesScroll }) {
  const panelMax = Math.max(200, Math.floor(viewport - gap));
  const available = Math.max(0, panelMax - footerHeight);
  // 1080p (viewport >= 1000): en az 8 satır. Daha kısa ekranda başlık da kayabilsin.
  const linesFloor = viewport >= 1000
    ? Math.min(Math.floor(available * 0.8) || 0, Math.max(DOC_LINE_ROW_PX * 8, 352))
    : Math.max(72, Math.min(220, Math.floor(panelMax * 0.42)));
  const headerFloor = 72;
  const natural = headerScroll + linesScroll;

  if (natural <= available) {
    return {
      panelMax,
      headerMax: null,
      linesMax: null,
      headerScrolls: false,
      linesScroll: false,
    };
  }

  if (headerScroll + linesFloor <= available) {
    const linesMax = available - headerScroll;
    return {
      panelMax,
      headerMax: null,
      linesMax,
      headerScrolls: false,
      linesScroll: linesScroll > linesMax,
    };
  }

  const headerMax = Math.max(headerFloor, available - linesFloor);
  const headerUsed = Math.min(headerScroll, headerMax);
  const linesMax = Math.max(0, available - headerUsed);
  return {
    panelMax,
    headerMax,
    linesMax,
    headerScrolls: headerScroll > headerMax,
    linesScroll: linesScroll > linesMax,
  };
}

function writeStyle(el, prop, value) {
  if (!el) return;
  const next = value == null ? "" : String(value);
  if (el.style[prop] !== next) el.style[prop] = next;
}

/** Ölç, başlığı ve kalem bölgesini viewport'a sığdır. */
export function applyDocumentEditorLayout(panel, metrics = {}) {
  if (!panel || typeof window === "undefined") return null;
  const header = panel.querySelector("[data-doc-header]");
  const lines = panel.querySelector("[data-doc-lines]");
  const footer = panel.querySelector("[data-doc-footer]");
  const wide = (window.innerWidth || 1024) >= 640;
  const gap = metrics.gap != null ? metrics.gap : (wide ? 12 : 8) + (metrics.safeArea != null ? metrics.safeArea : safeAreaInsetY());
  const viewport = metrics.viewport || visibleViewportHeight();
  const border = Math.max(0, (panel.offsetHeight || 0) - (panel.clientHeight || 0));
  const outerMax = Math.max(200, Math.floor(viewport - gap));
  const plan = planDocumentEditorScroll({
    viewport: Math.max(200, outerMax - border) + gap,
    gap,
    headerScroll: header ? header.scrollHeight : 0,
    footerHeight: footer ? footer.offsetHeight : 0,
    linesScroll: lines ? lines.scrollHeight : 0,
  });
  writeStyle(panel, "height", `${outerMax}px`);
  writeStyle(panel, "maxHeight", `${outerMax}px`);
  if (header) {
    writeStyle(header, "maxHeight", plan.headerMax == null ? "" : `${plan.headerMax}px`);
    writeStyle(header, "overflowY", plan.headerScrolls ? "auto" : "");
    writeStyle(header, "overscrollBehavior", "contain");
    writeStyle(header, "touchAction", "pan-y");
  }
  if (lines) {
    writeStyle(lines, "flex", "1 1 0%");
    writeStyle(lines, "minHeight", "0");
    writeStyle(lines, "overflowX", "auto");
    writeStyle(lines, "overflowY", "auto");
    writeStyle(lines, "maxHeight", plan.linesMax == null ? "" : `${plan.linesMax}px`);
    writeStyle(lines, "overscrollBehavior", "contain");
    writeStyle(lines, "touchAction", "pan-x pan-y");
    writeStyle(lines, "webkitOverflowScrolling", "touch");
  }
  return plan;
}
