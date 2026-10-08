/** Pazaryeri satırı ↔ stok kartı akıllı eşleşme skoru / önerileri. */

export function normMatchCode(val) {
  const s = String(val || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s || "";
}

export function normMatchText(val) {
  return String(val || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9ğüşıöç\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(text) {
  return new Set(normMatchText(text).split(" ").filter((t) => t.length >= 2));
}

/** Basit jaccard + alt dizi benzerliği (0–1). */
export function textSimilarity(a, b) {
  const na = normMatchText(a);
  const nb = normMatchText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.88;
  const ta = tokenSet(na);
  const tb = tokenSet(nb);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  ta.forEach((t) => { if (tb.has(t)) inter += 1; });
  const union = ta.size + tb.size - inter;
  const jaccard = union ? inter / union : 0;
  // Ortak uzun önek/ek bonus
  let prefix = 0;
  const lim = Math.min(na.length, nb.length, 24);
  while (prefix < lim && na[prefix] === nb[prefix]) prefix += 1;
  const prefixBonus = prefix >= 4 ? Math.min(0.15, prefix / 80) : 0;
  return Math.min(1, jaccard * 0.85 + prefixBonus);
}

/**
 * Pazaryeri satırına stok kartı skoru (0–1).
 * Barkod/SKU tam eşleşme > alias > ad benzerliği.
 */
export function scoreMarketplaceProductMatch(row, product) {
  if (!row || !product) return 0;
  const rowCodes = [row.barcode, row.stock_code, row.sku]
    .map(normMatchCode)
    .filter(Boolean);
  const prodCodes = [product.barcode, product.sku]
    .map(normMatchCode)
    .filter(Boolean);
  const aliases = (product.marketplace_aliases || []).map(normMatchCode).filter(Boolean);

  for (const rc of rowCodes) {
    if (prodCodes.includes(rc)) return 1;
    if (aliases.includes(rc)) return 0.98;
  }

  const title = row.title || row.product_name || row.name || "";
  const nameScore = textSimilarity(title, product.name || "");
  const skuInTitle = prodCodes.some((c) => c.length >= 4 && normMatchCode(title).includes(c));
  let score = nameScore;
  if (skuInTitle) score = Math.max(score, 0.82);
  // Stok kodu ad içinde geçiyorsa
  const sc = normMatchCode(row.stock_code);
  if (sc && sc.length >= 4 && normMatchCode(product.name).includes(sc)) {
    score = Math.max(score, 0.8);
  }
  return Math.round(score * 100) / 100;
}

/**
 * @returns {{ product, score, reason }[]}
 */
export function suggestMarketplaceProductMatches(row, products, { limit = 3, minScore = 0.45 } = {}) {
  const list = Array.isArray(products) ? products : [];
  const scored = list
    .map((product) => {
      const score = scoreMarketplaceProductMatch(row, product);
      let reason = "ad";
      if (score >= 0.99) reason = "barkod";
      else if (score >= 0.97) reason = "alias";
      else if (score >= 0.8) reason = "güçlü";
      else if (score >= 0.55) reason = "benzer";
      return { product, score, reason };
    })
    .filter((x) => x.score >= minScore)
    .sort((a, b) => b.score - a.score || String(a.product?.name || "").localeCompare(String(b.product?.name || ""), "tr"));
  return scored.slice(0, limit);
}

/** Toplu öneri: barcode → productId (yalnız güven eşiğinin üstü). */
export function fillMarketplaceMatchSuggestions(rows, products, { minScore = 0.55 } = {}) {
  const out = {};
  for (const row of rows || []) {
    if (row?.product_id) continue;
    const bc = row?.barcode;
    if (!bc) continue;
    const top = suggestMarketplaceProductMatches(row, products, { limit: 1, minScore })[0];
    if (top?.product) {
      out[bc] = top.product.id || top.product._id;
    }
  }
  return out;
}

export function matchSuggestionLabel(score) {
  const pct = Math.round((Number(score) || 0) * 100);
  if (pct >= 95) return `AI %${pct} · kesin`;
  if (pct >= 70) return `AI %${pct} · güçlü`;
  return `AI %${pct} · öneri`;
}
