/** Hızlı Satış kasiyer kilidi, çıkış ve onay kapısı — sunucu kurallarıyla aynı semantik. */

export const POS_KIND_LABELS = {
  delete_line: "Satır silme",
  cancel_cart: "Sepet iptali",
  cancel_sale: "Satış iptali",
  refund: "İade",
  price_change: "Fiyat değiştirme",
  discount: "Limit üstü iskonto",
  out_of_stock: "Stoksuz satış",
  open_drawer: "Satışsız çekmece",
  exit: "Hızlı Satış çıkışı",
};

export const RESTRICTED_POS_RULES = {
  can_change_price: false,
  max_discount_pct: 0,
  can_refund: false,
  can_cancel: false,
  can_credit_sale: false,
  can_exit: false,
  can_delete_line: false,
  can_out_of_stock: false,
  can_open_drawer: false,
  can_approve: false,
};

export const OPEN_POS_RULES = {
  can_change_price: true,
  max_discount_pct: 100,
  can_refund: true,
  can_cancel: true,
  can_credit_sale: true,
  can_exit: true,
  can_delete_line: true,
  can_out_of_stock: true,
  can_open_drawer: true,
  can_approve: true,
};

export function defaultPosRules(roleCode) {
  const code = String(roleCode || "").toLowerCase();
  if (code === "admin" || code === "manager") return { ...OPEN_POS_RULES };
  return { ...RESTRICTED_POS_RULES };
}

export function normalizePin(value) {
  const s = String(value || "").replace(/\D/g, "");
  return s.slice(0, 6);
}

export function pinIsValid(value) {
  return /^\d{4,6}$/.test(String(value || "").trim());
}

export function sessionIsIdle(session, nowMs = Date.now(), timeoutSec = 120) {
  if (!session) return true;
  if (session.locked) return true;
  const raw = session.last_activity || session.created_at;
  const t = Date.parse(String(raw || ""));
  if (!Number.isFinite(t)) return true;
  return (nowMs - t) / 1000 >= Math.max(1, Number(timeoutSec) || 120);
}

export function exitIsBlocked(session, rules) {
  if (!session || !session.cashier_user_id) return false;
  if (session.exit_granted) return false;
  const r = rules || session.rules || {};
  return !r.can_exit;
}

/** Sayfa yenileme kilit veya çıkış kısıtını atlatamaz. */
export function refreshKeepsLock(session, timeoutSec = 120, nowMs = Date.now()) {
  if (!session || !session.cashier_user_id) return false;
  if (session.ended_at) return false;
  if (session.locked || sessionIsIdle(session, nowMs, timeoutSec)) return true;
  return exitIsBlocked(session);
}

/** ERP'nin başka bir rotasına gidince /hizli-satis'e geri bas. */
export function shouldBounceToPos(session, pathname) {
  if (!exitIsBlocked(session)) return false;
  const path = String(pathname || "");
  if (path === "/hizli-satis" || path.startsWith("/hizli-satis?")) return false;
  return true;
}

export function lineDiscountPct(catalogPrice, unitPrice) {
  const cat = Number(catalogPrice) || 0;
  if (cat <= 0) return 0;
  return Math.max(0, Math.round((1 - (Number(unitPrice) || 0) / cat) * 10000) / 100);
}

export function priceChangeNeedsApproval(rules, catalogPrice, unitPrice) {
  const cat = Number(catalogPrice) || 0;
  const price = Number(unitPrice) || 0;
  if (Math.abs(price - cat) < 0.0001) return false;
  if (price < cat) {
    const pct = lineDiscountPct(cat, price);
    return pct - 0.0001 > Number(rules?.max_discount_pct || 0);
  }
  return !rules?.can_change_price;
}

export function actionIsFree(rules, kind, extra = {}) {
  const r = rules || RESTRICTED_POS_RULES;
  if (kind === "delete_line") return !!(r.can_delete_line || r.can_cancel);
  if (kind === "cancel_cart" || kind === "cancel_sale") return !!r.can_cancel;
  if (kind === "refund") return !!r.can_refund;
  if (kind === "price_change") return !priceChangeNeedsApproval(r, extra.catalog_price, extra.unit_price);
  if (kind === "discount") return Number(extra.discount_pct || 0) - 0.0001 <= Number(r.max_discount_pct || 0);
  if (kind === "out_of_stock") return !!r.can_out_of_stock;
  if (kind === "open_drawer") return !!r.can_open_drawer;
  if (kind === "exit") return !!r.can_exit;
  if (kind === "credit_sale") return !!r.can_credit_sale;
  return false;
}

export function mixedChange(grand, cashAmount, cardAmount, tenderedCash) {
  const g = Math.round((Number(grand) || 0) * 100) / 100;
  let cash = Math.round((Number(cashAmount) || 0) * 100) / 100;
  let card = Math.round((Number(cardAmount) || 0) * 100) / 100;
  const tend = Math.round((Number(tenderedCash) || 0) * 100) / 100;
  if (cash <= 0 && card <= 0) cash = g;
  if (Math.abs(cash + card - g) > 0.05 && card === 0) {
    card = Math.round(Math.max(0, g - cash) * 100) / 100;
    cash = Math.round((g - card) * 100) / 100;
  }
  const change = tend > 0 ? Math.round(Math.max(0, tend - cash) * 100) / 100 : 0;
  return { cash, card, change };
}

export function restoreCartOnReject(snapshot, current) {
  if (snapshot && Array.isArray(snapshot.items)) {
    return {
      items: snapshot.items.map((x) => ({ ...x })),
      customerName: snapshot.customer_name || snapshot.customerName || "Perakende Müşteri",
    };
  }
  return current;
}

export function terminalIdFromStorage(storage = typeof localStorage !== "undefined" ? localStorage : null) {
  try {
    let id = storage?.getItem("pos_terminal_id");
    if (id) return id;
    id = `term_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    storage?.setItem("pos_terminal_id", id);
    return id;
  } catch {
    return `term_${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function isPendingApproval(data) {
  return data?.status === "pending_approval" || data?.status === "pending";
}
