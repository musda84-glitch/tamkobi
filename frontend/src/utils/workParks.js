export function normalizeNamedList(raw, prefix = "item") {
  const rows = Array.isArray(raw) ? raw : [];
  const used = new Set();
  const out = [];
  rows.forEach((row, i) => {
    const name = String(typeof row === "string" ? row : (row?.name || row?.label || "")).trim();
    if (!name) return;
    let id = String((typeof row === "object" && (row.id || row.key)) || "").trim();
    if (!id || used.has(id)) id = `${prefix}_${i}`;
    used.add(id);
    out.push({ id, name: name.slice(0, 80) });
  });
  return out.slice(0, 40);
}

export function normalizeWorkParks(raw) {
  return normalizeNamedList(raw, "park");
}

export function normalizeOfficeTaskTypes(raw) {
  return normalizeNamedList(raw, "ot");
}

export function parkSelectGroups(parks) {
  const rows = normalizeWorkParks(parks);
  if (!rows.length) return [];
  return [{ label: "Parkurlar", options: rows.map((p) => ({ value: p.id, label: p.name })) }];
}

export function officeTaskTypeSelectGroups(types) {
  const rows = normalizeOfficeTaskTypes(types);
  if (!rows.length) return [];
  return [{ label: "İç görevler", options: rows.map((t) => ({ value: t.id, label: t.name })) }];
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

export function findOfficeTaskType(types, typeId) {
  return normalizeOfficeTaskTypes(types).find((t) => t.id === String(typeId || "")) || null;
}

/** @deprecated parkId → task_type_id; geriye uyumluluk */
export function validateOfficeTaskAssign(taskTypeId) {
  if (!taskTypeId) return "İç görev seçin.";
  return null;
}

export function officeTaskPayload(taskType, title, park) {
  const type = taskType || {};
  return {
    task_type_id: type.id || "",
    task_type_name: type.name || "",
    park_id: park?.id || type.id || "",
    park_name: park?.name || type.name || "",
    title: String(title || "").trim() || type.name || "İç görev",
  };
}
