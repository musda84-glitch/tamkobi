/** Kayıt yanıtındaki masraf satırını liste süzgecine göre yerleştirir.

Sunucu listesi satırı henüz görmüyorsa (eski anlık görüntü) yanıt satırı kalır.
Sunucu aynı veya daha yeni damgayı dönünce onun satırı kullanılır.
*/

function rowId(row) {
  if (!row) return "";
  const id = row.id || row._id;
  return id ? String(id) : "";
}

function stamp(row) {
  return String(row?.updated_at || row?.created_at || "");
}

export function expenseMatchesList(row, filters = {}) {
  if (!row || typeof row !== "object") return false;
  const category = filters.category || "all";
  const status = filters.status || "all";
  if (category !== "all" && String(row.category || "") !== category) return false;
  if (status !== "all" && String(row.payment_status || "") !== status) return false;
  const day = String(row.date || "").slice(0, 10);
  if (filters.from && (!day || day < filters.from)) return false;
  if (filters.to && (!day || day > filters.to)) return false;
  const q = String(filters.q || "").trim();
  if (q) {
    const needle = q.toLocaleLowerCase("tr");
    const hay = [
      row.description,
      row.expense_number,
      row.contact_name,
      row.notes,
      row.account_name,
      row.created_by_name,
      row.paid_by_name,
    ].filter(Boolean).join(" ").toLocaleLowerCase("tr");
    if (!hay.includes(needle)) return false;
  }
  return true;
}

export function savedExpenseCaughtUp(serverExpenses, saved) {
  const id = rowId(saved);
  if (!id) return true;
  const server = (serverExpenses || []).find((row) => rowId(row) === id);
  if (!server) return false;
  const savedStamp = stamp(saved);
  if (!savedStamp) return true;
  return stamp(server) >= savedStamp;
}

export function mergeSavedExpense(expenses, saved, filters) {
  const list = Array.isArray(expenses) ? expenses.slice() : [];
  const id = rowId(saved);
  if (!id) return list;
  if (savedExpenseCaughtUp(list, saved)) return list;
  if (!expenseMatchesList(saved, filters)) {
    return list.filter((row) => rowId(row) !== id);
  }
  const rest = list.filter((row) => rowId(row) !== id);
  return [{ ...saved, id }, ...rest];
}
