export const VEHICLE_STATUSES = [
  { value: "active", label: "Aktif" },
  { value: "inactive", label: "Pasif" },
  { value: "maintenance", label: "Bakımda" },
] as const;

export type VehicleStatus = (typeof VEHICLE_STATUSES)[number]["value"];

export type Vehicle = {
  id?: string;
  _id?: string;
  plate?: string;
  brand?: string;
  model?: string;
  year?: number | null;
  color?: string;
  status?: string;
  notes?: string;
  company_id?: string;
};

export type VehicleDraft = {
  plate: string;
  brand: string;
  model: string;
  year: string;
  color: string;
  status: string;
  notes: string;
};

export function emptyVehicleDraft(): VehicleDraft {
  return { plate: "", brand: "", model: "", year: "", color: "", status: "active", notes: "" };
}

export function draftFromVehicle(row: Vehicle): VehicleDraft {
  return {
    plate: row.plate || "",
    brand: row.brand || "",
    model: row.model || "",
    year: row.year != null && row.year !== undefined ? String(row.year) : "",
    color: row.color || "",
    status: row.status || "active",
    notes: row.notes || "",
  };
}

export function vehiclePayload(draft: VehicleDraft, companyId: string) {
  const yearRaw = String(draft.year || "").trim();
  return {
    company_id: companyId,
    plate: String(draft.plate || "").trim(),
    brand: String(draft.brand || "").trim(),
    model: String(draft.model || "").trim(),
    color: String(draft.color || "").trim(),
    notes: String(draft.notes || "").trim(),
    status: draft.status || "active",
    year: yearRaw === "" ? null : Number(yearRaw),
  };
}

export function validateVehicleDraft(draft: VehicleDraft): string | null {
  if (!String(draft.plate || "").trim()) return "Plaka zorunlu.";
  const yearRaw = String(draft.year || "").trim();
  if (yearRaw) {
    const y = Number(yearRaw);
    if (!Number.isFinite(y) || y < 1950 || y > 2100) return "Model yılı 1950–2100 arasında olmalı.";
  }
  return null;
}

export function vehicleTitle(row: Pick<Vehicle, "plate" | "brand" | "model">): string {
  const plate = row.plate || "Araç";
  const brand = [row.brand, row.model].filter(Boolean).join(" ");
  return brand ? `${plate} · ${brand}` : plate;
}

export function vehicleStatusLabel(status?: string): string {
  return VEHICLE_STATUSES.find((s) => s.value === status)?.label || status || "—";
}

export function filterVehicles(rows: Vehicle[] = [], status = "all", q = ""): Vehicle[] {
  const needle = String(q || "").trim().toLowerCase();
  return (rows || []).filter((r) => {
    if (status && status !== "all" && String(r.status || "") !== status) return false;
    if (!needle) return true;
    return [r.plate, r.brand, r.model, r.color, r.notes, r.year]
      .some((v) => String(v || "").toLowerCase().includes(needle));
  });
}
