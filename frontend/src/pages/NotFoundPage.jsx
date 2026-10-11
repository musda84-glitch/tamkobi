import React from "react";
import { Link } from "react-router-dom";
import { Seo } from "../components/Seo";
import { SiteHeader, siteBrand } from "../components/saas/SiteChrome";

export default function NotFoundPage() {
  return (
    <div className="min-h-screen bg-[#0b0f1a] text-slate-100" data-testid="not-found-page">
      <Seo
        title="Sayfa bulunamadı"
        description="Aradığınız sayfa bulunamadı."
        path="/404"
        noindex
      />
      <SiteHeader brand={siteBrand("TamKobi")} right={<Link to="/" className="text-xs text-emerald-400 font-bold">Ana sayfa</Link>} />
      <div className="max-w-lg mx-auto px-6 py-20 text-center">
        <div className="text-6xl font-black text-slate-700">404</div>
        <h1 className="text-2xl font-bold mt-4">Sayfa bulunamadı</h1>
        <p className="text-sm text-slate-400 mt-2">Aradığınız adres mevcut değil veya taşınmış olabilir.</p>
        <div className="flex flex-wrap justify-center gap-3 mt-8">
          <Link to="/" className="px-5 py-2.5 rounded-xl bg-emerald-500 text-slate-900 font-bold text-sm" data-testid="not-found-home">Ana sayfa</Link>
          <Link to="/web" className="px-5 py-2.5 rounded-xl border border-white/15 text-sm font-semibold text-slate-200" data-testid="not-found-pricing">Paketler</Link>
        </div>
      </div>
    </div>
  );
}
