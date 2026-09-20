/** Başlıkta tek satır kaldığı için yalnızca ilk ad kullanılır. */
export function firstName(name?: string | null): string {
  return String(name || "").trim().split(/\s+/)[0] || "";
}

export function greetingLine(name?: string | null): string {
  const first = firstName(name);
  return first ? `Merhaba, ${first}` : "Merhaba";
}

/** Logo yoksa başlık rozeti: firmanın ilk iki harfi. */
export function companyInitials(name?: string | null): string {
  const letters = String(name || "").replace(/[^A-Za-zÇĞİÖŞÜçğıöşü0-9]/g, "");
  return letters.toLocaleUpperCase("tr-TR").slice(0, 2) || "TK";
}
