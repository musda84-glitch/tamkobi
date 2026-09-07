import React from "react";
import { Link } from "react-router-dom";

export const siteBrand = (name) => (name || "TamKobi").trim() || "TamKobi";

export const BrandMark = ({ name, testId = "site-brand" }) => {
  const brand = siteBrand(name);
  return (
    <Link to="/web" className="font-bold text-lg tracking-tight text-white" data-testid={testId}>
      {brand}<span className="text-emerald-400">.com</span>
    </Link>
  );
};

export const SiteHeader = ({ brand, right }) => (
  <header className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
    <BrandMark name={brand} />
    {right}
  </header>
);
