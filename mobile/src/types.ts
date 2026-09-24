export type Company = {
  id?: string;
  _id?: string;
  name: string;
  address?: string;
  city?: string;
  phone?: string;
  email?: string;
  tax_number?: string;
  tax_office?: string;
  logo_url?: string | null;
  iban?: string;
  bank_name?: string;
  price_decimals?: number;
};

export type User = {
  id: string;
  email: string;
  name: string;
  role: string;
  role_name?: string;
  active_company_id?: string;
  permissions?: Record<string, string>;
  features?: Record<string, boolean>;
  is_super_admin?: boolean;
  employee_id?: string;
};

export type License = {
  modules?: Record<string, boolean>;
  addons?: Record<string, boolean>;
  plan_name?: string;
  status?: string;
};

export type SessionPayload = {
  authenticated?: boolean;
  token?: string;
  user: User | null;
  companies: Company[];
  license: License | null;
};

export type Overview = {
  date: string;
  tasks: { key: string; label: string; count: number; extra?: string | null; path: string }[];
  collections: { total: number; overdue: number; not_due: number };
  payments: { total: number; overdue: number; not_due: number };
  drafts: { count: number; total: number };
  invoices: { incoming: { month: number; week: number; today: number }; outgoing: { month: number; week: number; today: number } };
  vat: { month: string; calculated: number; deductible: number; payable: number; days_left: number };
};

/** /dashboard/stats — web panosundaki aylık ciro / kâr rakamları. */
export type DashboardStats = {
  monthly_sales?: number;
  monthly_expenses?: number;
  net_profit?: number;
  sales_change_pct?: number | null;
  total_bank_balance?: number;
  total_receivables?: number;
  total_payables?: number;
};

export type Contact = {
  id?: string;
  _id?: string;
  name: string;
  type?: string;
  company_title?: string;
  contact_person?: string;
  contact_person_phone?: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  city?: string;
  district?: string;
  tax_number_or_id?: string;
  tax_office?: string;
  is_e_invoice_user?: boolean;
  currency?: string;
  payment_method?: string;
  balance?: number;
  credit_limit?: number;
  payment_term_days?: number;
  late_fee_rate?: number;
  default_discount?: number;
  risk_status?: string;
  bank_name?: string;
  iban?: string;
  cheque_bond_balance?: number;
  b2b_enabled?: boolean;
  b2b_discount?: number;
  b2b_login_email?: string;
  category?: string;
  sales_rep?: string;
  tags?: string[];
  notes?: string;
  sms_opt_in?: boolean;
  email_opt_in?: boolean;
  latitude?: number;
  longitude?: number;
  location_url?: string;
};

export type Invoice = {
  id?: string;
  _id?: string;
  invoice_number?: string;
  invoice_type?: string;
  e_type?: string;
  contact_name?: string;
  contact_id?: string;
  grand_total?: number;
  subtotal?: number;
  vat_total?: number;
  paid_amount?: number;
  status?: string;
  payment_status?: string;
  issue_date?: string;
  due_date?: string;
  items?: Record<string, unknown>[];
  currency?: string;
  notes?: string;
  gib_status?: string;
  gib_tracking_id?: string;
  einvoice_state?: string;
  withholding_rate?: number;
  withholding_code?: string;
  withholding_amount?: number;
  price_mode?: string;
  general_discount_rate?: number;
  general_discount_amount?: number;
  fx_rate?: number;
  fx_source?: string;
  trade_kind?: string;
  incoterm?: string;
  country?: string;
  customs_office?: string;
  project_id?: string;
  project_number?: string;
  regime_code?: string;
  declaration_no?: string;
  declaration_date?: string;
  dab_no?: string;
  bl_awb?: string;
  certificate?: string;
  trade_file_number?: string;
  direction?: string;
  source?: string;
  edoc_id?: string;
  gib_response?: string;
  dispatch_id?: string;
  installment_plan?: boolean;
  payment_plan?: { rows?: Array<{ no?: number | string; label?: string; due_date?: string; amount?: number; status?: string }> };
  images?: string[];
  contact_balance?: number | null;
};

export type Order = {
  id?: string;
  _id?: string;
  contact_id?: string;
  contact_balance?: number | null;
  order_number?: string;
  customer_order_number?: string;
  customer_name?: string;
  customer_phone?: string;
  customer_email?: string;
  channel?: string;
  order_status?: string;
  total_amount?: number;
  grand_total?: number;
  order_date?: string;
  items?: Record<string, unknown>[];
  notes?: string;
  shipping_address?: string;
  city?: string;
  district?: string;
  cargo_tracking_number?: string;
  cargo_barcode?: string;
  cargo_carrier?: string;
  cargo_carrier_name?: string;
  cargo_label_url?: string;
  cargo_tracking_url?: string;
  cargo_shipment_id?: string;
  payment_type?: string;
  currency?: string;
  subtotal?: number;
  vat_total?: number;
  discount_total?: number;
  contact_name?: string;
  customer_note?: string;
  order_note?: string;
  customer_notes?: string;
  created_at?: string;
  label_printed_at?: string;
  form_printed_at?: string;
  dispatch_id?: string;
  dispatch_number?: string;
  marketplace_status?: string;
  shipment_package_id?: string | number;
  external_id?: string | number;
  source?: string;
  is_invoiced?: boolean;
  invoice_id?: string;
  invoice_number?: string;
  status?: string;
  cancel_request?: { status?: string; reason?: string; at?: string } | null;
  tracking?: {
    carrier?: string;
    tracking_number?: string;
    tracking_url?: string;
    status?: string;
    step?: number;
    steps?: string[];
    estimated_delivery?: string;
    delivered_at?: string;
    shipped_at?: string;
    is_late?: boolean;
  } | null;
};

export type Product = {
  id?: string;
  _id?: string;
  name: string;
  sku?: string;
  barcode?: string;
  sale_price?: number;
  vat_rate?: number;
  stock_quantity?: number;
  unit?: string;
  type?: string;
  is_active?: boolean;
  price_includes_vat?: boolean;
  image_url?: string;
  thumbnail_url?: string;
  images?: string[];
  category?: string;
  purchase_price?: number;
  last_purchase_price?: number | null;
  last_purchase_date?: string | null;
  last_purchase_supplier?: string | null;
  last_sale_price?: number | null;
  last_sale_date?: string | null;
  last_sale_contact?: string | null;
  purchase_vat_rate?: number;
  min_stock_alert?: number;
  show_in_b2b?: boolean;
  track_stock?: boolean;
  vat_exemption_code?: string | null;
  desi?: number | null;
  weight?: number | null;
  length?: number | null;
  width?: number | null;
  height?: number | null;
  package_count?: number | null;
  gtip?: string | null;
  origin_country?: string | null;
  manufacturer_code?: string | null;
};

export type Notification = {
  id?: string;
  _id?: string;
  title?: string;
  message?: string;
  body?: string;
  is_read?: boolean;
  created_at?: string;
  type?: string;
  link?: string | null;
  ref_type?: string | null;
  ref_id?: string | null;
  roles?: string[] | null;
  user_id?: string | null;
  employee_id?: string | null;
};

export type SessionKind = "erp" | "b2b";

export type B2BLoginResult = {
  token: string;
  name?: string;
  redirect?: string;
  status?: string;
  message?: string;
};

export type B2BForgotResult = {
  status?: string;
  message?: string;
  mail_status?: string;
  detail?: string;
};

export type B2BProduct = {
  id: string;
  name: string;
  sku?: string;
  barcode?: string;
  category?: string | null;
  unit?: string;
  image_url?: string | null;
  tags?: string[];
  list_price?: number | null;
  price?: number | null;
  list_price_gross?: number | null;
  price_gross?: number | null;
  price_includes_vat?: boolean;
  vat_rate?: number;
  in_stock?: boolean;
  stock_quantity?: number | null;
};

export type B2BContact = {
  name?: string;
  balance?: number;
  discount?: number;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  has_password?: boolean;
};

export type B2BCompany = {
  name?: string;
  phone?: string;
  email?: string;
  logo_url?: string | null;
  iban?: string;
  bank_name?: string;
  price_decimals?: number;
};

export type B2BSettings = {
  show_stock?: boolean;
  show_prices?: boolean;
  allow_orders?: boolean;
  show_statement?: boolean;
  show_installments?: boolean;
  allow_ai_cart?: boolean;
  min_order_amount?: number;
  welcome_note?: string;
};

export type B2BInvoice = {
  invoice_number?: string;
  issue_date?: string;
  due_date?: string;
  grand_total?: number;
  paid_amount?: number;
  payment_status?: string;
  e_type?: string;
};

export type B2BInstallment = {
  id?: string;
  _id?: string;
  invoice_number?: string;
  label?: string;
  no?: number;
  amount?: number;
  paid_amount?: number;
  due_date?: string;
  status?: string;
  is_overdue?: boolean;
  days_left?: number | null;
};

export type B2BLegalLink = { slug: string; title: string; path?: string };

export type B2BPortal = {
  contact: B2BContact;
  company: B2BCompany;
  products: B2BProduct[];
  orders: Order[];
  invoices: B2BInvoice[];
  installments: B2BInstallment[];
  settings: B2BSettings;
  legal?: B2BLegalLink[];
};
