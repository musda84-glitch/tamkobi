/** Reçete adımlarında aynı istasyonun peşi sıra işlenmesi. */

export const stationKey = (s) => String(s || "").trim().toLocaleLowerCase("tr");

/** Malzeme + genel adımları (iş emri sırasına yakın) düz liste. */
export function flattenRecipeStepsPreview(materials, generalSteps) {
  const out = [];
  for (const m of Array.isArray(materials) ? materials : []) {
    const steps = Array.isArray(m?.steps) ? m.steps : [];
    for (const st of steps) {
      const station = String(st?.station || "").trim();
      const name = String(st?.name || "").trim();
      if (!station && !name) continue;
      out.push({
        station: station || name,
        name: name || station,
        material_name: String(m?.product_name || "").trim() || null,
      });
    }
  }
  for (const st of Array.isArray(generalSteps) ? generalSteps : []) {
    const station = String(st?.station || "").trim();
    const name = String(st?.name || "").trim();
    if (!station && !name) continue;
    out.push({ station: station || name, name: name || station, material_name: null });
  }
  return out;
}

/**
 * Birden fazla kez geçen ama peşi sıra olmayan istasyon etiketleri.
 * (Örn. CNC → Delik → CNC → öner: CNC peşi sıra)
 */
export function splitSameStations(flatSteps) {
  const positions = new Map();
  (flatSteps || []).forEach((st, i) => {
    const key = stationKey(st.station);
    if (!key) return;
    if (!positions.has(key)) positions.set(key, { label: st.station, idxs: [] });
    positions.get(key).idxs.push(i);
  });
  const split = [];
  for (const { label, idxs } of positions.values()) {
    if (idxs.length < 2) continue;
    const consecutive = idxs.every((v, i) => i === 0 || v === idxs[i - 1] + 1);
    if (!consecutive) split.push(label);
  }
  return split;
}

/** İlk görülen istasyon sırasını koruyarak aynı istasyonları grupla. */
export function groupStepsByStation(steps) {
  const buckets = [];
  const indexByKey = new Map();
  const noStation = [];
  for (const st of steps || []) {
    const key = stationKey(st.station);
    if (!key) {
      noStation.push(st);
      continue;
    }
    if (!indexByKey.has(key)) {
      indexByKey.set(key, buckets.length);
      buckets.push([]);
    }
    buckets[indexByKey.get(key)].push(st);
  }
  const out = [];
  for (const g of buckets) out.push(...g);
  out.push(...noStation);
  return out.map((st, i) => ({ ...st, no: i + 1 }));
}

export function sameStationOrderHint(materials, generalSteps, groupEnabled) {
  if (groupEnabled) return null;
  const flat = flattenRecipeStepsPreview(materials, generalSteps);
  const split = splitSameStations(flat);
  if (!split.length) return null;
  return {
    stations: split,
    message: `${split.join(", ")} istasyonu birden fazla adımda var ama peşi sıra değil. Atölyede peşi sıra işlemek için sıralamayı açın.`,
  };
}
