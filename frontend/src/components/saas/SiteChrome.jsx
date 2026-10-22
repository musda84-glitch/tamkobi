import React, { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, X } from "lucide-react";
import TamKobiMark from "../TamKobiMark";
import { LegalFooterLinks } from "../LegalConsent";
import { useAuth } from "../../context/AuthContext";
import { siteBrand } from "../../utils/siteBrand";

export { siteBrand };

export const BrandMark = ({ name, testId = "site-brand" }) => {
  const brand = siteBrand(name);
  const isDefault = brand.toLocaleLowerCase("tr-TR") === "tamkobi";
  return (
    <Link to="/web" className="flex min-w-0 items-center gap-2.5 text-white" data-testid={testId}>
      <TamKobiMark className="w-8 h-8 shrink-0 rounded-lg" />
      <span className="min-w-0 leading-tight">
        {isDefault ? (
          <>
            <span className="text-lg tracking-tight">
              <span className="font-bold">Tam</span>
              <span className="font-medium text-slate-300">Kobi</span>
            </span>
            <span className="hidden md:block text-[9px] uppercase tracking-[0.18em] text-slate-400 font-semibold">KOBİ&apos;LER İÇİN TAM ERP</span>
          </>
        ) : (
          <span className="font-bold text-lg tracking-tight">{brand}</span>
        )}
      </span>
    </Link>
  );
};

export const SiteHeader = ({ brand, right }) => (
  <header className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-3">
    <BrandMark name={brand} />
    {right}
  </header>
);

function navLinks(onPricing) {
  return [
    { key: "urunler", to: "/urunler", label: "Ürünler", testId: "site-nav-products" },
    { key: "moduller", to: "/moduller", label: "Modüller", testId: "site-nav-modules" },
    { key: "paketler", to: onPricing ? "#paketler" : "/#paketler", label: "Paketler", testId: "site-nav-plans" },
    { key: "sss", to: onPricing ? "#sss" : "/#sss", label: "SSS", testId: "site-nav-faq" },
  ];
}

function navClass(active, key) {
  return active === key
    ? "text-xs font-bold text-white border-b-2 border-emerald-400 pb-0.5"
    : "text-xs font-semibold text-slate-300 hover:text-white";
}

/** Pazarlama üst menüsü. Ürünler ve Modüller mevcut linklerin önündedir. */
export function MarketingNav({ active = "", extras = [] }) {
  const { authenticated } = useAuth() || {};
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const onPricing = pathname === "/" || pathname === "/web";
  const links = [...navLinks(onPricing), ...extras];
  const close = () => setOpen(false);

  const authLinks = authenticated ? (
    <Link to="/panel" className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-900 rounded-xl font-bold text-xs" data-testid="pricing-go-panel" onClick={close}>Panele git</Link>
  ) : (
    <>
      <Link to="/login" className="text-xs text-slate-300 hover:text-white" data-testid="pricing-login-link" onClick={close}>Giriş Yap</Link>
      <Link to="/kayit" className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-900 rounded-xl font-bold text-xs" data-testid="pricing-signup-link" onClick={close}>Ücretsiz Dene</Link>
    </>
  );

  return (
    <div className="relative shrink-0">
      <nav className="hidden md:flex items-center gap-3.5" data-testid="site-nav-desktop">
        {links.map((item) => (
          <Link key={item.key} to={item.to} className={navClass(active, item.key)} data-testid={item.testId}>{item.label}</Link>
        ))}
        {authLinks}
      </nav>
      <button
        type="button"
        className="md:hidden inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 text-slate-200"
        aria-expanded={open}
        aria-label={open ? "Menüyü kapat" : "Menüyü aç"}
        data-testid="site-nav-toggle"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>
      {open ? (
        <div
          className="md:hidden absolute right-0 top-full z-50 mt-2 w-56 max-w-[calc(100vw-3rem)] rounded-2xl border border-white/10 bg-[#0b0f1a] p-2 shadow-2xl"
          data-testid="site-nav-menu"
        >
          {links.map((item) => (
            <Link
              key={`menu-${item.key}`}
              to={item.to}
              className="block rounded-lg px-3 py-2.5 text-sm text-slate-200 hover:bg-white/5"
              data-testid={`menu-${item.testId}`}
              onClick={close}
            >
              {item.label}
            </Link>
          ))}
          {authenticated ? (
            <Link to="/panel" className="mt-1 block rounded-xl bg-emerald-500 px-3 py-2.5 text-center text-sm font-bold text-slate-900" data-testid="menu-go-panel" onClick={close}>Panele git</Link>
          ) : (
            <>
              <Link to="/login" className="block rounded-lg px-3 py-2.5 text-sm text-slate-200" data-testid="menu-login" onClick={close}>Giriş Yap</Link>
              <Link to="/kayit" className="mt-1 block rounded-xl bg-emerald-500 px-3 py-2.5 text-center text-sm font-bold text-slate-900" data-testid="menu-signup" onClick={close}>Ücretsiz Dene</Link>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function MarketingFooter({ brand = "TamKobi", legalPrefix = "marketing-footer" }) {
  return (
    <footer className="border-t border-white/10 py-6 text-center text-[11px] text-slate-500 space-y-2">
      <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1" data-testid="site-footer-nav">
        <Link to="/urunler" className="hover:text-emerald-400" data-testid="footer-link-urunler">Ürünler</Link>
        <Link to="/moduller" className="hover:text-emerald-400" data-testid="footer-link-moduller">Modüller</Link>
      </nav>
      <LegalFooterLinks className="text-slate-500" prefix={legalPrefix} />
      <div>{brand} · Bulut ERP</div>
    </footer>
  );
}
