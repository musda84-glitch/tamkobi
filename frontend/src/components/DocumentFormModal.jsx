import React, { useLayoutEffect, useRef } from "react";
import { backdropDismissProps } from "../utils/modalBackdrop";
import { applyDocumentEditorLayout, lockBodyScroll } from "../utils/documentEditorLayout";

/**
 * Fatura / sipariş / teklif / irsaliye / alış belgesi düzenleme kabı.
 * Başlık üstte, toplamlar + İptal/Kaydet altta, kalemler ortada kayar.
 */
export function DocumentFormModal({
  as: Tag = "div",
  testId,
  maxWidthClass = "max-w-7xl",
  zClass = "z-50",
  panelClassName = "",
  header,
  footer,
  children,
  onBackdropClose,
  blur = true,
  ...tagProps
}) {
  const panelRef = useRef(null);
  useLayoutEffect(() => {
    const releaseScroll = lockBodyScroll();
    const panel = panelRef.current;
    if (!panel) return releaseScroll;
    let frame = 0;
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => applyDocumentEditorLayout(panel));
    };
    applyDocumentEditorLayout(panel);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    const watch = () => {
      if (!ro) return;
      ro.observe(panel);
      panel.querySelectorAll("[data-doc-header], [data-doc-footer], [data-doc-lines]").forEach((el) => ro.observe(el));
      const inner = panel.querySelector("[data-doc-lines] > *");
      if (inner) ro.observe(inner);
    };
    watch();
    const mo = typeof MutationObserver === "undefined" ? null : new MutationObserver(() => {
      watch();
      fit();
    });
    mo?.observe(panel, { childList: true, subtree: true });
    window.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("scroll", fit);
    return () => {
      releaseScroll();
      cancelAnimationFrame(frame);
      ro?.disconnect();
      mo?.disconnect();
      window.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("scroll", fit);
    };
  }, []);

  const backdrop = onBackdropClose ? backdropDismissProps(onBackdropClose) : {};
  return (
    <div
      className={`fixed inset-0 ${zClass} ${blur ? "bg-slate-900/60 backdrop-blur-sm" : "bg-slate-900/60"} flex items-center justify-center p-2 sm:p-4`}
      data-testid={testId ? `${testId}-backdrop` : undefined}
      {...backdrop}
    >
      <Tag
        {...tagProps}
        ref={panelRef}
        onClick={(e) => {
          e.stopPropagation();
          tagProps.onClick?.(e);
        }}
        className={`doc-editor-modal flex flex-col overflow-hidden bg-white rounded-2xl w-full ${maxWidthClass} shadow-2xl border border-slate-200 min-h-0 ${panelClassName}`}
        data-testid={testId}
      >
        {header != null && (
          <div className="doc-editor-header min-h-0" data-doc-header>
            {header}
          </div>
        )}
        {children != null && children !== false && (
          <div className="doc-editor-lines flex-1 min-h-0 overflow-x-auto overflow-y-auto" data-doc-lines data-testid={testId ? `${testId}-lines` : undefined}>
            {children}
          </div>
        )}
        {footer != null && (
          <div className="doc-editor-footer sticky bottom-0 z-[5] bg-white" data-doc-footer data-testid={testId ? `${testId}-footer` : undefined}>
            {footer}
          </div>
        )}
      </Tag>
    </div>
  );
}
