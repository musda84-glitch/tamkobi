export type Company = {
  id?: string;
  _id?: string;
  name: string;
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

export type Contact = {
  id?: string;
  _id?: string;
  name: string;
  type?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  tax_number_or_id?: string;
  balance?: number;
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
  paid_amount?: number;
  status?: string;
  payment_status?: string;
  issue_date?: string;
  due_date?: string;
  items?: Record<string, unknown>[];
  currency?: string;
};

export type Order = {
  id?: string;
  _id?: string;
  order_number?: string;
  customer_name?: string;
  customer_phone?: string;
  channel?: string;
  order_status?: string;
  total_amount?: number;
  grand_total?: number;
  order_date?: string;
  items?: Record<string, unknown>[];
  notes?: string;
  shipping_address?: string;
  city?: string;
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
};
