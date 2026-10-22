import React, { useEffect } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { Seo } from "../components/Seo";
import { MarketingFooter, MarketingNav, SiteHeader, siteBrand } from "../components/saas/SiteChrome";
import ShotFrame from "../components/saas/ShotFrame";
import {
  MODULES,
  MODULES_HERO,
  MODULE_CATEGORIES,
  categoryLabel,
  filterModules,
  normalizeCategory,
} from "../utils/modulesContent";

export default function ModulesPage() {
  const brand = siteBrand("TamKobi");
  const { hash } = useLocation();
  const [params, setParams] = useSearchParams();
  const active = normalizeCategory(params.get("kategori"));
  const cards = filterModules(active);

  useEffect(() => {
    const id = decodeURIComponent(String(hash || "").replace(/^#/, ""));
    if (!id) return;
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ block: "start" });
  }, [hash]);

  const selectCategory = (id) => {
    const next = new URLSearchParams(params);
    if (!id || id === "tumu") next.delete("kategori");
    else next.set("kategori", id);
    setParams(next, { replace: true });
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#0b0f1a] text-slate-100" data-testid="modules-page">
      <Seo
        title="Modüller | TamKobi"
        description={MODULES_HERO.lead}
        path="/moduller"
      />
      <SiteHeader brand={brand} right={<MarketingNav active="moduller" />} />

      <section className="mx-auto max-w-6xl px-6 pb-10 pt-10">
        <div className="text-[10px] font-semibold uppercase tracking-[0.25em] text-emerald-400">{MODULES_HERO.eyebrow}</div>
        <h1 className="mt-3 max-w-3xl text-[34px] font-black leading-[1.05] sm:text-5xl lg:text-[52px]">
          {MODULES_HERO.titleLead} <span className="text-emerald-400">{MODULES_HERO.titleEm}</span>{MODULES_HERO.titleTail}
        </h1>
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-slate-400">{MODULES_HERO.lead}</p>

        <div
          className="mt-8 flex w-full max-w-full gap-1.5 overflow-x-auto rounded-xl border border-white/10 bg-white/5 p-1 text-xs sm:w-fit sm:flex-wrap sm:overflow-visible"
          data-testid="module-category-filters"
          role="tablist"
        >
          {MODULE_CATEGORIES.map((cat) => {
            const on = cat.id === active;
            return (
              <button
                key={cat.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => selectCategory(cat.id)}
                className={`shrink-0 rounded-lg px-3.5 py-2 font-semibold ${on ? "bg-white text-slate-900" : "text-slate-300"}`}
                data-testid={`module-filter-${cat.id}`}
              >
                {cat.label}
              </button>
            );
          })}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3" data-testid="module-grid">
          {cards.map((mod) => (
            <article
              key={mod.slug}
              className="flex flex-col overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]"
              data-testid={`module-card-${mod.slug}`}
            >
              <ShotFrame
                slug={mod.slug}
                accent={mod.accent}
                icon={mod.icon}
                className="border-b border-dashed border-white/20"
              />
              <div className="flex flex-1 flex-col gap-1.5 px-[18px] pb-[18px] pt-4">
                <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-emerald-400">{categoryLabel(mod.category)}</div>
                <h3 className="text-[17px] font-semibold">{mod.title}</h3>
                <p className="flex-1 text-[13px] leading-snug text-slate-400">{mod.summary}</p>
                <Link
                  to={`/moduller#${mod.slug}`}
                  className="mt-2.5 self-start rounded-[10px] border border-emerald-400/40 px-3.5 py-1.5 text-xs font-bold text-emerald-300"
                  data-testid={`module-inspect-${mod.slug}`}
                >
                  İncele →
                </Link>
              </div>
            </article>
          ))}
        </div>

        <div className="mt-14 space-y-14">
          {MODULES.map((mod) => (
            <article
              key={mod.slug}
              id={mod.slug}
              className="grid scroll-mt-20 grid-cols-1 items-center gap-8 rounded-[28px] border border-white/10 bg-white/[0.03] p-5 sm:p-7 md:grid-cols-[1.25fr_1fr]"
              data-testid={`module-detail-${mod.slug}`}
            >
              <ShotFrame
                slug={mod.slug}
                accent={mod.accent}
                icon={mod.icon}
                className="rounded-[20px] border border-dashed border-white/20"
              />
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-[0.25em] text-emerald-400">{categoryLabel(mod.category)}</div>
                <h2 className="mt-2 text-3xl font-black">{mod.title}</h2>
                <p className="mt-1 text-[15px] leading-relaxed text-slate-400">{mod.detail}</p>
                <ul className="my-4 space-y-2.5 text-sm text-slate-300">
                  {mod.points.map((point) => (
                    <li key={point} className="flex gap-2.5">
                      <span className="font-black text-emerald-400" aria-hidden>✓</span>
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex flex-wrap gap-2.5">
                  <Link to="/kayit" className="rounded-xl bg-emerald-500 px-4 py-2 text-[13px] font-bold text-slate-900 hover:bg-emerald-400">Ücretsiz Dene</Link>
                  <Link to="/web#paketler" className="rounded-xl border border-white/20 px-4 py-2 text-[13px] font-bold">Paketlere bak</Link>
                </div>
              </div>
            </article>
          ))}
        </div>

        <p className="mt-6 rounded-[14px] border border-dashed border-yellow-400/50 bg-yellow-400/[0.06] px-3.5 py-2.5 text-xs text-amber-200">
          {MODULES_HERO.note}
        </p>
      </section>

      <MarketingFooter brand={brand} />
    </div>
  );
}
