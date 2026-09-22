"""Canonical TamKobi MySQL document-store catalog.

Physical tables live in schema.mysql.sql. Application entities are rows in
`docs` partitioned by `collection` (the former MongoDB collection name).
"""
from __future__ import annotations

PHYSICAL_TABLES = ("docs", "meta_indexes")

PHYSICAL_COLUMNS = {
    "docs": ("collection", "id", "doc", "updated_at"),
    "meta_indexes": ("collection", "name", "spec", "unique_index"),
}

# Extra tables/columns that other feature branches may add on a live server.
# This catalog PR does not create them; tests treat them as optional.
OPTIONAL_PHYSICAL_TABLES = ("system_logs", "sync_tombstones")
OPTIONAL_DOCS_COLUMNS = ("company_id",)
OPTIONAL_DOCS_INDEXES = ("idx_docs_coll_company", "idx_docs_coll_upd")

CHARSET = "utf8mb4"
COLLATION = "utf8mb4_unicode_ci"
ENGINE = "InnoDB"

# Indexes created in server.py lifespan. unique=True is enforced in mysql_store.
STARTUP_INDEXES = (
    {"collection": "users", "name": "email", "fields": ("email",), "unique": True},
    {"collection": "products", "name": "sku", "fields": ("sku",), "unique": False},
    {"collection": "products", "name": "barcode", "fields": ("barcode",), "unique": False},
    {"collection": "contacts", "name": "tax_number_or_id", "fields": ("tax_number_or_id",), "unique": False},
    {"collection": "invoices", "name": "invoice_number", "fields": ("invoice_number",), "unique": False},
    {"collection": "orders", "name": "order_number", "fields": ("order_number",), "unique": False},
    {"collection": "purchase_orders", "name": "order_number", "fields": ("order_number",), "unique": False},
    {"collection": "login_attempts", "name": "identifier", "fields": ("identifier",), "unique": False},
)

# Core collections that a seeded local database is expected to contain.
CORE_COLLECTIONS = (
    "users",
    "companies",
    "contacts",
    "products",
    "invoices",
    "orders",
    "roles",
    "platform_settings",
)

# Tenant isolation: most documents carry company_id in JSON (not a SQL FK).
SCOPE_PLATFORM = "platform"
SCOPE_TENANT = "tenant"

COLLECTIONS = {
    # --- Platform / SaaS ---
    "users": {
        "scope": SCOPE_PLATFORM,
        "description": "ERP ve platform kullanıcıları (e-posta benzersiz).",
        "keys": ("_id", "email", "password_hash", "name", "role", "company_ids", "active_company_id", "is_active", "is_super_admin", "preferences"),
        "refs": ("companies._id via company_ids[]",),
    },
    "companies": {
        "scope": SCOPE_PLATFORM,
        "description": "Kiracı firmalar (vergi, adres, lisans, üst şirket, B2B ve yazdırma ayarları).",
        "keys": ("_id", "name", "tax_number", "tax_office", "address", "city", "phone", "email", "currency", "license_id", "parent_company_id"),
        "refs": ("company_licenses._id via license_id", "companies._id via parent_company_id"),
    },
    "roles": {
        "scope": SCOPE_TENANT,
        "description": "Firma bazlı RBAC rolleri ve izinleri.",
        "keys": ("_id", "company_id", "code", "name", "permissions", "is_system"),
        "refs": ("companies._id",),
    },
    "user_invites": {
        "scope": SCOPE_TENANT,
        "description": "Kullanıcı davetleri; kabul edilince users kaydı oluşur.",
        "keys": ("_id", "company_id", "email", "role", "employee_id", "accepted_at", "expires_at"),
        "refs": ("companies._id", "employees._id", "users._id"),
    },
    "login_attempts": {
        "scope": SCOPE_PLATFORM,
        "description": "Brute-force kilidi; identifier genelde e-posta.",
        "keys": ("_id", "identifier", "count", "last_attempt"),
        "refs": (),
    },
    "activity_logs": {
        "scope": SCOPE_TENANT,
        "description": "Kullanıcı işlem günlüğü.",
        "keys": ("_id", "company_id", "user_id", "user_name", "module", "path", "method", "status", "ip"),
        "refs": ("users._id", "companies._id"),
    },
    "platform_settings": {
        "scope": SCOPE_PLATFORM,
        "description": "Tek satırlık platform ayarı (_id=platform): marka, deneme, GİB paketleri, AI.",
        "keys": ("_id", "brand_name", "trial_days", "trial_plan_id", "gib_packs", "ai", "public_url"),
        "refs": ("saas_plans._id",),
    },
    "saas_plans": {
        "scope": SCOPE_PLATFORM,
        "description": "Lisans paketleri, modül ve kota tanımları.",
        "keys": ("_id", "code", "name", "modules", "user_limit", "company_limit", "price_monthly", "price_yearly"),
        "refs": (),
    },
    "company_licenses": {
        "scope": SCOPE_PLATFORM,
        "description": "Firmaya bağlı lisans dönemi ve modül override.",
        "keys": ("_id", "plan_id", "status", "started_at", "expires_at", "trial_ends_at", "user_limit", "module_overrides"),
        "refs": ("saas_plans._id",),
    },
    "payment_transactions": {
        "scope": SCOPE_PLATFORM,
        "description": "Stripe/PayTR lisans ödemeleri.",
        "keys": ("_id", "session_id", "company_id", "plan_id", "amount", "status", "payment_status", "applied"),
        "refs": ("companies._id", "saas_plans._id"),
    },
    "upgrade_requests": {
        "scope": SCOPE_TENANT,
        "description": "Paket yükseltme talepleri.",
        "keys": ("_id", "company_id", "plan_id", "status", "requested_by"),
        "refs": ("companies._id", "saas_plans._id"),
    },
    "license_reminders": {
        "scope": SCOPE_PLATFORM,
        "description": "Lisans bitiş hatırlatmaları.",
        "keys": ("_id", "company_id", "sent_at", "kind"),
        "refs": ("companies._id",),
    },
    "counters": {
        "scope": SCOPE_PLATFORM,
        "description": "Belge numarası sayaçları (_id örn. TKF-{company}-{year}).",
        "keys": ("_id", "seq"),
        "refs": (),
    },
    "platform_mail_servers": {
        "scope": SCOPE_PLATFORM,
        "description": "Platform SMTP sunucuları.",
        "keys": ("_id", "name", "smtp_host", "smtp_port", "smtp_user", "password_enc", "is_active"),
        "refs": (),
    },
    "platform_mailboxes": {
        "scope": SCOPE_PLATFORM,
        "description": "Send-as posta kutuları ve izinler.",
        "keys": ("_id", "server_id", "email", "display_name", "allowed_user_ids", "purposes"),
        "refs": ("platform_mail_servers._id",),
    },
    "gib_wallets": {
        "scope": SCOPE_PLATFORM,
        "description": "GİB e-belge kontör bakiyesi.",
        "keys": ("_id", "balance"),
        "refs": ("companies._id as wallet _id",),
    },
    "gib_credit_ledger": {
        "scope": SCOPE_TENANT,
        "description": "GİB kontör hareketleri.",
        "keys": ("_id", "company_id", "wallet_id", "credits", "type", "note"),
        "refs": ("gib_wallets._id", "companies._id"),
    },
    # --- Cari / stok / satış ---
    "contacts": {
        "scope": SCOPE_TENANT,
        "description": "Cari kartlar: müşteri, tedarikçi, both. B2B giriş alanları burada.",
        "keys": ("_id", "company_id", "type", "name", "tax_number_or_id", "balance", "credit_limit", "b2b_enabled", "b2b_token", "statement_share"),
        "refs": ("companies._id",),
    },
    "products": {
        "scope": SCOPE_TENANT,
        "description": "Stok ve hizmet kartları, varyantlar, B2B görünürlük.",
        "keys": ("_id", "company_id", "name", "sku", "barcode", "type", "sale_price", "purchase_price", "stock_quantity", "warehouse_id", "variants"),
        "refs": ("companies._id", "warehouses._id"),
    },
    "product_categories": {
        "scope": SCOPE_TENANT,
        "description": "Ürün kategorileri.",
        "keys": ("_id", "company_id", "name"),
        "refs": ("companies._id",),
    },
    "units": {
        "scope": SCOPE_TENANT,
        "description": "Ölçü birimleri.",
        "keys": ("_id", "company_id", "name"),
        "refs": ("companies._id",),
    },
    "warehouses": {
        "scope": SCOPE_TENANT,
        "description": "Depolar.",
        "keys": ("_id", "company_id", "name", "code", "is_default"),
        "refs": ("companies._id",),
    },
    "warehouse_transfers": {
        "scope": SCOPE_TENANT,
        "description": "Depolar arası transfer fişleri.",
        "keys": ("_id", "company_id", "source_warehouse_id", "target_warehouse_id", "product_id", "quantity"),
        "refs": ("warehouses._id", "products._id"),
    },
    "stock_movements": {
        "scope": SCOPE_TENANT,
        "description": "Stok miktar hareketleri.",
        "keys": ("_id", "product_id", "change", "new_stock", "reason", "variant_id"),
        "refs": ("products._id",),
    },
    "stock_lots": {
        "scope": SCOPE_TENANT,
        "description": "Ürün lot/parti, seri no, üretim ve son kullanma (SKT) kayıtları.",
        "keys": ("_id", "company_id", "product_id", "lot_number", "serial_number", "tracking_type", "production_date", "expiry_date", "quantity", "is_active"),
        "refs": ("products._id", "warehouses._id"),
    },
    "stock_counts": {
        "scope": SCOPE_TENANT,
        "description": "Sayım fişleri (kiosk dahil).",
        "keys": ("_id", "company_id", "warehouse_id", "status", "items"),
        "refs": ("warehouses._id",),
    },
    "invoices": {
        "scope": SCOPE_TENANT,
        "description": "Satış/alış/proforma/iade faturaları ve e-belge alanları (ETTN, senaryo, durum).",
        "keys": ("_id", "company_id", "invoice_type", "e_type", "invoice_number", "contact_id", "items", "grand_total", "status", "gib_status", "gib_uuid", "gib_invoice_id", "gib_scenario", "einvoice_state", "gib_document_url"),
        "refs": ("contacts._id", "orders._id via source", "quotes._id"),
    },
    "incoming_edocs": {
        "scope": SCOPE_TENANT,
        "description": "Gelen e-fatura / e-arşiv kuyruğu.",
        "keys": ("_id", "company_id", "uuid", "dedupe_key", "status", "contact_id", "invoice_id", "lines"),
        "refs": ("contacts._id", "invoices._id"),
    },
    "incoming_edoc_xml": {
        "scope": SCOPE_TENANT,
        "description": "Gelen e-belgelerin ham UBL XML'i (yeniden okuma ve indirme için).",
        "keys": ("_id", "company_id", "xml", "created_at"),
        "refs": ("incoming_edocs._id",),
    },
    "outgoing_einvoice_xml": {
        "scope": SCOPE_TENANT,
        "description": "Giden e-Fatura/e-Arşiv UBL XML arşivi (invoice_id anahtar).",
        "keys": ("_id", "invoice_id", "company_id", "xml", "scenario", "updated_at"),
        "refs": ("invoices._id",),
    },
    "e_invoices": {
        "scope": SCOPE_TENANT,
        "description": "Giden e-fatura takip kayıtları (DRAFT/SENT/ACCEPTED/REJECTED/CANCELLED); sipariş ve GİB UUID bağları.",
        "keys": ("_id", "company_id", "order_id", "invoice_id", "invoice_number", "scenario", "status", "total_amount", "gib_uuid", "pdf_url", "created_at"),
        "refs": ("companies._id", "orders._id", "invoices._id"),
    },
    "einvoice_settings": {
        "scope": SCOPE_TENANT,
        "description": "Firma e-fatura entegratör kimlik bilgileri (şifre şifreli); test/canlı mod; otomatik gelen kutu çekimi.",
        "keys": ("_id", "company_id", "provider", "username", "password_enc", "corporate_code", "alias", "mode", "auto_pull", "auto_process", "last_inbox_sync_at"),
        "refs": ("companies._id",),
    },
    "orders": {
        "scope": SCOPE_TENANT,
        "description": "Satış siparişleri (manuel, B2B, pazaryeri).",
        "keys": ("_id", "company_id", "order_number", "channel", "contact_id", "items", "total_amount", "order_status", "invoice_id"),
        "refs": ("contacts._id", "invoices._id", "products._id via items[]"),
    },
    "purchase_orders": {
        "scope": SCOPE_TENANT,
        "description": "Verilen siparişler (tedarikçiye alış siparişi); stok yeniden sipariş ve manuel.",
        "keys": ("_id", "company_id", "order_number", "contact_id", "supplier_name", "items", "grand_total", "order_status", "invoice_id", "source_channel"),
        "refs": ("contacts._id", "invoices._id", "products._id via items[]"),
    },
    "order_pick_sessions": {
        "scope": SCOPE_TENANT,
        "description": "Depo toplama kiosk oturumları.",
        "keys": ("_id", "company_id", "order_id", "status", "items"),
        "refs": ("orders._id",),
    },
    "quotes": {
        "scope": SCOPE_TENANT,
        "description": "Teklifler; onay token, fatura ve proje bağları.",
        "keys": ("_id", "company_id", "quote_number", "contact_id", "project_id", "survey_id", "items", "grand_total", "status", "invoice_id"),
        "refs": ("contacts._id", "projects._id", "surveys._id", "invoices._id"),
    },
    "projects": {
        "scope": SCOPE_TENANT,
        "description": "Projeler (keşif/teklif sonrası).",
        "keys": ("_id", "company_id", "project_number", "name", "contact_id", "status", "budget", "images", "stage_photos"),
        "refs": ("contacts._id", "quotes._id", "invoices._id"),
    },
    "surveys": {
        "scope": SCOPE_TENANT,
        "description": "Saha keşifleri.",
        "keys": ("_id", "company_id", "survey_number", "contact_id", "project_id", "quote_id", "status"),
        "refs": ("contacts._id", "projects._id", "quotes._id"),
    },
    "installments": {
        "scope": SCOPE_TENANT,
        "description": "Çek/senet ve taksit planları.",
        "keys": ("_id", "company_id", "contact_id", "invoice_id", "due_date", "amount", "status", "direction"),
        "refs": ("contacts._id", "invoices._id"),
    },
    "returns": {
        "scope": SCOPE_TENANT,
        "description": "İade kayıtları.",
        "keys": ("_id", "company_id", "order_id", "invoice_id"),
        "refs": ("orders._id", "invoices._id"),
    },
    # --- Finans ---
    "bank_accounts": {
        "scope": SCOPE_TENANT,
        "description": "Banka, kasa, POS hesapları.",
        "keys": ("_id", "company_id", "type", "bank_name", "account_name", "iban", "current_balance"),
        "refs": ("companies._id",),
    },
    "bank_transactions": {
        "scope": SCOPE_TENANT,
        "description": "Tahsilat, tediye, virman.",
        "keys": ("_id", "company_id", "account_id", "type", "amount", "contact_id", "related_invoice_id", "date"),
        "refs": ("bank_accounts._id", "contacts._id", "invoices._id"),
    },
    "bank_connections": {
        "scope": SCOPE_TENANT,
        "description": "Banka API bağlantıları (sandbox/live).",
        "keys": ("_id", "company_id", "provider", "linked_account_id", "status"),
        "refs": ("bank_accounts._id",),
    },
    "bank_match_rules": {
        "scope": SCOPE_TENANT,
        "description": "Ekstre otomatik eşleme kuralları.",
        "keys": ("_id", "company_id"),
        "refs": ("companies._id",),
    },
    "cash_approval_requests": {
        "scope": SCOPE_TENANT,
        "description": "Kasa çift onay talepleri.",
        "keys": ("_id", "company_id", "status", "kind", "requested_by", "approved_by"),
        "refs": ("users._id",),
    },
    "partners": {
        "scope": SCOPE_TENANT,
        "description": "Ortaklar ve sermaye bakiyesi.",
        "keys": ("_id", "company_id", "name", "share_percent", "balance"),
        "refs": ("companies._id",),
    },
    "partner_transactions": {
        "scope": SCOPE_TENANT,
        "description": "Sermaye, çekim, kâr payı.",
        "keys": ("_id", "company_id", "partner_id", "type", "amount", "account_id"),
        "refs": ("partners._id", "bank_accounts._id"),
    },
    "loans": {
        "scope": SCOPE_TENANT,
        "description": "Kredi / borç sözleşmeleri.",
        "keys": ("_id", "company_id"),
        "refs": ("companies._id",),
    },
    "expenses": {
        "scope": SCOPE_TENANT,
        "description": "Masraf fişleri.",
        "keys": ("_id", "company_id", "category", "amount", "account_id", "contact_id", "employee_id", "vat_amount"),
        "refs": ("bank_accounts._id", "contacts._id", "employees._id"),
    },
    "expense_categories": {
        "scope": SCOPE_TENANT,
        "description": "Masraf kategorileri.",
        "keys": ("_id", "company_id", "name"),
        "refs": ("companies._id",),
    },
    "expense_budgets": {
        "scope": SCOPE_TENANT,
        "description": "Kategori aylık bütçe limitleri.",
        "keys": ("_id", "company_id", "category", "monthly_limit"),
        "refs": ("companies._id",),
    },
    "fx_rates": {
        "scope": SCOPE_TENANT,
        "description": "TCMB / manuel döviz kurları.",
        "keys": ("_id", "company_id", "currency", "rate", "date", "source"),
        "refs": ("companies._id",),
    },
    "trade_files": {
        "scope": SCOPE_TENANT,
        "description": "İthalat/ihracat dosyaları ve gümrük maliyetleri.",
        "keys": ("_id", "company_id", "file_number", "kind", "contact_id", "invoice_id", "landed_cost"),
        "refs": ("contacts._id", "invoices._id"),
    },
    # --- Personel / üretim ---
    "employees": {
        "scope": SCOPE_TENANT,
        "description": "Personel kartları, PIN, yan haklar.",
        "keys": ("_id", "company_id", "full_name", "tc_kimlik", "sgk_number", "iban", "salary", "meal_allowance", "transport_allowance", "user_id", "status", "start_date", "end_date"),
        "refs": ("users._id",),
    },
    "payrolls": {
        "scope": SCOPE_TENANT,
        "description": "Bordro dönemleri.",
        "keys": ("_id", "company_id", "employee_id", "period", "net_salary", "final_payable", "status"),
        "refs": ("employees._id",),
    },
    "leave_requests": {
        "scope": SCOPE_TENANT,
        "description": "İzin talepleri.",
        "keys": ("_id", "company_id", "employee_id", "start_date", "end_date", "status"),
        "refs": ("employees._id",),
    },
    "bonus_payments": {
        "scope": SCOPE_TENANT,
        "description": "Prim / avans / yan ödeme.",
        "keys": ("_id", "company_id", "employee_id", "amount", "type", "status"),
        "refs": ("employees._id", "bank_accounts._id"),
    },
    "attendance": {
        "scope": SCOPE_TENANT,
        "description": "Giriş-çıkış / mesai kayıtları.",
        "keys": ("_id", "company_id", "employee_id"),
        "refs": ("employees._id",),
    },
    "attendance_alerts": {
        "scope": SCOPE_TENANT,
        "description": "Mesai uyarıları.",
        "keys": ("_id", "company_id", "type"),
        "refs": ("companies._id",),
    },
    "shift_plans": {
        "scope": SCOPE_TENANT,
        "description": "Vardiya planları.",
        "keys": ("_id", "company_id"),
        "refs": ("companies._id",),
    },
    "shift_templates": {
        "scope": SCOPE_TENANT,
        "description": "Vardiya şablonları.",
        "keys": ("_id", "company_id"),
        "refs": ("companies._id",),
    },
    "recipes": {
        "scope": SCOPE_TENANT,
        "description": "Üretim reçetesi (BOM).",
        "keys": ("_id", "company_id", "finished_product_id", "materials", "unit_cost"),
        "refs": ("products._id",),
    },
    "production_orders": {
        "scope": SCOPE_TENANT,
        "description": "Üretim emirleri.",
        "keys": ("_id", "company_id", "order_code", "recipe_id", "finished_product_id", "status"),
        "refs": ("recipes._id", "products._id", "warehouses._id"),
    },
    "work_orders": {
        "scope": SCOPE_TENANT,
        "description": "İş emri / istasyon adımları.",
        "keys": ("_id", "company_id", "order_id", "station", "status", "assigned_to"),
        "refs": ("production_orders._id", "employees._id"),
    },
    # --- Entegrasyon / iletişim ---
    "integration_configs": {
        "scope": SCOPE_TENANT,
        "description": "Pazaryeri API ayarları (Trendyol, HB, n11, …).",
        "keys": ("_id", "company_id", "channel", "is_active", "api_key", "status"),
        "refs": ("companies._id",),
    },
    "marketplace_mappings": {
        "scope": SCOPE_TENANT,
        "description": "Pazaryeri SKU eşlemeleri.",
        "keys": ("_id", "company_id"),
        "refs": ("products._id",),
    },
    "marketplace_product_cache": {
        "scope": SCOPE_TENANT,
        "description": "Pazaryeri ürün önbelleği.",
        "keys": ("_id", "company_id"),
        "refs": ("companies._id",),
    },
    "marketplace_claims": {
        "scope": SCOPE_TENANT,
        "description": "Pazaryeri iade/itiraz.",
        "keys": ("_id", "company_id"),
        "refs": ("orders._id",),
    },
    "marketplace_questions": {
        "scope": SCOPE_TENANT,
        "description": "Pazaryeri soru-cevap.",
        "keys": ("_id", "company_id"),
        "refs": ("products._id",),
    },
    "marketplace_push_logs": {
        "scope": SCOPE_TENANT,
        "description": "Pazaryeri stok/fiyat/aktiflik push logu; ShopPHP satırlarında errors ve unmatched alanları da tutulur.",
        "keys": ("_id", "company_id"),
        "refs": ("companies._id",),
    },
    "shopphp_push_logs": {
        "scope": SCOPE_TENANT,
        "description": "ShopPHP senkron logu; status_via alanı durumun setOrderStatus mı updateOrder mı ile yazıldığını tutar.",
        "keys": ("_id", "company_id"),
        "refs": ("companies._id",),
    },
    "cargo_configs": {
        "scope": SCOPE_TENANT,
        "description": "Kargo firması API ayarları.",
        "keys": ("_id", "company_id", "carrier_code", "is_active"),
        "refs": ("companies._id",),
    },
    "cargo_shipments": {
        "scope": SCOPE_TENANT,
        "description": "Kargo gönderileri.",
        "keys": ("_id", "company_id", "tracking_number", "order_id", "status"),
        "refs": ("orders._id",),
    },
    "cargo_auto_runs": {
        "scope": SCOPE_TENANT,
        "description": "Otomatik kargo oluşturma koşuları.",
        "keys": ("_id", "company_id"),
        "refs": ("companies._id",),
    },
    "sms_settings": {
        "scope": SCOPE_TENANT,
        "description": "Netgsm SMS ayarları.",
        "keys": ("_id", "company_id", "usercode", "password_enc", "is_active"),
        "refs": ("companies._id",),
    },
    "sms_logs": {
        "scope": SCOPE_TENANT,
        "description": "Gönderilen SMS kayıtları.",
        "keys": ("_id", "company_id", "to", "status", "contact_id"),
        "refs": ("contacts._id",),
    },
    "mail_accounts": {
        "scope": SCOPE_TENANT,
        "description": "Kullanıcı IMAP/SMTP hesapları.",
        "keys": ("_id", "company_id", "user_id", "email", "password_enc", "status"),
        "refs": ("users._id",),
    },
    "mail_logs": {
        "scope": SCOPE_TENANT,
        "description": "Giden e-posta logu ve okundu takibi (son 90 gün cari kartında).",
        "keys": ("_id", "company_id", "to", "subject", "contact_id", "context", "ref_id", "status", "opened_at"),
        "refs": ("contacts._id",),
    },
    "whatsapp_settings": {
        "scope": SCOPE_TENANT,
        "description": "WhatsApp Cloud API ayarları.",
        "keys": ("_id", "company_id", "phone_number_id", "verify_token"),
        "refs": ("companies._id",),
    },
    "whatsapp_logs": {
        "scope": SCOPE_TENANT,
        "description": "WhatsApp mesaj logu.",
        "keys": ("_id", "company_id", "contact_id"),
        "refs": ("contacts._id",),
    },
    "morning_summary_settings": {
        "scope": SCOPE_TENANT,
        "description": "Sabah özeti bildirim ayarı.",
        "keys": ("_id", "company_id"),
        "refs": ("companies._id",),
    },
    "morning_summary_logs": {
        "scope": SCOPE_TENANT,
        "description": "Sabah özeti gönderim logu.",
        "keys": ("_id", "company_id"),
        "refs": ("companies._id",),
    },
    "notifications": {
        "scope": SCOPE_TENANT,
        "description": "Uygulama içi bildirimler.",
        "keys": ("_id", "company_id", "type", "title", "is_read", "ref_id"),
        "refs": ("companies._id",),
    },
    "push_tokens": {
        "scope": SCOPE_TENANT,
        "description": "Mobil Expo push tokenları.",
        "keys": ("_id", "user_id", "company_id", "token", "platform"),
        "refs": ("users._id", "companies._id"),
    },
    "b2b_password_resets": {
        "scope": SCOPE_TENANT,
        "description": "B2B portal şifre sıfırlama tokenları.",
        "keys": ("_id", "contact_id", "used_at"),
        "refs": ("contacts._id",),
    },
    "b2b_product_aliases": {
        "scope": SCOPE_TENANT,
        "description": "B2B AI sepet ürün takma adları.",
        "keys": ("_id", "company_id", "contact_id"),
        "refs": ("contacts._id", "products._id"),
    },
    "pricing_rules": {
        "scope": SCOPE_TENANT,
        "description": "Fiyat listesi / iskonto kuralları.",
        "keys": ("_id", "company_id"),
        "refs": ("companies._id",),
    },
    "label_templates": {
        "scope": SCOPE_TENANT,
        "description": "Barkod etiket şablonları.",
        "keys": ("_id", "company_id", "name", "width_mm", "height_mm"),
        "refs": ("companies._id",),
    },
    # --- Dosya / çöp / migrasyon ---
    "files": {
        "scope": SCOPE_TENANT,
        "description": "Yüklenen dosya metadata (blob objstore'da).",
        "keys": ("_id", "company_id", "storage_path", "original_filename", "entity", "entity_id", "area_key", "size", "is_deleted"),
        "refs": ("companies._id",),
    },
    "storage_folders": {
        "scope": SCOPE_TENANT,
        "description": "Hesap bazlı depolama klasörleri (ürün, logo, gider, personel, e-belge vb.).",
        "keys": ("_id", "company_id", "area_key", "label", "entity", "path", "is_system", "is_active", "created_at"),
        "refs": ("companies._id",),
    },
    "trash": {
        "scope": SCOPE_TENANT,
        "description": "Yumuşak silinen belgenin kopyası ve geri yükleme bilgisi.",
        "keys": ("_id", "company_id", "collection", "doc", "entity_type", "deleted_at", "expires_at"),
        "refs": (),
    },
    "migration_api_configs": {
        "scope": SCOPE_TENANT,
        "description": "Logo/Mikro vb. migrasyon API ayarı.",
        "keys": ("_id", "company_id", "provider", "token_enc"),
        "refs": ("companies._id",),
    },
    "migration_api_cache": {
        "scope": SCOPE_TENANT,
        "description": "Migrasyon API önbelleği.",
        "keys": ("_id", "company_id", "kind"),
        "refs": ("companies._id",),
    },
    "migration_batches": {
        "scope": SCOPE_TENANT,
        "description": "Toplu aktarım işleri.",
        "keys": ("_id", "company_id"),
        "refs": ("companies._id",),
    },
    "migration_uploads": {
        "scope": SCOPE_TENANT,
        "description": "Migrasyon yükleme dosyaları.",
        "keys": ("_id", "company_id"),
        "refs": ("companies._id",),
    },
    "edoc_backups": {
        "scope": SCOPE_TENANT,
        "description": "Muhasebeci e-belge XML/PDF yedek kayıtları.",
        "keys": ("_id", "company_id", "date_from", "date_to", "xml_count", "pdf_count"),
        "refs": ("companies._id",),
    },
    "edoc_backup_reminders": {
        "scope": SCOPE_TENANT,
        "description": "62 günlük e-belge yedek hatırlatması.",
        "keys": ("_id", "company_id", "last_backup_at", "kind"),
        "refs": ("companies._id",),
    },
    "sync_tombstones": {
        "scope": SCOPE_TENANT,
        "description": "İstemci artımlı senkron için silinen kayıt izi (opsiyonel).",
        "keys": ("_id", "collection", "company_id", "doc_id", "deleted_at"),
        "refs": (),
    },
}

COLLECTION_NAMES = tuple(sorted(COLLECTIONS))
