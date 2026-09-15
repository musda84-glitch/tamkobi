import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  PlusCircle,
  QrCode,
  ArrowRightLeft,
  UserPlus,
  FileText,
  ShoppingCart,
  Sparkles,
  LayoutDashboard,
  X,
  CircleDot,
  CircleOff,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { ContactForm } from "./ContactForm";
import { isRadialBlankTarget } from "../utils/radialQuickMenu";

const STORAGE_KEY = "radial_quick_menu";

export { isRadialBlankTarget } from "../utils/radialQuickMenu";

function loadEnabled() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === null) return true;
    return v === "1";
  } catch {
    return true;
  }
}

/**
 * Panel radial (circular) quick menu.
 * - Toggle on/off from header
 * - Right-click empty areas (not on buttons/links/inputs) to open at cursor
 */
export function RadialQuickMenu({ companyId }) {
  const navigate = useNavigate();
  const { can, feature, moduleOn, addonOn } = useAuth();
  const [enabled, setEnabled] = useState(loadEnabled);
  const [menu, setMenu] = useState(null); // { x, y }
  const [newContact, setNewContact] = useState(false);

  const setEnabledPersist = useCallback((next) => {
    setEnabled(next);
    try { localStorage.setItem(STORAGE_KEY, next ? "1" : "0"); } catch { /* ignore */ }
    if (!next) setMenu(null);
  }, []);

  const close = useCallback(() => setMenu(null), []);

  const actions = useMemo(() => {
    const list = [];
    list.push({
      id: "panel",
      label: "Panel",
      icon: LayoutDashboard,
      tone: "slate",
      run: () => navigate("/panel"),
    });
    if (feature("header_invoice") && can("/invoices", "edit") && moduleOn("/invoices")) {
      list.push({
        id: "invoice",
        label: "Fatura",
        icon: PlusCircle,
        tone: "emerald",
        run: () => navigate("/invoices?new=true"),
      });
    }
    if (can("/contacts", "edit") && moduleOn("/contacts")) {
      list.push({
        id: "contact",
        label: "Cari",
        icon: UserPlus,
        tone: "sky",
        run: () => setNewContact(true),
      });
    }
    if (can("/orders", "edit") && moduleOn("/orders")) {
      list.push({
        id: "order",
        label: "Sipariş",
        icon: FileText,
        tone: "amber",
        run: () => navigate("/orders?new=1"),
      });
    }
    if (feature("header_barcode") && can("/stock") && moduleOn("/stock")) {
      list.push({
        id: "barcode",
        label: "Barkod",
        icon: QrCode,
        tone: "indigo",
        run: () => navigate("/stock?scan=true"),
      });
    }
    if (feature("header_virman") && can("/banking", "edit") && moduleOn("/banking")) {
      list.push({
        id: "virman",
        label: "Virman",
        icon: ArrowRightLeft,
        tone: "teal",
        run: () => navigate("/banking?action=virman"),
      });
    }
    if (can("/hizli-satis") && moduleOn("/hizli-satis")) {
      list.push({
        id: "pos",
        label: "Hızlı Satış",
        icon: ShoppingCart,
        tone: "orange",
        run: () => navigate("/hizli-satis"),
      });
    }
    if (feature("header_ai") && addonOn("ai.advisor") && moduleOn("/ai-advisor")) {
      list.push({
        id: "ai",
        label: "AI",
        icon: Sparkles,
        tone: "violet",
        run: () => navigate("/ai-advisor"),
      });
    }
    return list;
  }, [addonOn, can, feature, moduleOn, navigate]);

  useEffect(() => {
    if (!enabled) return undefined;
    const onContextMenu = (e) => {
      if (e.defaultPrevented) return;
      if (!isRadialBlankTarget(e.target)) return;
      e.preventDefault();
      const pad = 140;
      const x = Math.min(Math.max(e.clientX, pad), window.innerWidth - pad);
      const y = Math.min(Math.max(e.clientY, pad), window.innerHeight - pad);
      setMenu({ x, y });
    };
    const onKey = (e) => { if (e.key === "Escape") setMenu(null); };
    document.addEventListener("contextmenu", onContextMenu, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("contextmenu", onContextMenu, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [enabled]);

  // Close on route navigation / scroll
  useEffect(() => {
    if (!menu) return undefined;
    const closeOnScroll = () => setMenu(null);
    window.addEventListener("scroll", closeOnScroll, true);
    return () => window.removeEventListener("scroll", closeOnScroll, true);
  }, [menu]);

  const openAtCenter = () => {
    if (!enabled) {
      setEnabledPersist(true);
    }
    setMenu({ x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) });
  };

  const runAction = (action) => {
    close();
    action.run();
  };

  const n = actions.length || 1;
  const radius = 96;

  return (
    <>
      <div className="flex items-center gap-1" data-testid="radial-quick-menu-controls">
        <button
          type="button"
          onClick={openAtCenter}
          disabled={!enabled}
          className={`flex items-center gap-1.5 px-2 md:px-3 py-1.5 rounded-lg text-xs font-medium transition ${enabled ? "bg-slate-900 hover:bg-slate-800 text-white" : "bg-slate-100 text-slate-400 cursor-not-allowed"}`}
          title={enabled ? "Hızlı menüyü aç (veya boş alana sağ tık)" : "Önce hızlı menüyü açın"}
          data-testid="radial-quick-menu-open-btn"
        >
          <CircleDot className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Hızlı Menü</span>
        </button>
        <button
          type="button"
          onClick={() => setEnabledPersist(!enabled)}
          className={`p-1.5 rounded-lg transition ${enabled ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}
          title={enabled ? "Sağ tık hızlı menüyü kapat" : "Sağ tık hızlı menüyü aç"}
          aria-pressed={enabled}
          data-testid="radial-quick-menu-toggle-btn"
        >
          {enabled ? <CircleDot className="w-3.5 h-3.5" /> : <CircleOff className="w-3.5 h-3.5" />}
        </button>
      </div>

      {menu && createPortal(
        <div
          className="fixed inset-0 z-[80]"
          data-testid="radial-quick-menu"
          onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
          onContextMenu={(e) => { e.preventDefault(); close(); }}
        >
          <div className="absolute inset-0 bg-slate-900/25 backdrop-blur-[1px]" />
          <div
            className="absolute w-[280px] h-[280px] -translate-x-1/2 -translate-y-1/2"
            style={{ left: menu.x, top: menu.y }}
            data-testid="radial-quick-menu-ring"
          >
            {/* ring track */}
            <div className="absolute inset-[46px] rounded-full border border-white/40 bg-white/10 shadow-[0_0_0_1px_rgba(15,23,42,0.06)] pointer-events-none" />
            <div className="absolute inset-[70px] rounded-full bg-gradient-to-br from-white via-slate-50 to-emerald-50 border border-slate-200 shadow-xl flex items-center justify-center">
              <button
                type="button"
                onClick={close}
                className="w-12 h-12 rounded-full bg-slate-900 text-white hover:bg-slate-800 flex items-center justify-center shadow-lg transition"
                title="Kapat"
                data-testid="radial-quick-menu-close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {actions.map((action, i) => {
              const angle = (-90 + (360 / n) * i) * (Math.PI / 180);
              const x = Math.cos(angle) * radius;
              const y = Math.sin(angle) * radius;
              const Icon = action.icon;
              const tone = {
                slate: "bg-slate-800 text-white hover:bg-slate-700",
                emerald: "bg-emerald-600 text-white hover:bg-emerald-500",
                sky: "bg-sky-600 text-white hover:bg-sky-500",
                amber: "bg-amber-500 text-white hover:bg-amber-400",
                indigo: "bg-indigo-600 text-white hover:bg-indigo-500",
                teal: "bg-teal-600 text-white hover:bg-teal-500",
                orange: "bg-orange-500 text-white hover:bg-orange-400",
                violet: "bg-violet-600 text-white hover:bg-violet-500",
              }[action.tone] || "bg-slate-800 text-white";
              return (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => runAction(action)}
                  className={`absolute left-1/2 top-1/2 w-[4.25rem] -ml-[2.125rem] -mt-[2.125rem] flex flex-col items-center gap-1 group`}
                  style={{ transform: `translate(${x}px, ${y}px)` }}
                  title={action.label}
                  data-testid={`radial-action-${action.id}`}
                >
                  <span className={`w-11 h-11 rounded-full ${tone} shadow-lg flex items-center justify-center ring-2 ring-white/80 transition-transform group-hover:scale-110`}>
                    <Icon className="w-4.5 h-4.5 w-[18px] h-[18px]" />
                  </span>
                  <span className="text-[10px] font-semibold text-slate-800 bg-white/95 border border-slate-200 px-1.5 py-0.5 rounded-md shadow-sm whitespace-nowrap">
                    {action.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}

      {newContact && (
        <ContactForm
          companyId={companyId}
          onClose={() => setNewContact(false)}
          onSaved={(c) => {
            setNewContact(false);
            navigate(`/contacts?contact_id=${c.id}`);
          }}
        />
      )}
    </>
  );
}

export default RadialQuickMenu;
