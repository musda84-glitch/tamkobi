import React from "react";
import { Helmet } from "react-helmet-async";

const DEFAULT_URL = "https://tamkobi.com";
const DEFAULT_IMAGE = `${DEFAULT_URL}/brand/og-image.jpg`;

export function defaultSeoDescription(trialDays = 14) {
  const days = Number(trialDays) > 0 ? Number(trialDays) : 14;
  return `TamKobi — fatura, stok, e-ticaret ve üretim için bulut ERP. Paketinizi seçin, ${days} gün ücretsiz deneyin; kredi kartı gerekmez.`;
}

/** Sayfa başlığı + meta + Open Graph / Twitter. */
export function Seo({
  title = "KOBİ'ler için Bulut ERP ve e-Fatura Programı | TamKobi",
  description,
  trialDays = 14,
  path = "/",
  image = DEFAULT_IMAGE,
  noindex = false,
  jsonLd = null,
}) {
  const resolvedDescription = description || defaultSeoDescription(trialDays);
  const origin = typeof window !== "undefined" ? window.location.origin : DEFAULT_URL;
  const url = `${(origin || DEFAULT_URL).replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  const absImage = image.startsWith("http") ? image : `${(origin || DEFAULT_URL).replace(/\/$/, "")}${image}`;
  const blocks = Array.isArray(jsonLd) ? jsonLd : jsonLd ? [jsonLd] : [];
  return (
    <Helmet>
      <html lang="tr" />
      <title>{title}</title>
      <meta name="description" content={resolvedDescription} />
      {noindex ? <meta name="robots" content="noindex,nofollow" /> : <meta name="robots" content="index,follow" />}
      <link rel="canonical" href={url} />
      <meta property="og:type" content="website" />
      <meta property="og:locale" content="tr_TR" />
      <meta property="og:site_name" content="TamKobi" />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={resolvedDescription} />
      <meta property="og:url" content={url} />
      <meta property="og:image" content={absImage} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={resolvedDescription} />
      <meta name="twitter:image" content={absImage} />
      {blocks.map((b, i) => (
        <script key={i} type="application/ld+json">{JSON.stringify(b)}</script>
      ))}
    </Helmet>
  );
}

export function buildOrgSoftwareJsonLd({ brand = "TamKobi", url = DEFAULT_URL, email, phone, plans = [], trialDays = 14 }) {
  const offers = (plans || []).map((p) => ({
    "@type": "Offer",
    name: p.name,
    price: String(Number(p.price_monthly) || 0),
    priceCurrency: "TRY",
    description: p.tagline || undefined,
    url: `${url.replace(/\/$/, "")}/kayit?plan=${p.id}`,
  }));
  return [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: brand,
      url,
      email: email || undefined,
      telephone: phone || undefined,
      logo: `${url.replace(/\/$/, "")}/brand/tamkobi-icon-192.png`,
    },
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: brand,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description: "KOBİ'ler için bulut ERP, e-Fatura, stok ve e-ticaret.",
      url,
      offers: offers.length
        ? offers
        : [{
          "@type": "Offer",
          price: "0",
          priceCurrency: "TRY",
          description: `${trialDays} gün ücretsiz deneme`,
        }],
    },
  ];
}

export function buildFaqJsonLd(items) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: (items || []).map((q) => ({
      "@type": "Question",
      name: q.q,
      acceptedAnswer: { "@type": "Answer", text: q.a },
    })),
  };
}
