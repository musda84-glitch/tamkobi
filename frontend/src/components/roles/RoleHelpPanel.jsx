import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { backdropDismissProps } from "../../utils/modalBackdrop";
import { RoleHelpImage } from "./RoleHelpImage";
import { ROLE_HELP_LEVELS, ROLE_HELP_SECTIONS, roleHelpImageSrc } from "./roleHelpContent";
import "./RoleHelpPanel.css";

const LEVEL_TONE = {
  none: "border-slate-200 bg-white",
  view: "border-blue-100 bg-blue-50",
  edit: "border-emerald-100 bg-emerald-50",
  delete: "border-rose-100 bg-rose-50",
};

function HelpNote({ text, kind = "note" }) {
  const important = kind === "important";
  return (
    <p
      className={important
        ? "mt-2 rounded-[10px] border border-rose-200 bg-rose-50 px-2.5 py-2 text-[12px] leading-relaxed text-rose-900"
        : "mt-2 rounded-[10px] border border-amber-200 bg-amber-50 px-2.5 py-2 text-[12px] leading-relaxed text-amber-950"}
      data-testid={important ? "role-help-important" : "role-help-note"}
    >
      <span className="font-extrabold">{important ? "Önemli: " : "Not: "}</span>
      {text}
    </p>
  );
}

function HelpShot({ image }) {
  if (!image) return null;
  return (
    <RoleHelpImage
      src={roleHelpImageSrc(image.file)}
      alt={image.alt}
      width={image.width}
      height={image.height}
    />
  );
}

export function RoleHelpPanel({ onClose }) {
  const closeRef = useRef(null);
  const bodyRef = useRef(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const jump = (id) => {
    const el = bodyRef.current?.querySelector(`#role-help-${id}`);
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "start" });
  };

  return createPortal(
    <>
      <div className="role-help-backdrop" data-testid="role-help-backdrop" {...backdropDismissProps(onClose)} />
      <div
        className="role-help-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="role-help-title"
        data-testid="role-help-panel"
      >
        <div className="sticky top-0 z-10 border-b border-slate-200 bg-white">
          <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-4">
            <div>
              <div className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-slate-500">Yardım</div>
              <h2 id="role-help-title" className="text-lg font-bold leading-tight">Roller ve yetkiler</h2>
            </div>
            <button
              type="button"
              ref={closeRef}
              onClick={onClose}
              className="rounded-lg p-1 text-slate-600 hover:bg-slate-100"
              aria-label="Kapat"
              data-testid="role-help-close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <nav className="flex gap-1.5 overflow-x-auto px-5 pb-3" aria-label="Yardım bölümleri">
            {ROLE_HELP_SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() => jump(section.id)}
                className="shrink-0 rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                data-testid={`role-help-jump-${section.id}`}
              >
                {section.title}
              </button>
            ))}
          </nav>
        </div>
        <div ref={bodyRef} className="role-help-body">
          {ROLE_HELP_SECTIONS.map((section) => (
            <section
              key={section.id}
              id={`role-help-${section.id}`}
              className="mt-5 border-t border-slate-100 pt-4 first:mt-0 first:border-t-0 first:pt-0"
              data-testid={`role-help-section-${section.id}`}
            >
              <div className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-slate-500">{section.eyebrow}</div>
              <h3 className="mt-0.5 text-[17px] font-bold text-slate-900">{section.title}</h3>
              {section.lead ? <p className="mt-2 text-[13px] leading-relaxed text-slate-700">{section.lead}</p> : null}
              {section.showLevels ? (
                <div className="mt-2 space-y-1.5" data-testid="role-help-levels">
                  {ROLE_HELP_LEVELS.map((lv) => (
                    <div
                      key={lv.key}
                      className={`rounded-[10px] border px-2.5 py-2 text-[13px] leading-relaxed ${LEVEL_TONE[lv.key]}`}
                      data-testid={`role-help-level-${lv.key}`}
                    >
                      <b>{lv.title}</b>
                      <span> — {lv.body}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              <HelpShot image={section.image} />
              {section.note ? <HelpNote text={section.note} kind={section.noteKind} /> : null}
              {(section.modules || []).map((mod) => (
                <div key={mod.id} className="mt-4" data-testid={`role-help-module-${mod.id}`}>
                  <h4 className="text-[15px] font-bold text-slate-900">{mod.title}</h4>
                  <p className="mt-1 text-[13px] leading-relaxed text-slate-700">{mod.body}</p>
                  <HelpShot image={mod.image} />
                  {mod.note ? <HelpNote text={mod.note} kind={mod.noteKind} /> : null}
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </>,
    document.body,
  );
}
