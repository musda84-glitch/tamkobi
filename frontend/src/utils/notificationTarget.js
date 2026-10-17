/** Bildirim tıklanınca gidilecek hedef. API target varsa onu kullanır; eski kayıtta metinden tahmin eder. */

export const MISSING_RECORD = "Kayıt bulunamadı";

const ETTN_RE = /ETTN\s+([0-9A-Fa-f-]{8,})/i;
const ACCOUNT_RE = /^([^:\n]{2,80}?):\s+\d+\s+yeni hareket/i;
const ORDER_NO_RE = /\b([A-Z]{1,8}-\d{4}-\d{3,})\b/;

const REF_KIND = {
  order: "order",
  order_batch: "order",
  invoice: "invoice",
  contact: "contact",
  cari: "contact",
  payment: "payment",
  expense: "payment",
  task: "task",
  quote: "quote",
  project: "project",
  survey: "survey",
  edoc: "edoc",
  edoc_batch: "edoc",
  bank: "bank_account",
  bank_tx: "bank_tx",
  bank_account: "bank_account",
  cash_approval: "cash_approval",
  pos_approval: "pos_approval",
  leave_request: "leave_request",
  advance_request: "advance_request",
  overtime_request: "overtime_request",
  employee: "employee",
  cheque: "cheque",
  support: "support",
  work_order: "work_order",
  license: "license",
};

const TYPE_KIND = {
  bank_sync: "bank_account",
  einvoice_incoming: "edoc",
  b2b_order: "order",
  order_new: "order",
  order_pick_missing: "order",
  order_pick_production: "order",
  quote_response: "quote",
  task_assigned: "task",
  cash_approval: "cash_approval",
  pos_approval: "pos_approval",
  leave_request: "leave_request",
  advance_request: "advance_request",
  overtime_confirm: "overtime_request",
  yevmiye_adjustment: "overtime_request",
  overtime_request: "overtime_request",
  receivable_overdue: "invoice",
  project_photo_pending: "project",
  role_assigned: "employee",
  license: "license",
};

function queryOf(link) {
  const raw = String(link || "");
  const q = raw.includes("?") ? raw.slice(raw.indexOf("?") + 1) : "";
  const out = {};
  if (!q) return out;
  for (const part of q.split("&")) {
    const [k, v = ""] = part.split("=");
    if (k) out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, " "));
  }
  return out;
}

function enc(params) {
  const usp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v) !== "") usp.set(k, String(v));
  });
  const s = usp.toString();
  return s ? `?${s}` : "";
}

function accountNameOf(message) {
  const text = String(message || "").trim();
  const match = text.match(ACCOUNT_RE);
  if (match) return match[1].trim();
  if (text && !text.includes("₺") && text.length <= 80 && !text.includes("\n") && !/^ettn/i.test(text)) {
    if (!text.includes(":") && !/\d+\s+yeni/i.test(text)) return text.replace(/^\s+|\s+$/g, "").replace(/\.+$/, "");
  }
  return "";
}

function kindOf(note, link) {
  const ref = String(note?.ref_type || "").toLowerCase();
  if (REF_KIND[ref]) return REF_KIND[ref];
  const typed = TYPE_KIND[String(note?.type || "")];
  if (typed) return typed;
  const path = String(link || "").split("?")[0];
  if ((path === "/personnel" || path.startsWith("/personnel/")) && queryOf(link).tab) return "";
  const table = [
    ["/edoc-inbox", "edoc"],
    ["/orders", "order"],
    ["/invoices", "invoice"],
    ["/contacts", "contact"],
    ["/expenses", "payment"],
    ["/quotes", "quote"],
    ["/projects", "project"],
    ["/surveys", "survey"],
    ["/cheques", "cheque"],
    ["/personelim", "task"],
    ["/personnel", "employee"],
    ["/banking", "bank_account"],
    ["/hizli-satis", "pos_approval"],
    ["/support", "support"],
    ["/hesap", "license"],
  ];
  const hit = table.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`));
  return hit ? hit[1] : "";
}

function personnelRoute(query, defaultTab, key, rid) {
  const params = { tab: query.tab || defaultTab };
  const ident = query[key] || rid || "";
  if (ident) params[key] = ident;
  return `/personnel${enc(params)}`;
}

function finishRoute(kind, route, id) {
  const query = queryOf(route);
  if (kind === "cash_approval") {
    const approval = query.approval || id;
    if (!approval) return route || "/banking";
    if (query.approval) return route;
    const params = {};
    if (query.tab) params.tab = query.tab;
    params.approval = approval;
    return `/banking${enc(params)}`;
  }
  if (kind === "pos_approval") {
    const onay = query.onay || id;
    return onay ? `/hizli-satis?onay=${encodeURIComponent(onay)}` : (route || "/hizli-satis");
  }
  if (kind === "leave_request") return personnelRoute(query, "leaves", "leave", id);
  if (kind === "advance_request") return personnelRoute(query, "payroll", "advance", id);
  if (kind === "overtime_request") return personnelRoute(query, "attendance", "overtime", id);
  return route || "";
}

export function notificationTarget(note) {
  const stored = note?.target;
  if (stored && stored.type && stored.route) {
    const type = String(stored.type);
    const id = String(stored.id || note?.ref_id || queryOf(stored.route).approval || queryOf(stored.route).onay || queryOf(stored.route).leave || queryOf(stored.route).advance || queryOf(stored.route).overtime || "");
    return { type, id, route: finishRoute(type, String(stored.route), id) };
  }
  const link = String(note?.link || "");
  const query = queryOf(link);
  const kind = kindOf(note, link);
  const text = `${note?.title || ""}\n${note?.message || ""}`;
  const ettn = String(note?.ettn || query.ettn || (text.match(ETTN_RE) || [])[1] || "").replace(/-+$/, "");
  let account = String(note?.account_name || query.account || "");
  if ((kind === "bank_account" || kind === "bank_tx") && !account) account = accountNameOf(note?.message);
  let rid = String(note?.ref_id || query.id || query.open || query.edit || query.contact_id || query.focus || query.tx || "");
  if (kind === "bank_tx") rid = String(note?.tx_id || query.tx || note?.ref_id || "");
  else if (kind === "bank_account") {
    rid = String(note?.account_id || query.account_id || ((note?.ref_type === "bank" || note?.ref_type === "bank_account") ? note?.ref_id : "") || "");
  } else if (kind === "contact") rid = String(query.contact_id || note?.ref_id || "");
  else if (kind === "task") rid = String(query.task || note?.ref_id || "");
  else if (kind === "cash_approval") rid = String(query.approval || note?.ref_id || "");
  else if (kind === "pos_approval") rid = String(query.onay || note?.ref_id || "");
  else if (kind === "leave_request") rid = String(query.leave || note?.ref_id || "");
  else if (kind === "advance_request") rid = String(query.advance || note?.ref_id || "");
  else if (kind === "overtime_request") rid = String(query.overtime || note?.ref_id || "");
  const blob = `${link} ${note?.message || ""}`.toLowerCase();
  const pending = note?.pending === true || blob.includes("tab=match") || blob.includes("eşleşme bekliyor") || query.pending === "1";
  if (kind === "order" && !rid) {
    const numbered = text.match(ORDER_NO_RE);
    if (numbered) return { type: "order", id: "", route: `/orders?q=${numbered[1]}` };
  }
  let route = link;
  if (kind === "order") route = rid ? `/orders?open=${rid}` : (link || "/orders");
  else if (kind === "invoice") route = rid ? `/invoices?open=${rid}` : (link || "/invoices");
  else if (kind === "contact") route = rid ? `/contacts?contact_id=${rid}` : (link || "/contacts");
  else if (kind === "payment") route = rid ? `/expenses?open=${rid}` : (link || "/expenses");
  else if (kind === "task") {
    route = (!rid && !note?.project_id) ? (link || "/personelim?tab=gorevler") : `/personelim${enc({ tab: "gorevler", task: rid, project: note?.project_id || query.project })}`;
  } else if (kind === "quote") route = rid ? `/quotes?focus=${rid}` : (link || "/quotes");
  else if (kind === "project") route = rid ? `/projects?focus=${rid}` : (link || "/projects");
  else if (kind === "survey") route = rid ? `/surveys?focus=${rid}` : (link || "/surveys");
  else if (kind === "edoc") route = (ettn || rid) ? `/edoc-inbox${enc({ ettn, id: rid })}` : (link || "/edoc-inbox");
  else if (kind === "bank_tx" || kind === "bank_account") {
    const params = {};
    if (pending) params.pending = "1";
    const accId = kind === "bank_account" ? rid : (note?.account_id || query.account_id || "");
    if (accId) params.account_id = accId;
    else if (account) params.account = account;
    const tx = kind === "bank_tx" ? rid : (note?.tx_id || query.tx || "");
    if (tx) params.tx = tx;
    route = Object.keys(params).length ? `/banking${enc(params)}` : (link || "/banking");
  } else if (kind === "employee") route = rid ? `/personnel?employee=${rid}` : (link || "/personnel");
  else if (kind === "cheque") route = rid ? `/cheques?open=${rid}` : (link || "/cheques");
  else if (kind === "pos_approval") route = finishRoute(kind, link, rid);
  else if (kind === "cash_approval") route = finishRoute(kind, link, rid);
  else if (kind === "leave_request" || kind === "advance_request" || kind === "overtime_request") route = finishRoute(kind, link, rid);
  else if (kind === "license") route = link || "/hesap";
  return { type: kind, id: rid, route: route || "" };
}
