/** Personel kartı / bordro / talep satırından çalışan kimliği. employee_id öncelikli. */
export const empIdOf = (e) => String(e?.employee_id || e?.id || e?._id || "");
