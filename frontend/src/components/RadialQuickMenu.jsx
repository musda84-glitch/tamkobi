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
  Settings2,
  Package,
  Users,
  Landmark,
  Building2,
  Truck,
  Receipt,
  Boxes,
  Factory,
  UserCheck,
  UserRound,
  Bot,
  MailOpen,
  Briefcase,
  FileSignature,
  Ruler,
  Calculator,
  CalendarClock,
  MonitorPlay,
  BarChart3,
  Trash2,
  Inbox,
  Globe,
  ClipboardList,
  Smartphone,
  ScrollText,
  Headset,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { ContactForm } from "./ContactForm";
import {
  isRadialBlankTarget,
  RADIAL_ENABLED_KEY,
  specialById,
  toneForIndex,
} from "../utils/radialQuickMenu";

export { isRadialBlankTarget } from "../utils/radialQuickMenu";

const PATH_ICONS = {
  "/": LayoutDashboard,
  "/panel": LayoutDashboard,
  "/invoices": FileText,
  "/dis-ticaret": Globe,
  "/dispatches": Truck,
  "/expenses": Receipt,
  "/loans": Landmark,
  "/cheques": ScrollText,
  "/contacts": Users,
  "/banking": Landmark,
  "/stock": Package,
  "/hizli-satis": ShoppingCart,
  "/sayim": ClipboardList,
  "/quotes": FileSignature,
  "/projects": Briefcase,
  "/surveys": Ruler,
  "/ecommerce": ShoppingCart,
  "/cargo": Truck,
  "/orders": Boxes,
  "/saha": Smartphone,
  "/sevk": ClipboardList,
  "/warehouses": Building2,
  "/production": Factory,
  "/personnel": UserCheck,
  "/personelim": UserRound,
  "/mesai": CalendarClock,
  "/communication": MailOpen,
  "/ai-advisor": Bot,
  "/settings": ShieldCheck,
  "/support": Headset,
  "/accountant": Calculator,
  "/installments": CalendarClock,
  "/atolye": MonitorPlay,
  "/reports": BarChart3,
  "/trash": Trash2,
  "/edoc-inbox": Inbox,
  "/b2b-yonetim": ShoppingCart,
};

const SPECIAL_ICONS = {
  "action:invoice-new": PlusCircle,
  "action:contact-new": UserPlus,
  "action:order-new": FileText,
  "action:barcode": QrCode,
  "action:virman": ArrowRightLeft,
};

function loadEnabled() {
  try {
    const v = localStorage.getItem(RADIAL_ENABLED_KEY);
    if (v === null) return true;
    return v === "1";
  } catch {
    return true;
  }
}

/**
 * Panel radial (circular) quick menu — slot tasks come from user preferences /
 * Settings → Menü & Hızlı Menü.
 */
export function RadialQuickMenu({ companyId }) {
  const navigate = useNavigate();
  const { can, feature, moduleOn, addonOn, menuItems, radialSlots } = useAuth();
  const [enabled, setEnabled] = useState(loadEnabled);
  const [menu, setMenu] = useState(null);
  const [newContact, setNewContact] = useState(false);

  const setEnabledPersist = useCallback((next) => {
    setEnabled(next);
    try { localStorage.setItem(RADIAL_ENABLED_KEY, next ? "1" : "0"); } catch { /* ignore */ }
    if (!next) setMenu(null);
  }, []);

  const close = useCallback(() => setMenu(null), []);

  const actions = useMemo(() => {
    const byPath = Object.fromEntries((menuItems || []).map((m) => [m.path, m]));
    const list = [];
    (radialSlots || []).forEach((slot, idx) => {
      if (!slot) return;
      const special = specialById(slot);
      if (special) {
        const path = special.pathHint;
        if (!moduleOn(path) || !can(path, special.id === "action:barcode" ? "view" : "edit")) return;
        if (special.id === "action:invoice-new" && !feature("header_invoice")) return;
        if (special.id === "action:barcode" && !feature("header_barcode")) return;
        if (special.id === "action:virman" && !feature("header_virman")) return;
        list.push({
          id: special.id,
          label: special.label.replace(/^Yeni /, "").replace(" Oku", ""),
          icon: SPECIAL_ICONS[special.id] || Package,
          tone: special.tone || toneForIndex(idx),
          run: () => {
            if (special.id === "action:contact-new") setNewContact(true);
            else if (special.href) navigate(special.href);
          },
        });
        return;
      }
      const item = byPath[slot];
      if (!item) return;
      if (slot === "/ai-advisor" && !addonOn("ai.advisor")) return;
      if (slot === "/support" && !addonOn("support.tickets")) return;
      list.push({
        id: slot,
        label: item.label.length > 14 ? item.label.slice(0, 12) + "…" : item.label,
        icon: PATH_ICONS[slot] || Package,
        tone: toneForIndex(idx),
        run: () => navigate(slot),
      });
    });
    return list;
  }, [addonOn, can, feature, menuItems, moduleOn, navigate, radialSlots]);

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

  useEffect(() => {
    if (!menu) return undefined;
    const closeOnScroll = () => setMenu(null);
    window.addEventListener("scroll", closeOnScroll, true);
    return () => window.removeEventListener("scroll", closeOnScroll, true);
  }, [menu]);

  const openAtCenter = () => {
    if (!enabled) setEnabledPersist(true);
    setMenu({ x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) });
  };

  const runAction = (action) => {
    close();
    action.run();
  };

  const goConfigure = () => {
    close();
    navigate("/settings?tab=modules");
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
        <button
          type="button"
          onClick={goConfigure}
          className="p-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition"
          title="Hızlı menü görevlerini düzenle"
          data-testid="radial-quick-menu-config-btn"
        >
          <Settings2 className="w-3.5 h-3.5" />
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
            <div className="absolute inset-[46px] rounded-full border border-white/40 bg-white/10 shadow-[0_0_0_1px_rgba(15,23,42,0.06)] pointer-events-none" />
            <div className="absolute inset-[70px] rounded-full bg-gradient-to-br from-white via-slate-50 to-emerald-50 border border-slate-200 shadow-xl flex flex-col items-center justify-center gap-1">
              <button
                type="button"
                onClick={close}
                className="w-11 h-11 rounded-full bg-slate-900 text-white hover:bg-slate-800 flex items-center justify-center shadow-lg transition"
                title="Kapat"
                data-testid="radial-quick-menu-close"
              >
                <X className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={goConfigure}
                className="text-[9px] font-semibold text-emerald-700 hover:underline"
                data-testid="radial-quick-menu-edit-link"
              >
                Görevleri düzenle
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
                  key={`${action.id}-${i}`}
                  type="button"
                  onClick={() => runAction(action)}
                  className="absolute left-1/2 top-1/2 w-[4.25rem] -ml-[2.125rem] -mt-[2.125rem] flex flex-col items-center gap-1 group"
                  style={{ transform: `translate(${x}px, ${y}px)` }}
                  title={action.label}
                  data-testid={`radial-action-${String(action.id).replace(/[/:]/g, "-")}`}
                >
                  <span className={`w-11 h-11 rounded-full ${tone} shadow-lg flex items-center justify-center ring-2 ring-white/80 transition-transform group-hover:scale-110`}>
                    <Icon className="w-[18px] h-[18px]" />
                  </span>
                  <span className="text-[10px] font-semibold text-slate-800 bg-white/95 border border-slate-200 px-1.5 py-0.5 rounded-md shadow-sm whitespace-nowrap max-w-[5.5rem] truncate">
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
