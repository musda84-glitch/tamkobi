/** Başlıkta tek satır kaldığı için yalnızca ilk ad kullanılır. */
export function firstName(name?: string | null): string {
  return String(name || "").trim().split(/\s+/)[0] || "";
}

export function greetingLine(name?: string | null): string {
  const first = firstName(name);
  return first ? `Merhaba, ${first}` : "Merhaba";
}
