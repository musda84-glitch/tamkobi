import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { backdropDismissProps } from "../../utils/modalBackdrop";
import { ROLE_HELP_SECTIONS } from "./roleHelpContent";

const LEVEL_TONE = {
  none: "border-slate-200 bg-white",
  view: "border-blue-100 bg-blue-50",
  edit: "border-emerald-100 bg-emerald-50",
  delete: "border-rose-100 bg-rose-50",
};

export function RoleHelpFigure({ image }) {
  const [missing, setMissing] = useState(!image?.src);
  if (!image) return null;
  if (missing) {
    return (
      <div
        className="mt-2.5 flex min-h-[150px] items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 text-center text-xs text-slate-400"
        data-testid={`role-help-shot-placeholder-${image.id}`}
      >
        <div>
          <div>Ekran görüntüsü yer tutucu</div>
          {image.caption ? <div className="mt-1">{image.caption}</div> : null}
        </div>
      </div>
    );
  }
  return (
    <img
      src={image.src}
      alt={image.alt}
      width={image.width}
      height={image.height}
      loading="lazy"
      decoding="async"
      onError={() => setMissing(true)}
      className="mt-2.5 h-auto w-full rounded-xl border border-slate-200 bg-slate-50"
      data-testid={`role-help-shot-${image.id}`}
    />
  );
}

function NoteList({ notes, id }) {
  if (!notes?.length) return null;
  return notes.map((note, index) => (
    <p
      key={`${id}-${index}`}
      className={`mt-2 rounded-[10px] border px-2.5 py-2 text-[11px] leading-relaxed ${note.kind === "important" ? "border-amber-300 bg-amber-50 text-amber-950" : "border-rose-200 bg-rose-50 text-rose-800"}`}
      data-testid={`role-help-note-${id}-${index}`}
    >
      <span className="font-bold">{note.kind === "important" ? "Önemli. " : "Not. "}</span>
      {note.text}
    </p>
  ));
}

function LevelList({ levels }) {
  return (
    <div className="mt-2 space-y-1.5" data-testid="role-help-levels">
      {levels.map((level) => (
        <div
          key={level.key}
          className={`rounded-[10px] border px-2.5 py-2 leading-relaxed text-slate-800 ${LEVEL_TONE[level.key] || LEVEL_TONE.none}`}
          data-testid={`role-help-level-${level.key}`}
        >
          <b>{level.label}</b>
          {" — "}
          {level.text}
        </div>
      ))}
    </div>
  );
}

function HelpBlock({ id, title, paragraphs, image, notes }) {
  return (
    <div data-testid={`role-help-item-${id}`}>
      <h3 className="text-[15px] font-bold text-slate-900">{title}</h3>
      {(paragraphs || []).map((paragraph) => (
        <p key={paragraph} className="mt-1.5 leading-relaxed text-slate-700">{paragraph}</p>
      ))}
      <RoleHelpFigure image={image} />
      <NoteList notes={notes} id={id} />
    </div>
  );
}

/**
 * Roller sayfası yardım paneli.
 * Masaüstünde sağdan, dar ekranda alttan tam ekran açılır.
 */
export function RoleHelpPanel({ open, onClose, sections = ROLE_HELP_SECTIONS }) {
  const onCloseRef = useRef(onClose);
  const closeRef = useRef(null);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") onCloseRef.current?.();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[70] bg-slate-900/35"
        data-testid="role-help-backdrop"
        {...backdropDismissProps(() => onCloseRef.current?.())}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="role-help-title"
        data-testid="role-help-panel"
        className="fixed z-[80] flex w-full flex-col overflow-hidden bg-white text-[13px] text-slate-900 shadow-[-10px_0_30px_rgba(15,23,42,.12)] inset-x-0 bottom-0 h-[100dvh] md:inset-y-0 md:left-auto md:right-0 md:h-full md:w-[440px] md:border-l md:border-slate-200"
      >
        <div className="flex justify-center pt-2 md:hidden" aria-hidden="true">
          <div className="h-1.5 w-10 rounded-full bg-slate-300" data-testid="role-help-handle" />
        </div>
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
          <div id="role-help-title" className="text-[11px] font-extrabold uppercase tracking-[.06em] text-slate-500">
            Yardım · Roller ve yetkiler
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={() => onCloseRef.current?.()}
            aria-label="Kapat"
            data-testid="role-help-close"
            className="font-bold text-slate-700"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4" data-testid="role-help-body">
          {(sections || []).map((section) => (
            <section
              key={section.id}
              id={`role-help-${section.id}`}
              data-testid={`role-help-section-${section.id}`}
              className="mt-5 border-t border-slate-100 pt-4 first:mt-0 first:border-t-0 first:pt-0"
            >
              {section.kicker ? (
                <div className="text-[11px] font-extrabold uppercase tracking-[.06em] text-slate-500" data-testid={`role-help-kicker-${section.id}`}>
                  {section.kicker}
                </div>
              ) : null}
              <h2 className="mt-1 text-lg font-bold text-slate-900">{section.title}</h2>
              {(section.paragraphs || []).map((paragraph) => (
                <p key={paragraph} className="mt-2 leading-relaxed text-slate-700">{paragraph}</p>
              ))}
              {section.levels ? <LevelList levels={section.levels} /> : null}
              <RoleHelpFigure image={section.image} />
              <NoteList notes={section.notes} id={section.id} />
              {(section.items || []).length > 0 ? (
                <div className="mt-4 space-y-4">
                  {section.items.map((entry) => (
                    <HelpBlock key={entry.id} {...entry} />
                  ))}
                </div>
              ) : null}
            </section>
          ))}
        </div>
      </div>
    </>,
    document.body,
  );
}
