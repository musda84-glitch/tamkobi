import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ExternalLink } from "lucide-react";
import { resolveImageUrl } from "./imageUrl";

const PREVIEW_MAX = 360;
const GAP = 12;
const HIDE_MS = 120;

function previewPosition(rect) {
  if (!rect) return { top: 8, left: 8 };
  let left = rect.right + GAP;
  let top = rect.top;
  if (left + PREVIEW_MAX > window.innerWidth - 8) left = Math.max(8, rect.left - PREVIEW_MAX - GAP);
  if (top + PREVIEW_MAX > window.innerHeight - 8) top = Math.max(8, window.innerHeight - PREVIEW_MAX - 8);
  if (top < 8) top = 8;
  return { top, left };
}

/** Küçük thumbnail; hover/focus’ta portal önizleme (tablo overflow kesmez). Tıklanınca büyük lightbox. */
export function HoverImageThumb({
  src,
  alt = "",
  className = "w-10 h-10 rounded-lg object-cover border",
  href,
  testId,
}) {
  const url = resolveImageUrl(src);
  const [hover, setHover] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const anchorRef = useRef(null);
  const hideTimer = useRef(null);

  const clearHide = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const showHover = useCallback(() => {
    if (!url || lightbox) return;
    clearHide();
    setPos(previewPosition(anchorRef.current?.getBoundingClientRect()));
    setHover(true);
  }, [url, lightbox, clearHide]);

  const hideHover = useCallback(() => {
    clearHide();
    hideTimer.current = setTimeout(() => setHover(false), HIDE_MS);
  }, [clearHide]);

  useEffect(() => () => clearHide(), [clearHide]);

  useEffect(() => {
    if (!lightbox) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setLightbox(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  if (!url) return null;

  const link = href === false ? undefined : (href || url);

  const openLightbox = (e) => {
    e.preventDefault();
    e.stopPropagation();
    clearHide();
    setHover(false);
    setLightbox(true);
  };

  const thumb = (
    <img
      src={url}
      alt={alt}
      className={className}
      loading="lazy"
      data-testid={testId}
    />
  );

  const handlers = {
    onPointerEnter: showHover,
    onPointerLeave: hideHover,
    onFocus: showHover,
    onBlur: hideHover,
    onClick: openLightbox,
  };

  return (
    <>
      {link ? (
        <a
          ref={anchorRef}
          href={link}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 relative inline-block cursor-zoom-in"
          title="Üzerine gelince önizle · tıklayınca büyüt"
          {...handlers}
        >
          {thumb}
        </a>
      ) : (
        <button
          type="button"
          ref={anchorRef}
          className="shrink-0 relative inline-block cursor-zoom-in p-0 border-0 bg-transparent"
          title="Üzerine gelince önizle · tıklayınca büyüt"
          {...handlers}
        >
          {thumb}
        </button>
      )}
      {hover && !lightbox && typeof document !== "undefined" && createPortal(
        <div
          className="fixed z-[9999] pointer-events-none p-1.5 bg-white rounded-xl shadow-2xl border border-slate-200"
          style={{ top: pos.top, left: pos.left }}
          data-testid="image-hover-preview"
          role="img"
          aria-hidden
        >
          <img
            src={url}
            alt=""
            className="block max-w-[360px] max-h-[360px] w-auto h-auto rounded-lg object-contain bg-slate-50"
          />
        </div>,
        document.body,
      )}
      {lightbox && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-[10000] bg-slate-900/80 flex items-center justify-center p-4"
          onClick={() => setLightbox(false)}
          data-testid="image-lightbox-preview"
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            className="absolute top-4 right-4 p-2 rounded-full bg-white/90 text-slate-700 hover:bg-white"
            aria-label="Kapat"
            data-testid="image-lightbox-close"
            onClick={() => setLightbox(false)}
          >
            <X className="w-5 h-5" />
          </button>
          {link ? (
            <a
              href={link}
              target="_blank"
              rel="noreferrer"
              className="absolute top-4 right-16 p-2 rounded-full bg-white/90 text-slate-700 hover:bg-white inline-flex"
              title="Yeni sekmede aç"
              data-testid="image-lightbox-open"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="w-5 h-5" />
            </a>
          ) : null}
          <img
            src={url}
            alt={alt}
            className="max-h-[85vh] max-w-full object-contain rounded-lg bg-white shadow-2xl"
            onClick={(ev) => ev.stopPropagation()}
          />
        </div>,
        document.body,
      )}
    </>
  );
}

export default HoverImageThumb;
