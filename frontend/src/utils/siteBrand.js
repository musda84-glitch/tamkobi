/** Display brand without a trailing .com (API may store tamkobi.com). */
export function siteBrand(name) {
  let brand = String(name || "TamKobi").trim() || "TamKobi";
  brand = brand.replace(/\.com$/i, "").trim() || "TamKobi";
  if (brand.toLocaleLowerCase("tr-TR") === "tamkobi") return "TamKobi";
  return brand;
}
