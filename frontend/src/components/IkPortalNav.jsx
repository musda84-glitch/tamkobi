import React from "react";
import { Link } from "react-router-dom";
import {
  Car,
  ClipboardList,
  Clock,
  Factory,
  Package,
  PackageCheck,
  ShoppingCart,
  User,
  Wrench,
} from "lucide-react";

/**
 * Görünüm bilgisi. Hangi bağlantının listeleneceği `visibleIkLinks` içinde kalır;
 * burası yalnızca ikon ve dar ekran etiketi.
 */
export const IK_NAV_META = {
  "/personelim": { icon: User, iconName: "user", shortLabel: "Personelim" },
  "/mesai": { icon: Clock, iconName: "clock", shortLabel: "Mesaim" },
  "/atolye": { icon: Factory, iconName: "factory", shortLabel: "Atölye", withWrench: true },
  "/sevk": { icon: PackageCheck, iconName: "package-check", shortLabel: "Toplama" },
  "/sayim": { icon: ClipboardList, iconName: "clipboard-list", shortLabel: "Sayım" },
  "/saha": { icon: ShoppingCart, iconName: "shopping-cart", shortLabel: "Saha" },
  "/vehicles": { icon: Car, iconName: "car", shortLabel: "Araç" },
  "/orders": { icon: Package, iconName: "package", shortLabel: "Sipariş" },
};

export function ikNavActive(pathname, to) {
  const path = String(pathname || "");
  return path === to || path.startsWith(`${to}/`);
}

function NavGlyph({ meta, className }) {
  const box = className || "h-4 w-4";
  if (!meta?.icon) {
    return <span className={`${box} inline-block shrink-0`} aria-hidden="true" />;
  }
  const Icon = meta.icon;
  if (meta.withWrench) {
    return (
      <span className="inline-flex shrink-0 items-center gap-0.5" data-icon="factory" aria-hidden="true">
        <Icon className={`${box} shrink-0`} />
        <Wrench className="h-3.5 w-3.5 shrink-0" data-icon="wrench" />
      </span>
    );
  }
  return <Icon className={`${box} shrink-0`} data-icon={meta.iconName} aria-hidden="true" />;
}

const DESKTOP_TAB =
  "relative inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 text-sm font-semibold leading-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600";

const MOBILE_TAB =
  "relative inline-flex h-16 min-w-[4.5rem] shrink-0 grow flex-col items-center justify-center gap-1 whitespace-nowrap px-2 text-[11px] font-semibold leading-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600";

function DesktopLabel({ link, meta }) {
  const shortLabel = meta?.shortLabel || link.label;
  if (shortLabel === link.label) {
    return <span className="whitespace-nowrap leading-none">{link.label}</span>;
  }
  return (
    <>
      <span className="whitespace-nowrap leading-none lg:hidden">{shortLabel}</span>
      <span className="hidden whitespace-nowrap leading-none lg:inline">{link.label}</span>
    </>
  );
}

function DesktopTab({ link, active }) {
  const meta = IK_NAV_META[link.to];
  return (
    <Link
      to={link.to}
      title={link.label}
      aria-label={link.label}
      aria-current={active ? "page" : undefined}
      data-active={active ? "true" : "false"}
      data-testid={`ik-nav-${link.to.slice(1)}`}
      className={`${DESKTOP_TAB} ${active ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}
    >
      <NavGlyph meta={meta} className="h-4 w-4" />
      <DesktopLabel link={link} meta={meta} />
      <span
        className={`pointer-events-none absolute inset-x-3 bottom-1 h-0.5 rounded-full ${active ? "bg-emerald-400" : "bg-transparent"}`}
        aria-hidden="true"
      />
    </Link>
  );
}

function MobileTab({ link, active }) {
  const meta = IK_NAV_META[link.to];
  const shortLabel = meta?.shortLabel || link.label;
  return (
    <Link
      to={link.to}
      title={link.label}
      aria-label={link.label}
      aria-current={active ? "page" : undefined}
      data-active={active ? "true" : "false"}
      data-testid={`ik-nav-mobile-${link.to.slice(1)}`}
      className={`${MOBILE_TAB} ${active ? "text-slate-900" : "text-slate-500"}`}
    >
      <span
        className={`inline-flex h-7 shrink-0 items-center justify-center rounded-lg ${meta?.withWrench ? "px-1.5" : "w-7"} ${active ? "bg-slate-900 text-white" : "text-slate-500"}`}
      >
        <NavGlyph meta={meta} className="h-4 w-4" />
      </span>
      <span className="whitespace-nowrap leading-none">{shortLabel}</span>
    </Link>
  );
}

const DESKTOP_SCROLLER =
  "flex flex-nowrap items-center gap-1 overflow-x-auto overflow-y-hidden overscroll-x-contain";
const MOBILE_SCROLLER =
  "flex h-16 flex-nowrap items-center overflow-x-auto overflow-y-hidden overscroll-x-contain px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

/** Masaüstü sekme çubuğu veya dar ekran alt menüsü. `links` çağıran tarafın süzdüğü listedir. */
export function IkNavTabs({ links, pathname, variant }) {
  if (!links?.length) return null;
  if (variant === "mobile") {
    return (
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
        data-testid="ik-nav-mobile"
        aria-label="Personel menüsü"
      >
        <div className={MOBILE_SCROLLER}>
          {links.map((link) => (
            <MobileTab key={link.to} link={link} active={ikNavActive(pathname, link.to)} />
          ))}
        </div>
      </nav>
    );
  }
  return (
    <nav
      className="hidden border-t border-slate-100 md:block"
      data-testid="ik-nav"
      aria-label="Personel menüsü"
    >
      <div className={`${DESKTOP_SCROLLER} mx-auto h-12 max-w-7xl px-3`}>
        {links.map((link) => (
          <DesktopTab key={link.to} link={link} active={ikNavActive(pathname, link.to)} />
        ))}
      </div>
    </nav>
  );
}
