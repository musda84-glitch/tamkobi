/** Gelen e-belge listesinde aynı GİB faturasının kopyalarını gizler. */

export function uniqueInboxItems(items) {
  const seen = new Set();
  const out = [];
  for (const d of items || []) {
    const uuid = String(d.uuid || "").trim().toLowerCase().replace(/[{}]/g, "");
    const number = String(d.number || "").trim().toLowerCase();
    const kind = d.kind === "dispatch" ? "dispatch" : "invoice";
    const keys = [];
    if (uuid) keys.push(`u:${uuid}`);
    if (number) keys.push(`n:${kind}:${number}`);
    if (!keys.length) keys.push(`id:${d.id}`);
    if (keys.some((k) => seen.has(k))) continue;
    keys.forEach((k) => seen.add(k));
    out.push(d);
  }
  return out;
}
