/** Display brand without a trailing .com (API may store tamkobi.com). */
export function siteBrand(name) {
  let brand = String(name || "TamKobi").trim() || "TamKobi";
  brand = brand.replace(/\.com$/i, "").trim() || "TamKobi";
  const folded = brand.replace(/İ/g, "I").replace(/ı/g, "i").toLowerCase();
  if (folded === "tamkobi") return "TamKobi";
  return brand;
}
