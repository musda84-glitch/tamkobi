export function normalizeWorkParks(raw) {
  const rows = Array.isArray(raw) ? raw : [];
  const used = new Set();
  const out = [];
  rows.forEach((row, i) => {
    const name = String(typeof row === "string" ? row : (row?.name || row?.label || "")).trim();
    if (!name) return;
    let id = String((typeof row === "object" && (row.id || row.key)) || "").trim();
    if (!id || used.has(id)) id = `park_${i}`;
    used.add(id);
    out.push({ id, name: name.slice(0, 80) });
  });
  return out.slice(0, 40);
}

export function parkSelectGroups(parks) {
  const rows = normalizeWorkParks(parks);
  if (!rows.length) return [];
  return [{ label: "Parkurlar", options: rows.map((p) => ({ value: p.id, label: p.name })) }];
}

export function stationNamesFromParks(parks, fallback) {
  const names = [];
  const seen = new Set();
  for (const p of normalizeWorkParks(parks)) {
    const name = p.name.trim();
    const key = name.toLocaleLowerCase("tr-TR");
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  if (names.length) return names;
  for (const s of fallback || []) {
    const name = String(s || "").trim();
    const key = name.toLocaleLowerCase("tr-TR");
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

export function findWorkPark(parks, parkId) {
  return normalizeWorkParks(parks).find((p) => p.id === String(parkId || "")) || null;
}

export function validateOfficeTaskAssign(parkId) {
  if (!parkId) return "Parkur seçin.";
  return null;
}

export function officeTaskPayload(park, title) {
  return {
    park_id: park?.id || "",
    park_name: park?.name || "",
    title: String(title || "").trim() || park?.name || "İç görev",
  };
}
