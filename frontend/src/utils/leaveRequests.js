export const LEAVE_TYPES = {
  annual: "Yıllık İzin",
  sick: "Hastalık",
  unpaid: "Ücretsiz",
  other: "Diğer",
};

export const LEAVE_STATUS = {
  pending: { label: "Bekliyor", className: "bg-amber-50 text-amber-700" },
  approved: { label: "Onaylandı", className: "bg-emerald-50 text-emerald-700" },
  rejected: { label: "Reddedildi", className: "bg-rose-50 text-rose-700" },
  cancelled: { label: "İptal edildi", className: "bg-slate-100 text-slate-600" },
};

export function leaveStatusView(status) {
  return LEAVE_STATUS[status] || { label: status || "Bekliyor", className: "bg-slate-100 text-slate-600" };
}

/** Satır aksiyonları: bekleyende onay/red + iptal/sil; onaylıda iptal/sil; diğerlerinde sil. */
export function leaveRowActions(status) {
  const s = status || "pending";
  return {
    approve: s === "pending",
    reject: s === "pending",
    cancel: s === "pending" || s === "approved",
    remove: true,
  };
}
