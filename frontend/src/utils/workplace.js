export function workplaceDays(w) {
  const n = Math.trunc(Number(w?.duration_days) || 0);
  return n > 0 ? n : 0;
}

export function workplaceHasCoords(w) {
  if (!w) return false;
  if (w.has_coords === false) return false;
  if (w.has_coords === true) return true;
  const lat = Number(w.latitude);
  const lng = Number(w.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
}

/** Firma konumu kaydını Workplace şekline çevir (giriş OR hedefi). */
export function companyLocationAsWorkplace(loc) {
  if (!loc) return null;
  const lat = Number(loc.latitude);
  const lng = Number(loc.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  return {
    kind: "company",
    label: loc.label || "Firma",
    latitude: lat,
    longitude: lng,
    radius_m: Number(loc.radius_m) || 300,
    has_coords: true,
  };
}

/** Giriş için en az bir geçerli hedef var mı: görev yeri veya firma. */
export function checkInHasGeoTarget({ workplace, location, companyLocation } = {}) {
  return (
    workplaceHasCoords(workplace) ||
    workplaceHasCoords(location) ||
    workplaceHasCoords(companyLocationAsWorkplace(companyLocation))
  );
}

/** Mesaim kartı: konumlu giriş politikası (görev veya firma koordinatı + require_geo). */
export function mesaimGeoInOn({ workplace, companyLocation, requireGeo } = {}) {
  const has = workplaceHasCoords(workplace) || workplaceHasCoords(companyLocationAsWorkplace(companyLocation));
  if (!has) return false;
  return requireGeo !== false;
}

export function mesaimGeoInLabel(opts = {}) {
  return mesaimGeoInOn(opts) ? "Konumlu giriş açık" : "Konumlu giriş kapalı";
}

/** Üst bar için kısa konum satırı (Mesaim header). */
export function mesaimGeoHeaderLine(opts = {}) {
  const placeWp = opts.workplace || null;
  const on = mesaimGeoInOn({
    workplace: placeWp,
    companyLocation: opts.companyLocation,
    requireGeo: opts.requireGeo,
  });
  const status = on ? "Giriş açık" : "Giriş kapalı";
  if (placeWp?.kind === "task") {
    const short = workplaceShort(placeWp) || placeWp.task_title || "Dış görev";
    return { title: "Mesaim", place: short, status, on };
  }
  const radius = placeWp?.radius_m || opts.location?.radius_m || Number(opts.companyLocation?.radius_m) || undefined;
  const place = radius ? `Firma · ${radius} m` : "Firma konumu";
  return { title: "Mesaim", place, status, on };
}

export function workplaceHint(w, requireGeo = true) {
  if (!w) return "İş yeri konumu tanımsız — konumsuz giriş";
  const place = [w.task_title, w.project_name || w.label].filter(Boolean).join(" · ");
  const days = workplaceDays(w);
  const daysPart = days ? ` · ${days} gün` : "";
  if (w.kind === "task") {
    if (w.has_coords) {
      const radius = w.radius_m || 300;
      return `Dış görev: ${place}${daysPart} · giriş firma veya görev yeri${requireGeo ? ` · ${radius} m` : ""}`;
    }
    return `Dış görev: ${place}${daysPart} · görev konumu yok — firma yerinde giriş mümkün`;
  }
  const radius = w.radius_m ? ` · ${w.radius_m} m` : "";
  return `Firma konumu${radius}${requireGeo ? " (yalnızca girişte)" : ""}`;
}

export function workplaceShort(w) {
  if (!w || w.kind !== "task") return "";
  const title = w.task_title || "Görev";
  const proj = w.project_number || w.project_name || "";
  const days = workplaceDays(w);
  const base = proj ? `${title} · ${proj}` : title;
  return days ? `${base} · ${days} gün` : base;
}
