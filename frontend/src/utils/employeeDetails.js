/** Personel kartı Ayrıntılar — medeni durum / kan grubu seçenekleri. */

export const MARITAL_STATUS_OPTIONS = [
  { value: "", label: "—" },
  { value: "single", label: "Bekar" },
  { value: "married", label: "Evli" },
  { value: "divorced", label: "Boşanmış" },
  { value: "widowed", label: "Dul" },
];

export const BLOOD_TYPE_OPTIONS = [
  { value: "", label: "—" },
  { value: "0+", label: "0 Rh+" },
  { value: "0-", label: "0 Rh-" },
  { value: "A+", label: "A Rh+" },
  { value: "A-", label: "A Rh-" },
  { value: "B+", label: "B Rh+" },
  { value: "B-", label: "B Rh-" },
  { value: "AB+", label: "AB Rh+" },
  { value: "AB-", label: "AB Rh-" },
];

const MARITAL_LABELS = Object.fromEntries(MARITAL_STATUS_OPTIONS.filter((o) => o.value).map((o) => [o.value, o.label]));

export function maritalStatusLabel(value) {
  const v = String(value || "").trim();
  return MARITAL_LABELS[v] || v || "";
}

export function hasExtraEmployeeDetails(emp) {
  return Boolean(
    String(emp?.marital_status || "").trim()
    || String(emp?.blood_type || "").trim()
    || String(emp?.illnesses || "").trim()
    || String(emp?.safety_info || "").trim()
  );
}
