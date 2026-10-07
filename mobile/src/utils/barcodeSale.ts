import { lineFromProduct } from "./documentLines";

export const RETAIL_CONTACT_NAME = "Perakende Müşteri";
export const RETAIL_CONTACT_TAX = "11111111111";

/** Barkod terminali satış satırı (KDV hariç birim fiyat). */
export function barcodeSaleLine(
  product?: {
    id?: string;
    _id?: string;
    name?: string;
    sku?: string;
    barcode?: string;
    sale_price?: number;
    vat_rate?: number;
    unit?: string;
    matched_variant?: {
      name?: string;
      price?: number;
      sale_price?: number;
      sku?: string;
      barcode?: string;
    } | null;
  } | null,
  quantity = 1,
) {
  const qty = Math.max(Number(quantity) || 1, 0.0001);
  const variant = product?.matched_variant || null;
  const unitPrice = Number(variant?.price ?? variant?.sale_price ?? product?.sale_price ?? 0) || 0;
  return lineFromProduct(
    {
      ...product,
      id: product?.id || product?._id,
      sale_price: unitPrice,
      name: variant ? `${product?.name} / ${variant.name}` : product?.name,
      sku: variant?.sku || product?.sku,
      barcode: variant?.barcode || product?.barcode,
    },
    { invoiceType: "sales", quantity: qty },
  );
}

export function barcodeSalePayload({
  companyId,
  contact,
  product,
  quantity,
  mode,
}: {
  companyId: string;
  contact: { id?: string; _id?: string; name?: string; tax_number_or_id?: string; tax_id?: string };
  product: Parameters<typeof barcodeSaleLine>[0];
  quantity: number;
  mode: "retail" | "account";
}) {
  const line = barcodeSaleLine(product, quantity);
  const isRetail = mode === "retail";
  return {
    company_id: companyId,
    invoice_type: "sales",
    e_type: "e_archive",
    status: "approved",
    gib_status: "Onaylandı",
    contact_id: contact.id || contact._id,
    contact_name: contact.name,
    contact_tax_id: contact.tax_number_or_id || contact.tax_id || "",
    issue_date: new Date().toISOString().slice(0, 10),
    due_date: new Date().toISOString().slice(0, 10),
    currency: "TRY",
    fx_rate: 1,
    price_mode: "excl",
    source_channel: isRetail ? "barcode_retail" : "barcode_account",
    notes: isRetail ? "Barkod terminali — perakende satış" : "Barkod terminali — cari satış",
    items: [
      {
        product_id: line.product_id,
        name: line.name || line.product_name,
        product_name: line.product_name || line.name,
        sku: line.sku || "",
        barcode: line.barcode || "",
        quantity: line.quantity,
        unit: line.unit || product?.unit || "Adet",
        unit_price: Number(Number(line.unit_price).toFixed(4)),
        unit_price_incl: line.unit_price_incl,
        vat_rate: line.vat_rate ?? 20,
        discount_rate: 0,
        total: line.total,
        total_incl: line.total_incl,
        vat_amount: line.vat_amount,
        is_service: !!line.is_service,
      },
    ],
    payment_status: isRetail ? "paid" : "unpaid",
    paid_amount: isRetail ? Number(line.total_incl || 0) : 0,
  };
}

export function pickCashAccount(accounts: Array<{
  type?: string;
  account_type?: string;
  account_name?: string;
  name?: string;
}> = []) {
  const rows = Array.isArray(accounts) ? accounts : [];
  return (
    rows.find((a) => ["cash", "cash_box", "kasa"].includes(String(a.type || a.account_type || "").toLowerCase()))
    || rows.find((a) => /kasa|nakit|cash/i.test(a.account_name || a.name || ""))
    || rows[0]
    || null
  );
}

export function findRetailContact(contacts: Array<{
  name?: string;
  tax_number_or_id?: string;
}> = []) {
  const rows = Array.isArray(contacts) ? contacts : [];
  return (
    rows.find((c) => String(c.tax_number_or_id || "") === RETAIL_CONTACT_TAX && /perakende/i.test(c.name || ""))
    || rows.find((c) => (c.name || "").trim().toLowerCase() === RETAIL_CONTACT_NAME.toLowerCase())
    || rows.find((c) => /perakende/i.test(c.name || "") && /m[uü]şteri/i.test(c.name || ""))
    || null
  );
}

export function retailContactCreatePayload(companyId: string) {
  return {
    company_id: companyId,
    type: "customer",
    name: RETAIL_CONTACT_NAME,
    tax_number_or_id: RETAIL_CONTACT_TAX,
    tax_office: "Perakende",
    category: "Perakende",
    kvkk_accepted: true,
    city: "İstanbul",
  };
}

/** Fatura formuna perakende (carisiz) cari uygula — satışta e-arşiv. */
export function invoiceFormPatchForRetail(
  contact?: { id?: string; _id?: string; name?: string; tax_number_or_id?: string; tax_id?: string } | null,
  formData: { e_type?: string; invoice_type?: string } = {},
) {
  const id = contact?.id || contact?._id || "";
  const lockedE = ["paper", "e_export", "e_dispatch"].includes(String(formData.e_type || ""));
  const eType = formData.invoice_type === "sales" && !lockedE ? "e_archive" : formData.e_type;
  return {
    contact_id: id,
    contact_name: contact?.name || RETAIL_CONTACT_NAME,
    contact_tax_id: contact?.tax_number_or_id || contact?.tax_id || RETAIL_CONTACT_TAX,
    e_type: eType,
  };
}
