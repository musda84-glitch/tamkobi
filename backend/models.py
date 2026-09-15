from pydantic import BaseModel, Field, ConfigDict, BeforeValidator
from typing import Optional, List, Dict, Any, Annotated
from datetime import datetime, timezone
import uuid

PyObjectId = Annotated[str, BeforeValidator(str)]

class BaseDocument(BaseModel):
    model_config = ConfigDict(populate_by_name=True, arbitrary_types_allowed=True, extra="ignore")
    id: Optional[str] = Field(default_factory=lambda: str(uuid.uuid4()), alias="_id")

    def to_mongo(self) -> dict:
        data = self.model_dump(by_alias=True, exclude_none=True)
        if "_id" in data and not data["_id"]:
            data["_id"] = str(uuid.uuid4())
        return data

    @classmethod
    def from_mongo(cls, data: dict):
        if not data:
            return None
        data["id"] = str(data.pop("_id", data.get("id", str(uuid.uuid4()))))
        return cls(**data)

# Auth & User Models
class User(BaseDocument):
    email: str
    password_hash: str
    name: str
    role: str = "admin"  # admin, accountant, sales, warehouse
    company_ids: List[str] = []
    active_company_id: Optional[str] = None
    user_number: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class UserResponse(BaseModel):
    id: str
    email: str
    name: str
    role: str
    company_ids: List[str] = []
    active_company_id: Optional[str] = None
    user_number: Optional[str] = None

class Company(BaseDocument):
    name: str
    tax_number: str
    tax_office: str
    address: str
    city: str
    phone: str
    email: str
    currency: str = "TRY"
    logo_url: Optional[str] = None
    e_invoice_alias: Optional[str] = "urn:mail:defaultpk@gib.gov.tr"
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

# Cari (Müşteri & Tedarikçi)
class Contact(BaseDocument):
    company_id: str
    type: str  # "customer", "supplier", "both"
    name: str
    company_title: Optional[str] = None
    tax_number_or_id: str
    tax_office: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    district: Optional[str] = None
    balance: float = 0.0  # Pozitif: Alacaklıyız, Negatif: Borçluyuz
    credit_limit: float = 0.0
    category: Optional[str] = "Genel"
    is_e_invoice_user: bool = False
    payment_term_days: int = 0
    late_fee_rate: float = 0.0
    b2b_token: Optional[str] = None
    b2b_discount: float = 0.0
    b2b_enabled: bool = False
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    location_url: Optional[str] = None
    notes: Optional[str] = None
    contact_person: Optional[str] = None
    contact_person_phone: Optional[str] = None
    website: Optional[str] = None
    iban: Optional[str] = None
    bank_name: Optional[str] = None
    currency: str = "TRY"
    default_discount: float = 0.0
    payment_method: Optional[str] = None
    tags: List[str] = []
    sms_opt_in: bool = True
    email_opt_in: bool = True
    sales_rep: Optional[str] = None
    risk_status: Optional[str] = "normal"
    b2b_login_email: Optional[str] = None
    kvkk_accepted: bool = False
    kvkk_accepted_at: Optional[str] = None
    legal_accept: Optional[Dict[str, Any]] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

# Stok & Ürünler
class ProductVariant(BaseModel):
    variant_id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    name: str  # Örn: "Mavi - L"
    sku: str
    barcode: str = ""
    stock: float = 0
    price: float = 0.0
    attributes: Dict[str, str] = {}  # {"Renk": "Mavi", "Beden": "L"}
    image_url: Optional[str] = None

class VariantOption(BaseModel):
    name: str  # Renk, Beden
    values: List[str] = []

class Product(BaseDocument):
    company_id: str
    name: str
    sku: str
    barcode: Optional[str] = ""
    type: str = "product"  # "product", "service", "raw_material", "finished_good"
    category: str = "Genel"
    unit: str = "Adet"  # Adet, Kg, Metre, Litre, Paket, Koli
    vat_rate: int = 20  # % KDV: 0, 1, 10, 20
    purchase_price: float = 0.0
    sale_price: float = 0.0
    currency: str = "TRY"
    stock_quantity: float = 0.0
    min_stock_alert: float = 5.0
    warehouse_id: Optional[str] = "main_warehouse"
    has_variants: bool = False
    variant_options: List[VariantOption] = []
    variants: List[ProductVariant] = []
    image_url: Optional[str] = None
    images: List[str] = []
    gtip: Optional[str] = None
    origin_country: Optional[str] = None
    desi: Optional[float] = None
    weight: Optional[float] = None  # kg
    length: Optional[float] = None  # cm (en)
    width: Optional[float] = None   # cm (boy)
    height: Optional[float] = None  # cm (yükseklik)
    package_count: Optional[int] = 1  # tipik paket sayısı (kargo)
    show_in_b2b: bool = True
    track_stock: bool = True
    track_lot: bool = False          # Parti / lot takibi
    track_serial: bool = False       # Seri no takibi (adet bazlı)
    track_expiry: bool = False       # SKT / üretim tarihi zorunlu
    purchase_vat_rate: float = 20.0
    price_includes_vat: bool = False
    vat_exemption_code: Optional[str] = None
    tags: List[str] = []
    is_active: bool = True
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

# Stok lot / seri / SKT
class StockLot(BaseDocument):
    company_id: str
    product_id: str
    product_name: str = ""
    lot_number: str = ""                 # parti no (lot) veya boş
    serial_number: Optional[str] = None  # seri no (tekil)
    tracking_type: str = "lot"           # lot | serial
    production_date: Optional[str] = None  # YYYY-MM-DD
    expiry_date: Optional[str] = None      # YYYY-MM-DD SKT
    quantity: float = 0.0
    warehouse_id: Optional[str] = None
    notes: Optional[str] = None
    is_active: bool = True
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

# Depolar
class Warehouse(BaseDocument):
    company_id: str
    name: str
    code: str
    location: str
    manager_name: Optional[str] = None
    is_default: bool = False
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class WarehouseTransfer(BaseDocument):
    company_id: str
    transfer_number: str
    source_warehouse_id: str
    target_warehouse_id: str
    product_id: str
    product_name: str
    quantity: float
    notes: Optional[str] = None
    status: str = "completed"  # pending, completed, cancelled
    transfer_date: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

# Faturalar (Satış, Alış, E-Fatura, E-Arşiv)
class InvoiceItem(BaseModel):
    product_id: Optional[str] = None
    name: str
    quantity: float
    unit: str = "Adet"
    unit_price: float
    unit_price_incl: float = 0.0
    vat_rate: int = 20
    discount_percent: float = 0.0
    discount_rate: float = 0.0
    total: float
    total_incl: float = 0.0
    vat_amount: float = 0.0
    is_service: bool = False
    sku: Optional[str] = ""
    barcode: Optional[str] = ""
    gtip: Optional[str] = None
    origin_country: Optional[str] = None
    net_weight: Optional[float] = None
    landed_unit_try: Optional[float] = None
    note: Optional[str] = None
    lot_id: Optional[str] = None
    lot_number: Optional[str] = None
    serial_number: Optional[str] = None
    production_date: Optional[str] = None
    expiry_date: Optional[str] = None

class Invoice(BaseDocument):
    company_id: str
    invoice_type: str  # "sales", "purchase", "proforma", "return"
    e_type: str = "e_archive"  # "e_invoice", "e_archive", "e_dispatch", "e_export", "paper"
    invoice_number: Optional[str] = None
    contact_id: str
    contact_name: str
    contact_tax_id: Optional[str] = None
    issue_date: str = Field(default_factory=lambda: datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    due_date: Optional[str] = None
    items: List[InvoiceItem] = []
    subtotal: float = 0.0
    vat_total: float = 0.0
    discount_total: float = 0.0
    general_discount_rate: float = 0.0
    general_discount_amount: float = 0.0
    grand_total: float = 0.0
    withholding_rate: float = 0.0  # tevkifat oranı (0.5 = 5/10)
    withholding_code: Optional[str] = None
    withholding_amount: float = 0.0
    price_mode: str = "excl"  # excl: KDV hariç, incl: KDV dahil girildi (net'e çevrilir)
    currency: str = "TRY"
    fx_rate: float = 1.0
    fx_date: Optional[str] = None
    fx_source: Optional[str] = None
    local_total: float = 0.0
    trade_kind: Optional[str] = None  # None/domestic, export, import
    incoterm: Optional[str] = None
    country: Optional[str] = None
    customs_office: Optional[str] = None
    regime_code: Optional[str] = None
    declaration_no: Optional[str] = None
    declaration_date: Optional[str] = None
    dab_no: Optional[str] = None
    bl_awb: Optional[str] = None
    certificate: Optional[str] = None
    trade_file_id: Optional[str] = None
    trade_file_number: Optional[str] = None
    status: str = "draft"  # draft, sent_to_gib, approved, paid, cancelled, overdue
    gib_status: Optional[str] = "Taslak"  # İnsan okunur GİB durumu
    gib_tracking_id: Optional[str] = None
    gib_uuid: Optional[str] = None  # ETTN
    gib_invoice_id: Optional[str] = None  # GİB fatura no
    gib_scenario: Optional[str] = None  # TICARIFATURA | TEMELFATURA | EARSIVFATURA
    einvoice_state: Optional[str] = "draft"  # draft | queued | sent | error | cancelled
    gib_document_url: Optional[str] = None
    gib_error: Optional[str] = None
    gib_mode: Optional[str] = None  # test | live | simulated
    integrator: Optional[str] = None
    gib_response: Optional[str] = None  # incoming e-invoice: accepted | rejected
    direction: Optional[str] = None  # incoming = GİB'den gelen alış e-faturası (kesilmez)
    source: Optional[str] = None  # edoc_inbox, manual, …
    edoc_id: Optional[str] = None
    payment_status: str = "unpaid"  # unpaid, partially_paid, paid
    paid_amount: float = 0.0
    notes: Optional[str] = None
    source_channel: Optional[str] = "manual"  # manual, trendyol, hepsiburada, b2b, amazon, shopify
    project_id: Optional[str] = None
    project_number: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    issued_at: Optional[str] = None
    queued_at: Optional[str] = None
    buyer_tax_id: Optional[str] = None
# Banka, Kasa, POS
class BankAccount(BaseDocument):
    company_id: str
    type: str = "bank"  # bank, cash_box, pos, credit_card
    bank_name: str
    account_name: str
    account_number: Optional[str] = None
    iban: Optional[str] = None
    currency: str = "TRY"
    current_balance: float = 0.0
    pos_commission_rate: Optional[float] = 0.0
    card_holder: Optional[str] = None
    card_last4: Optional[str] = None
    card_expiry: Optional[str] = None
    card_limit: Optional[float] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class BankTransaction(BaseDocument):
    company_id: str
    account_id: str
    account_name: str
    type: str  # "inflow" (tahsilat/gelir), "outflow" (tediye/gider), "transfer" (virman)
    category: str
    amount: float
    currency: str = "TRY"
    description: str
    contact_id: Optional[str] = None
    contact_name: Optional[str] = None
    related_invoice_id: Optional[str] = None
    target_account_id: Optional[str] = None  # virman için
    target_account_name: Optional[str] = None
    external_id: Optional[str] = None
    source: str = "manual"  # manual, bank_sync, partner
    is_simulated: bool = False
    match_status: Optional[str] = None  # unmatched, matched
    suggested_contact_id: Optional[str] = None
    suggested_contact_name: Optional[str] = None
    date: str = Field(default_factory=lambda: datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

# Ortaklar Hesabı
class Partner(BaseDocument):
    company_id: str
    name: str
    share_percent: float = 0.0
    phone: Optional[str] = None
    email: Optional[str] = None
    balance: float = 0.0  # Pozitif: şirket ortağa borçlu (sermaye/kâr alacağı)
    total_capital_in: float = 0.0
    total_withdrawn: float = 0.0
    total_profit_share: float = 0.0
    is_active: bool = True
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class PartnerTransaction(BaseDocument):
    company_id: str
    partner_id: str
    partner_name: str
    type: str  # capital_in, withdrawal, profit_share
    amount: float
    account_id: Optional[str] = None
    account_name: Optional[str] = None
    is_paid: bool = True
    description: Optional[str] = None
    date: str = Field(default_factory=lambda: datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

# İletişim: SMS (Netgsm) & E-posta (IMAP/SMTP)
class SmsSettings(BaseDocument):
    company_id: str
    usercode: str = ""
    password_enc: str = ""
    msgheader: str = ""
    is_active: bool = False
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class SmsLog(BaseDocument):
    company_id: str
    to: str
    message: str
    status: str = "sent"  # sent, failed, simulated
    jobid: Optional[str] = None
    error: Optional[str] = None
    contact_id: Optional[str] = None
    contact_name: Optional[str] = None
    context: str = "manual"  # manual, contact, invoice, order, cargo, campaign
    ref_id: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class MailAccount(BaseDocument):
    company_id: str
    user_id: str
    email: str
    display_name: Optional[str] = None
    provider: str = "outlook"  # outlook, office365, gmail, yandex, custom
    imap_host: str
    imap_port: int = 993
    smtp_host: str
    smtp_port: int = 587
    password_enc: str = ""
    signature: Optional[str] = None
    status: str = "unverified"  # unverified, connected, error
    last_error: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class MailLog(BaseDocument):
    company_id: str
    from_email: str
    to: List[str]
    cc: List[str] = []
    subject: str
    body: str
    attachments: List[str] = []
    status: str = "sent"  # sent, failed
    error: Optional[str] = None
    contact_id: Optional[str] = None
    contact_name: Optional[str] = None
    context: str = "manual"
    ref_id: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

# Banka Canlı Veri Bağlantıları
class BankConnection(BaseDocument):
    company_id: str
    provider: str  # kuveytturk, enpara, finfree, other
    provider_name: str = ""
    linked_account_id: str
    linked_account_name: Optional[str] = None
    mode: str = "sandbox"  # sandbox, live
    client_id: Optional[str] = ""
    client_secret: Optional[str] = ""
    api_key: Optional[str] = ""
    customer_number: Optional[str] = ""
    bank_account_number: Optional[str] = ""
    base_url: Optional[str] = ""
    auto_sync: bool = True
    auto_match: bool = False
    status: str = "disconnected"  # disconnected, connected, simulated, error
    last_synced_at: Optional[str] = None
    last_error: Optional[str] = None
    synced_count: int = 0
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
class IntegrationConfig(BaseDocument):
    company_id: str
    channel: str  # trendyol, hepsiburada, n11, amazon, shopify, woocommerce
    channel_name: str
    is_active: bool = False
    api_key: Optional[str] = ""
    api_secret: Optional[str] = ""
    supplier_id: Optional[str] = ""
    store_url: Optional[str] = ""
    webhook_url: Optional[str] = None
    auto_sync_orders: bool = True
    auto_sync_stock: bool = True
    auto_create_invoice: bool = True
    last_synced_at: Optional[str] = None
    status: str = "disconnected"  # connected, error, disconnected

# Kargo Entegrasyonları
class CargoConfig(BaseDocument):
    company_id: str
    carrier_code: str  # yurtici, aras, mng, surat, ptt, geliver
    carrier_name: str
    is_active: bool = False
    customer_number: Optional[str] = ""
    api_username: Optional[str] = ""
    api_password: Optional[str] = ""
    auto_create_barcode: bool = True
    status: str = "disconnected"
    default_package_count: int = 1
    default_desi: Optional[float] = None
    default_weight: Optional[float] = None
    default_length: Optional[float] = None
    default_width: Optional[float] = None
    default_height: Optional[float] = None

class CargoShipment(BaseDocument):
    company_id: str
    carrier_code: str
    carrier_name: str
    tracking_number: str
    barcode: str
    order_id: Optional[str] = None
    customer_name: str
    customer_phone: Optional[str] = None
    address: str
    city: str
    status: str = "created"  # created, picked_up, in_transit, out_for_delivery, delivered, returned
    shipment_date: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    estimated_delivery: Optional[str] = None
    # Shared package info for all carriers (Geliver, Yurtiçi, …)
    package_count: int = 1
    desi: Optional[float] = None
    weight: Optional[float] = None
    length: Optional[float] = None
    width: Optional[float] = None
    height: Optional[float] = None

# Sipariş Modülü & B2B Portalı
class OrderItem(BaseModel):
    product_id: Optional[str] = ""
    product_name: str
    sku: str = ""
    barcode: Optional[str] = ""
    quantity: float = 1
    desi: Optional[float] = None
    weight: Optional[float] = None
    unit: str = "Adet"
    unit_price: float = 0.0
    unit_price_incl: float = 0.0
    vat_rate: float = 0.0
    discount_rate: float = 0.0
    total: float = 0.0
    total_incl: float = 0.0
    vat_amount: float = 0.0
    is_service: bool = False
    note: Optional[str] = None
    price_includes_vat: bool = False

class Order(BaseDocument):
    company_id: str
    order_number: Optional[str] = None
    customer_order_number: Optional[str] = ""
    channel: str = "manual"  # manual, saha, b2b, trendyol, hepsiburada, amazon, shopify
    customer_name: str
    customer_email: Optional[str] = None
    customer_phone: Optional[str] = None
    shipping_address: str
    city: str
    items: List[OrderItem] = []
    total_amount: float
    subtotal: float = 0.0
    vat_total: float = 0.0
    discount_total: float = 0.0
    grand_total: float = 0.0
    currency: str = "TRY"
    order_status: str = "pending"  # pending, approved, preparing, shipped, completed, cancelled
    contact_id: Optional[str] = None
    notes: Optional[str] = None
    salesperson_name: Optional[str] = None
    cargo_carrier: Optional[str] = None
    cargo_tracking_number: Optional[str] = None
    cargo_barcode: Optional[str] = None
    is_invoiced: bool = False
    invoice_id: Optional[str] = None
    order_date: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    cancel_request: Optional[Dict[str, Any]] = None

# Üretim & Reçete (BOM)
class RecipeItem(BaseModel):
    product_id: str
    product_name: str
    quantity: float
    unit: str
    cost_per_unit: float = 0.0
    wastage_percent: float = 0.0

class Recipe(BaseDocument):
    company_id: str
    name: str
    code: Optional[str] = ""
    finished_product_id: str
    finished_product_name: str
    target_quantity: float = 1.0
    unit: str = "Adet"
    materials: List[RecipeItem] = []
    steps: List[Dict[str, Any]] = []  # [{no, name, station, duration_min}]
    labor_cost: float = 0.0
    overhead_cost: float = 0.0
    total_estimated_cost: float = 0.0
    unit_cost: float = 0.0
    is_active: bool = True
    notes: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class ProductionOrder(BaseDocument):
    company_id: str
    order_code: str
    recipe_id: str
    recipe_name: str
    finished_product_id: str
    finished_product_name: str
    planned_quantity: float
    completed_quantity: float = 0.0
    target_warehouse_id: str = "main_warehouse"
    status: str = "planned"  # planned, in_production, completed, cancelled
    total_cost: float = 0.0
    start_date: str = Field(default_factory=lambda: datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    planned_date: Optional[str] = None
    end_date: Optional[str] = None
    source: str = "manual"  # manual, stock_card, order
    notes: Optional[str] = None
    shortages: List[Dict[str, Any]] = []
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

# Personel & Bordro
class Employee(BaseDocument):
    company_id: str
    full_name: str
    tc_kimlik: str
    department: str
    position: str
    phone: str
    email: str
    salary: float  # Net Maaş
    meal_allowance: float = 0.0  # Aylık yemek
    transport_allowance: float = 0.0  # Aylık yol / ulaşım
    start_date: str
    status: str = "active"  # active, on_leave, terminated
    annual_leave_days: int = 14
    used_leave_days: int = 0
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class Payroll(BaseDocument):
    company_id: str
    employee_id: str
    employee_name: str
    period: str  # Örn: "2026-05"
    net_salary: float
    gross_salary: float
    bonus: float = 0.0
    deduction: float = 0.0
    advance_payment: float = 0.0
    final_payable: float
    status: str = "pending"  # pending, paid
    paid_date: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

# AI Finansal Danışman Mesajı
class ChatMessage(BaseDocument):
    company_id: str
    user_id: str
    role: str  # user, assistant, system
    content: str
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
