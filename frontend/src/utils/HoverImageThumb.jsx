import React, { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { resolveImageUrl } from "./imageUrl";

const PREVIEW_MAX = 280;
const GAP = 10;

function previewPosition(rect) {
  if (!rect) return { top: 8, left: 8 };
  let left = rect.right + GAP;
  let top = rect.top;
  if (left + PREVIEW_MAX > window.innerWidth - 8) left = Math.max(8, rect.left - PREVIEW_MAX - GAP);
  if (top + PREVIEW_MAX > window.innerHeight - 8) top = Math.max(8, window.innerHeight - PREVIEW_MAX - 8);
  if (top < 8) top = 8;
  return { top, left };
}

/** Küçük thumbnail; hover/focus’ta portal önizleme (tablo overflow kesmez). */
export function HoverImageThumb({
  src,
  alt = "",
  className = "w-10 h-10 rounded-lg object-cover border",
  href,
  testId,
}) {
  const url = resolveImageUrl(src);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const anchorRef = useRef(null);

  const show = useCallback(() => {
    if (!url) return;
    setPos(previewPosition(anchorRef.current?.getBoundingClientRect()));
    setOpen(true);
  }, [url]);

  const hide = useCallback(() => setOpen(false), []);

  if (!url) return null;

  const link = href === false ? undefined : (href || url);

  const thumb = (
    <img
      src={url}
      alt={alt}
      className={className}
      loading="lazy"
      data-testid={testId}
    />
  );

  return (
    <>
      {link ? (
        <a
          ref={anchorRef}
          href={link}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 relative group"
          onMouseEnter={show}
          onMouseLeave={hide}
          onFocus={show}
          onBlur={hide}
          title="Önizleme için üzerine gelin · tıklayınca açılır"
        >
          {thumb}
        </a>
      ) : (
        <span
          ref={anchorRef}
          className="shrink-0 relative inline-block"
          onMouseEnter={show}
          onMouseLeave={hide}
          onFocus={show}
          onBlur={hide}
          tabIndex={0}
        >
          {thumb}
        </span>
      )}
      {open && typeof document !== "undefined" && createPortal(
        <div
          className="fixed z-[200] pointer-events-none p-1.5 bg-white rounded-xl shadow-2xl border border-slate-200"
          style={{ top: pos.top, left: pos.left }}
          data-testid="image-hover-preview"
          role="img"
          aria-hidden
        >
          <img
            src={url}
            alt=""
            className="block max-w-[280px] max-h-[280px] w-auto h-auto rounded-lg object-contain bg-slate-50"
          />
        </div>,
        document.body,
      )}
    </>
  );
}

export default HoverImageThumb;
