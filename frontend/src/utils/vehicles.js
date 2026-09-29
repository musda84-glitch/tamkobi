export const VEHICLE_STATUSES = [
  { value: "active", label: "Aktif" },
  { value: "inactive", label: "Pasif" },
  { value: "maintenance", label: "Bakımda" },
];

export function emptyVehicleForm() {
  return {
    plate: "",
    brand: "",
    model: "",
    year: "",
    color: "",
    status: "active",
    notes: "",
  };
}

export function vehicleFromRow(row = {}) {
  return {
    id: row.id || row._id || "",
    plate: row.plate || "",
    brand: row.brand || "",
    model: row.model || "",
    year: row.year != null && row.year !== "" ? String(row.year) : "",
    color: row.color || "",
    status: row.status || "active",
    notes: row.notes || "",
  };
}

export function vehiclePayload(form, companyId) {
  const yearRaw = String(form.year || "").trim();
  return {
    company_id: companyId,
    plate: String(form.plate || "").trim(),
    brand: String(form.brand || "").trim(),
    model: String(form.model || "").trim(),
    color: String(form.color || "").trim(),
    notes: String(form.notes || "").trim(),
    status: form.status || "active",
    year: yearRaw === "" ? null : Number(yearRaw),
  };
}

export function validateVehicleForm(form = {}) {
  if (!String(form.plate || "").trim()) return "Plaka zorunlu.";
  const yearRaw = String(form.year || "").trim();
  if (yearRaw) {
    const y = Number(yearRaw);
    if (!Number.isFinite(y) || y < 1950 || y > 2100) return "Model yılı 1950–2100 arasında olmalı.";
  }
  return null;
}

export function vehicleTitle(row = {}) {
  const plate = row.plate || "Araç";
  const brand = [row.brand, row.model].filter(Boolean).join(" ");
  return brand ? `${plate} · ${brand}` : plate;
}

export function vehicleStatusLabel(status) {
  return VEHICLE_STATUSES.find((s) => s.value === status)?.label || status || "—";
}

export function filterVehicles(rows = [], { status = "all", q = "" } = {}) {
  const needle = String(q || "").trim().toLowerCase();
  return (rows || []).filter((r) => {
    if (status && status !== "all" && String(r.status || "") !== status) return false;
    if (!needle) return true;
    return [r.plate, r.brand, r.model, r.color, r.notes, r.year]
      .some((v) => String(v || "").toLowerCase().includes(needle));
  });
}
