import {
  ArrowLeftRight,
  Banknote,
  CreditCard,
  FileSpreadsheet,
  Nfc,
  Pencil,
  RefreshCw,
  ScrollText,
} from "lucide-react";

const TYPE_ALIAS = { cash: "cash_box", kasa: "cash_box", cashbox: "cash_box", nakit: "cash_box", cash_box: "cash_box" };
const normalizeType = (t) => TYPE_ALIAS[String(t || "").toLowerCase()] || t;
const collectableOnly = (accounts) => (accounts || []).filter((a) => normalizeType(a.type) !== "credit_card");

/** Her menü maddesi kendi işlem ekranına gider (tek karışık form yok). */
export const CONTACT_PAY_MENU_SECTIONS = [
  {
    id: "instruments",
    items: [
      { id: "cash", label: "Nakit - Kredi Kartı - Banka", icon: Banknote, iconClass: "text-emerald-600", preset: { menuId: "cash", method: "cash" } },
      { id: "contactless", label: "Temassız Kredi Kartı", icon: Nfc, iconClass: "text-amber-700", preset: { menuId: "contactless", method: "cash", preferPos: true } },
      { id: "cheque", label: "Çek", icon: CreditCard, iconClass: "text-sky-600", preset: { menuId: "cheque", method: "cheque", type: "inflow" } },
      { id: "promissory_in", label: "Müşteriden Senet Al", icon: FileSpreadsheet, iconClass: "text-rose-600", preset: { menuId: "promissory_in", method: "promissory", type: "inflow" } },
      { id: "promissory_out", label: "Müşteriye Senet Ver", icon: ScrollText, iconClass: "text-amber-800", preset: { menuId: "promissory_out", method: "promissory", type: "outflow" } },
    ],
  },
  {
    id: "ledger",
    items: [
      { id: "balance_fix", label: "Bakiye düzelt", icon: Pencil, iconClass: "text-sky-600", preset: { menuId: "balance_fix", method: "ledger", balanceFix: true } },
      { id: "ledger_slips", label: "Borç-Alacak Fişleri", icon: ArrowLeftRight, iconClass: "text-sky-600", preset: { menuId: "ledger_slips", method: "ledger" } },
    ],
  },
  {
    id: "transfer",
    items: [
      { id: "virman", label: "Cari Virman", icon: RefreshCw, iconClass: "text-amber-800", badge: "yeni", action: "virman" },
    ],
  },
];

export const CONTACT_PAY_MENU_ITEMS = CONTACT_PAY_MENU_SECTIONS.flatMap((s) => s.items);

const POS_TYPES = new Set(["pos", "okc_pos"]);

const MENU_TITLES = {
  cash: "Nakit / Kredi Kartı / Banka",
  contactless: "Temassız Kredi Kartı",
  cheque: "Çek",
  promissory_in: "Müşteriden Senet Al",
  promissory_out: "Müşteriye Senet Ver",
  balance_fix: "Bakiye düzelt",
  ledger_slips: "Borç-Alacak Fişi",
};

/** Modal başlığı ve kilit bayrakları — menüden açılınca yalnızca o işlem alanı. */
export function contactPayModalMeta(formOrOpts = {}) {
  const menuId = formOrOpts.menuId || "";
  const methodFromMenu = {
    cash: "cash",
    contactless: "cash",
    cheque: "cheque",
    promissory_in: "promissory",
    promissory_out: "promissory",
    balance_fix: "ledger",
    ledger_slips: "ledger",
  };
  const method = formOrOpts.method || methodFromMenu[menuId] || "cash";
  const locked = !!menuId;
  return {
    menuId,
    title: MENU_TITLES[menuId] || (method === "ledger" ? "Borç-Alacak Fişi" : "Tahsilat / Ödeme"),
    lockMethod: locked,
    lockType: menuId === "promissory_in" || menuId === "promissory_out" || menuId === "balance_fix" || menuId === "contactless",
    lockSlip: menuId === "balance_fix",
    showTypeToggle: !locked || (menuId === "cash" || menuId === "cheque" || menuId === "ledger_slips"),
    showMethodTabs: !locked,
    showSlipToggle: method === "ledger" && menuId !== "balance_fix",
  };
}

export function pickPayAccount(accounts, { type = "inflow", preferPos = false } = {}) {
  const list = accounts || [];
  if (preferPos) {
    const pos = list.filter((a) => POS_TYPES.has(normalizeType(a.type)));
    if (pos.length) return pos[0]?.id || pos[0]?._id || "";
  }
  const pool = type === "inflow" ? collectableOnly(list) : list;
  return pool[0]?.id || pool[0]?._id || "";
}

export function buildContactPayForm(contact, accounts, opts = {}) {
  const balance = Number(contact?.balance) || 0;
  const defaultIn = balance >= 0;
  const menuId = opts.menuId || "";
  let type = opts.type || (defaultIn ? "inflow" : "outflow");
  if (menuId === "contactless") type = "inflow";
  if (menuId === "promissory_in") type = "inflow";
  if (menuId === "promissory_out") type = "outflow";
  const method = opts.method || "cash";
  const balanceFix = !!opts.balanceFix || menuId === "balance_fix";
  let amount = Math.max(0, balance).toFixed(2);
  let slip = opts.slip || "debit";
  let description =
    type === "inflow" ? "Cari tahsilat" : "Cari ödeme";

  if (method === "cheque") description = type === "inflow" ? "Alınan çek" : "Verilen çek";
  if (method === "promissory") description = type === "inflow" ? "Alınan senet" : "Verilen senet";
  if (method === "ledger") {
    description = slip === "credit" ? "Alacak fişi" : "Borç fişi";
  }
  if (balanceFix) {
    amount = Math.abs(balance).toFixed(2);
    // Artı bakiye (alacak) → alacak fişi ile düşür; eksi bakiye (borç) → borç fişi ile dengele.
    slip = balance >= 0 ? "credit" : "debit";
    description = "Bakiye düzeltme";
  }
  if (opts.preferPos || menuId === "contactless") {
    description = type === "inflow" ? "Temassız tahsilat" : "Temassız ödeme";
  }

  return {
    menuId,
    amount,
    account_id: pickPayAccount(accounts, { type, preferPos: !!opts.preferPos || menuId === "contactless" }),
    description: opts.description || description,
    type,
    method,
    instrument: method === "promissory" ? "promissory" : "cheque",
    due_date: new Date().toISOString().slice(0, 10),
    serial_no: "",
    bank_name: "",
    slip,
    preferPos: !!opts.preferPos || menuId === "contactless",
    balanceFix,
  };
}
