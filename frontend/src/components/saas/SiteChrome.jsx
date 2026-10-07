
import React from "react";
import { Link } from "react-router-dom";
import TamKobiMark from "../TamKobiMark";

export const siteBrand = (name) => (name || "TamKobi").trim() || "TamKobi";

export const BrandMark = ({ name, testId = "site-brand" }) => {
  const brand = siteBrand(name);
  const isDefault = brand.toLocaleLowerCase("tr-TR") === "tamkobi";
  return (
    <Link to="/web" className="flex items-center gap-2.5 text-white" data-testid={testId}>
      <TamKobiMark className="w-8 h-8 shrink-0 rounded-lg" />
      <span className="leading-tight">
        {isDefault ? (
          <>
            <span className="text-lg tracking-tight">
              <span className="font-bold">Tam</span>
              <span className="font-medium text-slate-300">Kobi</span>
            </span>
            <span className="block text-[9px] uppercase tracking-[0.18em] text-slate-400 font-semibold">KOBİ&apos;LER İÇİN TAM ERP</span>
          </>
        ) : (
          <span className="font-bold text-lg tracking-tight">{brand}<span className="text-[#c6f432]">.com</span></span>
        )}
      </span>
    </Link>
  );
};

export const SiteHeader = ({ brand, right }) => (
  <header className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
    <BrandMark name={brand} />
    {right}
  </header>
);
