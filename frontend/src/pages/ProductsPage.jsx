import React from "react";
import { Link } from "react-router-dom";
import { Seo } from "../components/Seo";
import { MarketingFooter, MarketingNav, SiteHeader, siteBrand } from "../components/saas/SiteChrome";
import ShotFrame from "../components/saas/ShotFrame";
import { PRODUCTS, PRODUCTS_HERO } from "../utils/modulesContent";

export default function ProductsPage() {
  const brand = siteBrand("TamKobi");
  return (
    <div className="min-h-screen overflow-x-hidden bg-[#0b0f1a] text-slate-100" data-testid="products-page">
      <Seo
        title="Ürünler | TamKobi"
        description={PRODUCTS_HERO.lead}
        path="/urunler"
      />
      <SiteHeader brand={brand} right={<MarketingNav active="urunler" />} />

      <section className="mx-auto max-w-6xl px-6 pb-6 pt-10">
        <div className="text-[10px] font-semibold uppercase tracking-[0.25em] text-emerald-400">{PRODUCTS_HERO.eyebrow}</div>
        <h1 className="mt-3 max-w-3xl text-[34px] font-black leading-[1.05] sm:text-5xl lg:text-[52px]">
          {PRODUCTS_HERO.titleLead} <span className="text-emerald-400">{PRODUCTS_HERO.titleEm}</span>{PRODUCTS_HERO.titleTail}
        </h1>
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-slate-400">{PRODUCTS_HERO.lead}</p>
      </section>

      <div className="mx-auto max-w-6xl px-6">
        {PRODUCTS.map((product) => (
          <section
            key={product.slug}
            id={product.slug}
            className="grid grid-cols-1 items-center gap-8 border-t border-white/10 py-7 md:grid-cols-[1.2fr_1fr] md:gap-10 md:py-10"
            data-testid={`product-section-${product.slug}`}
          >
            <div className={product.reverse ? "min-w-0 md:order-2" : "min-w-0"}>
              <ShotFrame
                slug={product.slug}
                alt={`${product.title} ekran görüntüsü`}
                width={product.width}
                height={product.height}
                accent={product.accent}
                icon={product.icon}
                className="rounded-3xl border border-white/10"
              />
            </div>
            <div className={product.reverse ? "min-w-0 md:order-1" : "min-w-0"}>
              <div className="text-xs font-bold text-indigo-300" data-testid={`product-domain-${product.slug}`}>{product.domain}</div>
              <h2 className="mt-2 text-3xl font-black">{product.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{product.summary}</p>
              <ul className="my-4 space-y-2.5 text-sm text-slate-300">
                {product.points.map((point) => (
                  <li key={point} className="flex gap-2.5">
                    <span className="font-black text-emerald-400" aria-hidden>✓</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex flex-wrap gap-2.5">
                <Link to="/kayit" className="rounded-xl bg-emerald-500 px-4 py-2 text-[13px] font-bold text-slate-900 hover:bg-emerald-400">Ücretsiz Dene</Link>
                <Link to="/moduller" className="rounded-xl border border-white/20 px-4 py-2 text-[13px] font-bold">Modülleri incele</Link>
              </div>
            </div>
          </section>
        ))}
        <p className="mt-2 rounded-[14px] border border-dashed border-yellow-400/50 bg-yellow-400/[0.06] px-3.5 py-2.5 text-xs text-amber-200">
          {PRODUCTS_HERO.note}
        </p>
      </div>

      <MarketingFooter brand={brand} />
    </div>
  );
}
