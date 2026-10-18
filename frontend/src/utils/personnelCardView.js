import { assignedOvertimeCellCaption } from "./employeeCardStatus";
import { empIdOf } from "./personnelIds";
import { employeePresenceChip, remainingDue } from "./personnelCard";

const BALANCE_EPS = 0.004;

/**
 * emp.balance.remaining = hak edilen − ödenen.
 * Pozitif: şirket personele borçlu. Negatif: personel şirkete borçlu.
 */
export function balanceView(balance) {
  const remaining = remainingDue(balance);
  if (remaining > BALANCE_EPS) {
    return { amount: remaining, tone: "pay", label: "Ödenecek" };
  }
  if (remaining < -BALANCE_EPS) {
    return { amount: Math.abs(remaining), tone: "owes", label: "Personel borçlu" };
  }
  return { amount: 0, tone: "zero", label: "Bakiye yok" };
}

/** Ekip bandındaki net bakiye etiketi — işaret balanceView tonundan gelir. */
export function teamNetView(netRemaining) {
  const view = balanceView({ remaining: netRemaining });
  if (view.tone === "pay") return { ...view, label: "Toplam ödenecek" };
  if (view.tone === "owes") return { ...view, label: "Personel borçlu (toplam)" };
  return view;
}

export function presenceOpts(emp, today, now) {
  const opts = {
    status: emp?.status,
    workplace: emp?.workplace,
    location_last_inside: emp?.location_last_inside,
    location_last_ok: emp?.location_last_ok,
    location_inside_at: emp?.location_inside_at,
    today: today || undefined,
  };
  if (now) opts.now = now;
  return opts;
}

export function presenceChip(emp, today, now) {
  return employeePresenceChip(presenceOpts(emp, today, now));
}

/**
 * in: iş / görev yerinde.
 * overtime: presence chip fazla mesai, ya da atanmış fazla mesai (otOn) varken hâlâ yerinde.
 * out: mesai bitti veya yer bilgisi yok.
 */
export function presenceState(emp, today, now) {
  const chip = presenceChip(emp, today, now);
  const otOn = assignedOvertimeCellCaption(today) !== "--:--";
  if (chip?.key === "overtime") return "overtime";
  if ((chip?.key === "work" || chip?.key === "duty") && otOn) return "overtime";
  if (chip?.key === "work" || chip?.key === "duty") return "in";
  return "out";
}

function todayOf(emp, attToday) {
  if (!attToday) return undefined;
  return attToday[empIdOf(emp)];
}

export function teamSummary(employees, attToday) {
  const list = Array.isArray(employees) ? employees : [];
  let inCount = 0;
  let netRemaining = 0;
  for (const emp of list) {
    if (presenceState(emp, todayOf(emp, attToday)) !== "out") inCount += 1;
    netRemaining += remainingDue(emp?.balance);
  }
  return { inCount, total: list.length, netRemaining };
}

export function filterEmployees(list, chip, attToday) {
  const rows = Array.isArray(list) ? list : [];
  if (chip === "in") {
    return rows.filter((emp) => presenceState(emp, todayOf(emp, attToday)) !== "out");
  }
  if (chip === "balance") {
    return rows.filter((emp) => Math.abs(remainingDue(emp?.balance)) > BALANCE_EPS);
  }
  return rows.slice();
}

/** Bugün çalışılan süre. Alan yoksa hesaplama yok — "—". */
export function todayWorkLabel(today) {
  if (!today || typeof today !== "object") return "—";
  if (today.worked_minutes != null && today.worked_minutes !== "") {
    const n = Number(today.worked_minutes);
    if (Number.isFinite(n)) {
      const sign = n < 0 ? "-" : "";
      const abs = Math.abs(Math.round(n));
      const h = Math.floor(abs / 60);
      const m = abs % 60;
      if (h && m) return `${sign}${h} sa ${m} dk`;
      if (h) return `${sign}${h} sa`;
      return `${sign}${m} dk`;
    }
  }
  const raw = today.worked_hours != null && today.worked_hours !== "" ? today.worked_hours : today.hours;
  if (raw == null || raw === "") return "—";
  const n = Number(raw);
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString("tr-TR", { maximumFractionDigits: 2 })} sa`;
}
