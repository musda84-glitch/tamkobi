import { computeLine, lineFromProduct } from "./documentLines";

export const RETAIL_CONTACT_NAME = "Perakende Müşteri";
export const RETAIL_CONTACT_TAX = "11111111111";

/** Barkod terminali satış satırı (KDV hariç birim fiyat). */
export function barcodeSaleLine(product, quantity = 1) {
  const qty = Math.max(Number(quantity) || 1, 0.0001);
  const variant = product?.matched_variant || null;
  const unitPrice = Number(variant?.price ?? variant?.sale_price ?? product?.sale_price ?? 0) || 0;
  const line = lineFromProduct(
    {
      ...product,
      id: product?.id || product?._id,
      sale_price: unitPrice,
      name: variant ? `${product.name} / ${variant.name}` : product?.name,
      sku: variant?.sku || product?.sku,
      barcode: variant?.barcode || product?.barcode,
    },
    { invoiceType: "sales", quantity: qty },
  );
  return computeLine(line, "unit_price");
}

export function barcodeSalePayload({ companyId, contact, product, quantity, mode }) {
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

export function pickCashAccount(accounts = []) {
  const rows = Array.isArray(accounts) ? accounts : [];
  return (
    rows.find((a) => ["cash", "cash_box", "kasa"].includes(String(a.type || a.account_type || "").toLowerCase())) ||
    rows.find((a) => /kasa|nakit|cash/i.test(a.account_name || a.name || "")) ||
    rows[0] ||
    null
  );
}

export function findRetailContact(contacts = []) {
  const rows = Array.isArray(contacts) ? contacts : [];
  return (
    rows.find((c) => String(c.tax_number_or_id || "") === RETAIL_CONTACT_TAX && /perakende/i.test(c.name || "")) ||
    rows.find((c) => (c.name || "").trim().toLowerCase() === RETAIL_CONTACT_NAME.toLowerCase()) ||
    rows.find((c) => /perakende/i.test(c.name || "") && /m[uü]şteri/i.test(c.name || "")) ||
    null
  );
}
