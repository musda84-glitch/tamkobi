/** Trendyol / pazaryeri iade talebi durumları ve aksiyon kuralları. */

export const CLAIM_STATUS_TR = {
  Created: "Yeni Talep",
  WaitingInAction: "Kargo Ulaştı",
  Accepted: "Kabul Edildi",
  Rejected: "Reddedildi",
  Cancelled: "İptal",
  Unresolved: "Çözümsüz",
  InAnalysis: "İncelemede",
};

export function claimStatusLabel(status) {
  return CLAIM_STATUS_TR[status] || status || "—";
}

export function claimStatusClass(status) {
  if (status === "Accepted") return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (status === "Rejected" || status === "Cancelled") return "bg-rose-100 text-rose-700 border-rose-200";
  if (status === "WaitingInAction") return "bg-sky-100 text-sky-800 border-sky-200";
  if (status === "InAnalysis" || status === "Unresolved") return "bg-violet-100 text-violet-800 border-violet-200";
  return "bg-amber-100 text-amber-800 border-amber-200";
}

/** Depoya ulaşmış iade — onay/red + gider pusulası adayı. */
export function claimCargoArrived(claim) {
  if (!claim) return false;
  if (claim.cargo_arrived) return true;
  if (claim.status === "WaitingInAction") return true;
  return (claim.items || []).some((it) => it.status === "WaitingInAction");
}

export function claimCanApprove(claim) {
  if (!claim) return false;
  if (claim.can_approve != null) return !!claim.can_approve;
  if (["Accepted", "Rejected", "Cancelled"].includes(claim.status)) return false;
  return claimCargoArrived(claim);
}

export function claimCanReject(claim) {
  if (!claim) return false;
  if (claim.can_reject != null) return !!claim.can_reject;
  return claimCanApprove(claim);
}

export function claimCanExpenseSlip(claim) {
  if (!claim) return false;
  if (claim.expense_slip_id || claim.expense_slip_number) return false;
  if (claim.can_expense_slip != null) return !!claim.can_expense_slip;
  const arrived = claimCargoArrived(claim) || claim.status === "Accepted";
  return arrived && !!claim.invoice_id;
}
