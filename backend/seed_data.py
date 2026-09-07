import uuid
from datetime import datetime, timezone, timedelta
from auth_utils import hash_password

async def seed_partners(db):
    company_id = "comp_nexus_main_01"
    if await db.partners.find_one({"company_id": company_id}):
        return
    await db.partners.insert_many([
        {"_id": "partner_01", "company_id": company_id, "name": "Ahmet Yılmaz", "share_percent": 60.0, "phone": "0532 111 22 33", "email": "ahmet@nexus.com",
         "balance": 250000.0, "total_capital_in": 250000.0, "total_withdrawn": 0.0, "total_profit_share": 0.0, "is_active": True, "created_at": datetime.now(timezone.utc).isoformat()},
        {"_id": "partner_02", "company_id": company_id, "name": "Mehmet Kaya", "share_percent": 40.0, "phone": "0533 444 55 66", "email": "mehmet@nexus.com",
         "balance": 150000.0, "total_capital_in": 150000.0, "total_withdrawn": 0.0, "total_profit_share": 0.0, "is_active": True, "created_at": datetime.now(timezone.utc).isoformat()},
    ])
    await db.partner_transactions.insert_many([
        {"_id": str(uuid.uuid4()), "company_id": company_id, "partner_id": "partner_01", "partner_name": "Ahmet Yılmaz", "type": "capital_in", "amount": 250000.0,
         "account_id": "bank_01", "account_name": "Garanti Ticari TL Vadesiz", "is_paid": True, "description": "Kuruluş sermayesi", "date": "2026-01-15", "created_at": datetime.now(timezone.utc).isoformat()},
        {"_id": str(uuid.uuid4()), "company_id": company_id, "partner_id": "partner_02", "partner_name": "Mehmet Kaya", "type": "capital_in", "amount": 150000.0,
         "account_id": "bank_01", "account_name": "Garanti Ticari TL Vadesiz", "is_paid": True, "description": "Kuruluş sermayesi", "date": "2026-01-15", "created_at": datetime.now(timezone.utc).isoformat()},
    ])

async def seed_all_data(db):
    # 1. Check if seeded
    existing_admin = await db.users.find_one({"email": "admin@nexus.com"})
    if existing_admin:
        return

    company_id = "comp_nexus_main_01"
    company_id_2 = "comp_nexus_b2b_02"

    # Seed Companies
    company1 = {
        "_id": company_id,
        "name": "Nexus Teknoloji ve E-Ticaret A.Ş.",
        "tax_number": "6320984412",
        "tax_office": "Kadıköy V.D.",
        "address": "Atatürk Mah. Ataşehir Bulvarı No:42/A",
        "city": "İstanbul",
        "phone": "0850 300 40 50",
        "email": "info@nexus.com",
        "currency": "TRY",
        "e_invoice_alias": "urn:mail:nexusefatura@gib.gov.tr",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "license_id": company_id,
    }
    company2 = {
        "_id": company_id_2,
        "name": "Nexus Global Toptan ve B2B Dağıtım Ltd. Şti.",
        "tax_number": "7820193845",
        "tax_office": "Zincirlikuyu V.D.",
        "address": "Büyükdere Cad. No:190 Levent",
        "city": "İstanbul",
        "phone": "0212 900 10 20",
        "email": "b2b@nexusglobal.com",
        "currency": "TRY",
        "e_invoice_alias": "urn:mail:nexusb2b@gib.gov.tr",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "license_id": company_id_2,
    }
    await db.companies.insert_many([company1, company2])

    # Seed Users
    users = [
        {
            "_id": "usr_admin_01",
            "email": "admin@nexus.com",
            "password_hash": hash_password("admin123"),
            "name": "Sarp Yılmaz (Genel Müdür)",
            "role": "admin",
            "company_ids": [company_id, company_id_2],
            "active_company_id": company_id,
            "created_at": datetime.now(timezone.utc).isoformat()
        },
        {
            "_id": "usr_acc_02",
            "email": "muhasebe@nexus.com",
            "password_hash": hash_password("muhasebe123"),
            "name": "Elif Kaya (Mali Müşavir & Ön Muhasebe)",
            "role": "accountant",
            "company_ids": [company_id],
            "active_company_id": company_id,
            "created_at": datetime.now(timezone.utc).isoformat()
        },
        {
            "_id": "usr_sales_03",
            "email": "satis@nexus.com",
            "password_hash": hash_password("satis123"),
            "name": "Burak Demir (Satış & B2B Müdürü)",
            "role": "sales",
            "company_ids": [company_id],
            "active_company_id": company_id,
            "created_at": datetime.now(timezone.utc).isoformat()
        },
        {
            "_id": "usr_depo_04",
            "email": "depo@nexus.com",
            "password_hash": hash_password("depo123"),
            "name": "Caner Öztürk (Depo & Lojistik Sorumlusu)",
            "role": "warehouse",
            "company_ids": [company_id],
            "active_company_id": company_id,
            "created_at": datetime.now(timezone.utc).isoformat()
        }
    ]
    await db.users.insert_many(users)

    # Seed Warehouses
    warehouses = [
        {
            "_id": "wh_main",
            "company_id": company_id,
            "name": "Merkez Lojistik & E-Ticaret Deposu",
            "code": "DEP-01",
            "location": "Tuzla OSB / İstanbul",
            "manager_name": "Caner Öztürk",
            "is_default": True,
            "created_at": datetime.now(timezone.utc).isoformat()
        },
        {
            "_id": "wh_ankara",
            "company_id": company_id,
            "name": "İç Anadolu Dağıtım Deposu",
            "code": "DEP-02",
            "location": "Ostim / Ankara",
            "manager_name": "Murat Şen",
            "is_default": False,
            "created_at": datetime.now(timezone.utc).isoformat()
        },
        {
            "_id": "wh_raw",
            "company_id": company_id,
            "name": "Üretim & Hammadde Deposu",
            "code": "DEP-03",
            "location": "Dudullu OSB / İstanbul",
            "manager_name": "Ahmet Usta",
            "is_default": False,
            "created_at": datetime.now(timezone.utc).isoformat()
        }
    ]
    await db.warehouses.insert_many(warehouses)

    # Seed Contacts (Cariler)
    contacts = [
        {
            "_id": "cnt_01",
            "company_id": company_id,
            "type": "customer",
            "name": "Trend Mağazacılık ve Perakende A.Ş.",
            "company_title": "Trend Mağazacılık A.Ş.",
            "tax_number_or_id": "8710293841",
            "tax_office": "Beşiktaş V.D.",
            "email": "fatura@trendmagaza.com",
            "phone": "0532 340 50 60",
            "address": "Nispetiye Cad. No:88 Akmerkez",
            "city": "İstanbul",
            "district": "Beşiktaş",
            "balance": 48500.0,
            "credit_limit": 150000.0,
            "category": "Kurumsal Bayi",
            "is_e_invoice_user": True,
            "notes": "Haftalık perşembe günleri toplu ödeme yapar.",
            "created_at": datetime.now(timezone.utc).isoformat()
        },
        {
            "_id": "cnt_02",
            "company_id": company_id,
            "type": "customer",
            "name": "Anadolu Elektronik Tic. Ltd. Şti.",
            "company_title": "Anadolu Elektronik Ltd.",
            "tax_number_or_id": "1190283471",
            "tax_office": "Kızılay V.D.",
            "email": "muhasebe@anadoluelektronik.com",
            "phone": "0533 419 80 00",
            "address": "Tunali Hilmi Cad. No:12/4",
            "city": "Ankara",
            "district": "Çankaya",
            "balance": 22400.0,
            "credit_limit": 75000.0,
            "category": "B2B Bayi",
            "is_e_invoice_user": True,
            "notes": "Vadesi 30 gün.",
            "created_at": datetime.now(timezone.utc).isoformat()
        },
        {
            "_id": "cnt_03",
            "company_id": company_id,
            "type": "supplier",
            "name": "Mikro Çip & Komponent İthalat A.Ş.",
            "company_title": "Mikro Çip A.Ş.",
            "tax_number_or_id": "6201948273",
            "tax_office": "Kozyatağı V.D.",
            "email": "satis@mikrocip.com.tr",
            "phone": "0542 444 88 99",
            "address": "Değirmen Sok. Nida Kule No:18",
            "city": "İstanbul",
            "district": "Kadıköy",
            "balance": -31200.0,  # Borcumuz var
            "credit_limit": 200000.0,
            "category": "Hammadde Tedarikçisi",
            "is_e_invoice_user": True,
            "notes": "Elektronik komponent ana tedarikçimiz.",
            "created_at": datetime.now(timezone.utc).isoformat()
        },
        {
            "_id": "cnt_04",
            "company_id": company_id,
            "type": "supplier",
            "name": "Eko Ambalaj ve Koli Sanayi Ltd.",
            "company_title": "Eko Ambalaj Sanayi Ltd. Şti.",
            "tax_number_or_id": "3340192847",
            "tax_office": "İkitelli V.D.",
            "email": "siparis@ekoambalaj.com",
            "phone": "0505 671 22 33",
            "address": "İkitelli OSB Metal-İş San. Sit. 8. Blok No:14",
            "city": "İstanbul",
            "district": "Başakşehir",
            "balance": -8500.0,
            "credit_limit": 50000.0,
            "category": "Kargo & Sarf Malzeme",
            "is_e_invoice_user": False,
            "notes": "Özel logolu e-ticaret koli tedarikçisi.",
            "created_at": datetime.now(timezone.utc).isoformat()
        }
    ]
    await db.contacts.insert_many(contacts)

    # Seed Products (Stok & Reçetelik Ürünler)
    products = [
        {
            "_id": "prod_01",
            "company_id": company_id,
            "name": "Nexus Akıllı Bluetooth Kulaklık Pro Max (ANC)",
            "sku": "NX-BT-PRO",
            "barcode": "8680001234011",
            "type": "finished_good",
            "category": "Elektronik",
            "unit": "Adet",
            "vat_rate": 20,
            "purchase_price": 850.0,
            "sale_price": 1899.0,
            "currency": "TRY",
            "stock_quantity": 142.0,
            "min_stock_alert": 20.0,
            "warehouse_id": "wh_main",
            "has_variants": True,
            "variant_options": [{"name": "Renk", "values": ["Gece Siyahı", "Kutup Beyazı"]}],
            "variants": [
                {"variant_id": "v1", "name": "Gece Siyahı", "sku": "NX-BT-PRO-BLK", "barcode": "8680001234012", "stock": 82, "price": 1899.0, "attributes": {"Renk": "Gece Siyahı"}, "image_url": None},
                {"variant_id": "v2", "name": "Kutup Beyazı", "sku": "NX-BT-PRO-WHT", "barcode": "8680001234013", "stock": 60, "price": 1899.0, "attributes": {"Renk": "Kutup Beyazı"}, "image_url": None}
            ],
            "images": ["https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=500"],
            "image_url": "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=500",
            "is_active": True,
            "created_at": datetime.now(timezone.utc).isoformat()
        },
        {
            "_id": "prod_02",
            "company_id": company_id,
            "name": "Nexus RGB Mekanik Gaming Klavye (Blue Switch)",
            "sku": "NX-KB-RGB",
            "barcode": "8680001234028",
            "type": "product",
            "category": "Bilgisayar & Aksesuar",
            "unit": "Adet",
            "vat_rate": 20,
            "purchase_price": 620.0,
            "sale_price": 1450.0,
            "currency": "TRY",
            "stock_quantity": 68.0,
            "min_stock_alert": 15.0,
            "warehouse_id": "wh_main",
            "has_variants": False,
            "variants": [],
            "image_url": "https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=500",
            "is_active": True,
            "created_at": datetime.now(timezone.utc).isoformat()
        },
        {
            "_id": "prod_03",
            "company_id": company_id,
            "name": "Kablosuz Hızlı Şarj Standı 15W MagSafe Uyumlu",
            "sku": "NX-CHG-15W",
            "barcode": "8680001234035",
            "type": "product",
            "category": "Aksesuar",
            "unit": "Adet",
            "vat_rate": 20,
            "purchase_price": 180.0,
            "sale_price": 499.0,
            "currency": "TRY",
            "stock_quantity": 8.0,  # Kritik stok!
            "min_stock_alert": 15.0,
            "warehouse_id": "wh_main",
            "has_variants": False,
            "variants": [],
            "image_url": "https://images.unsplash.com/photo-1583863788434-e58a36330cf0?w=500",
            "is_active": True,
            "created_at": datetime.now(timezone.utc).isoformat()
        },
        # Hammaddeler (Üretim için)
        {
            "_id": "prod_raw_01",
            "company_id": company_id,
            "name": "Bluetooth 5.3 Ses İşlemci Çipi",
            "sku": "RAW-CHIP-53",
            "barcode": "8680009901001",
            "type": "raw_material",
            "category": "Elektronik Komponent",
            "unit": "Adet",
            "vat_rate": 20,
            "purchase_price": 240.0,
            "sale_price": 0.0,
            "currency": "TRY",
            "stock_quantity": 450.0,
            "min_stock_alert": 100.0,
            "warehouse_id": "wh_raw",
            "has_variants": False,
            "variants": [],
            "is_active": True,
            "created_at": datetime.now(timezone.utc).isoformat()
        },
        {
            "_id": "prod_raw_02",
            "company_id": company_id,
            "name": "Lityum-Polimer Batarya 400mAh",
            "sku": "RAW-BAT-400",
            "barcode": "8680009901002",
            "type": "raw_material",
            "category": "Batarya",
            "unit": "Adet",
            "vat_rate": 20,
            "purchase_price": 120.0,
            "sale_price": 0.0,
            "currency": "TRY",
            "stock_quantity": 520.0,
            "min_stock_alert": 100.0,
            "warehouse_id": "wh_raw",
            "has_variants": False,
            "variants": [],
            "is_active": True,
            "created_at": datetime.now(timezone.utc).isoformat()
        },
        {
            "_id": "prod_raw_03",
            "company_id": company_id,
            "name": "Kulaklık Dış Kasa Gövdesi & Menteşe Seti",
            "sku": "RAW-CASE-SET",
            "barcode": "8680009901003",
            "type": "raw_material",
            "category": "Plastik & Metal",
            "unit": "Adet",
            "vat_rate": 20,
            "purchase_price": 190.0,
            "sale_price": 0.0,
            "currency": "TRY",
            "stock_quantity": 380.0,
            "min_stock_alert": 80.0,
            "warehouse_id": "wh_raw",
            "has_variants": False,
            "variants": [],
            "is_active": True,
            "created_at": datetime.now(timezone.utc).isoformat()
        }
    ]
    await db.products.insert_many(products)

    # Seed Recipe (Üretim Reçetesi - BOM)
    recipes = [
        {
            "_id": "rec_01",
            "company_id": company_id,
            "name": "Nexus BT Pro Max Kulaklık Standart Montaj Reçetesi",
            "code": "BOM-NX-01",
            "finished_product_id": "prod_01",
            "finished_product_name": "Nexus Akıllı Bluetooth Kulaklık Pro Max (ANC)",
            "target_quantity": 1.0,
            "unit": "Adet",
            "materials": [
                {"product_id": "prod_raw_01", "product_name": "Bluetooth 5.3 Ses İşlemci Çipi", "quantity": 1.0, "unit": "Adet", "cost_per_unit": 240.0},
                {"product_id": "prod_raw_02", "product_name": "Lityum-Polimer Batarya 400mAh", "quantity": 1.0, "unit": "Adet", "cost_per_unit": 120.0},
                {"product_id": "prod_raw_03", "product_name": "Kulaklık Dış Kasa Gövdesi & Menteşe Seti", "quantity": 1.0, "unit": "Adet", "cost_per_unit": 190.0}
            ],
            "labor_cost": 85.0,
            "overhead_cost": 35.0,
            "total_estimated_cost": 670.0,
            "notes": "Test ve lehimleme süresi ürün başına yaklaşık 18 dakikadır.",
            "created_at": datetime.now(timezone.utc).isoformat()
        }
    ]
    await db.recipes.insert_many(recipes)

    # Seed Bank Accounts & Cash
    bank_accounts = [
        {
            "_id": "bank_01",
            "company_id": company_id,
            "type": "bank",
            "bank_name": "Garanti BBVA",
            "account_name": "Garanti Ticari TL Vadesiz",
            "account_number": "6200-9842109",
            "iban": "TR33 0006 2000 0001 2345 6789 01",
            "currency": "TRY",
            "current_balance": 348500.0,
            "pos_commission_rate": 1.45,
            "created_at": datetime.now(timezone.utc).isoformat()
        },
        {
            "_id": "bank_02",
            "company_id": company_id,
            "type": "bank",
            "bank_name": "Türkiye İş Bankası",
            "account_name": "İş Bankası Şirket Hesabı",
            "account_number": "1040-5582910",
            "iban": "TR64 0006 4000 0011 9988 7766 55",
            "currency": "TRY",
            "current_balance": 182400.0,
            "pos_commission_rate": 1.60,
            "created_at": datetime.now(timezone.utc).isoformat()
        },
        {
            "_id": "bank_03",
            "company_id": company_id,
            "type": "cash_box",
            "bank_name": "Merkez Kasa",
            "account_name": "Şirket Merkez Nakit Kasa (TRY)",
            "account_number": "KASA-01",
            "iban": "-",
            "currency": "TRY",
            "current_balance": 34600.0,
            "pos_commission_rate": 0.0,
            "created_at": datetime.now(timezone.utc).isoformat()
        },
        {
            "_id": "bank_04",
            "company_id": company_id,
            "type": "pos",
            "bank_name": "Yapı Kredi POS",
            "account_name": "E-Ticaret Sanal POS & Mağaza POS",
            "account_number": "POS-YK-99",
            "iban": "TR12 0006 7000 0000 1122 3344 55",
            "currency": "TRY",
            "current_balance": 96250.0,
            "pos_commission_rate": 1.89,
            "created_at": datetime.now(timezone.utc).isoformat()
        }
    ]
    await db.bank_accounts.insert_many(bank_accounts)

    # Seed Invoices
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    invoices = [
        {
            "_id": "inv_01",
            "company_id": company_id,
            "invoice_type": "sales",
            "e_type": "e_invoice",
            "invoice_number": "NX202600000104",
            "contact_id": "cnt_01",
            "contact_name": "Trend Mağazacılık ve Perakende A.Ş.",
            "contact_tax_id": "8710293841",
            "issue_date": today_str,
            "due_date": (datetime.now(timezone.utc) + timedelta(days=15)).strftime("%Y-%m-%d"),
            "items": [
                {"product_id": "prod_01", "name": "Nexus Akıllı Bluetooth Kulaklık Pro Max (ANC)", "quantity": 25, "unit": "Adet", "unit_price": 1899.0, "vat_rate": 20, "discount_percent": 5.0, "total": 45101.25},
                {"product_id": "prod_02", "name": "Nexus RGB Mekanik Gaming Klavye (Blue Switch)", "quantity": 10, "unit": "Adet", "unit_price": 1450.0, "vat_rate": 20, "discount_percent": 0.0, "total": 14500.0}
            ],
            "subtotal": 59601.25,
            "vat_total": 11920.25,
            "discount_total": 2373.75,
            "grand_total": 71521.50,
            "currency": "TRY",
            "status": "approved",
            "gib_status": "Başarıyla İletildi",
            "gib_tracking_id": "GIB-20260601-9872134",
            "payment_status": "partially_paid",
            "paid_amount": 23021.50,
            "notes": "Vade: 15 gün. E-Fatura GİB portalı onaylıdır.",
            "source_channel": "manual",
            "created_at": datetime.now(timezone.utc).isoformat()
        },
        {
            "_id": "inv_02",
            "company_id": company_id,
            "invoice_type": "sales",
            "e_type": "e_archive",
            "invoice_number": "EAR202600000089",
            "contact_id": "cnt_02",
            "contact_name": "Anadolu Elektronik Tic. Ltd. Şti.",
            "contact_tax_id": "1190283471",
            "issue_date": today_str,
            "due_date": (datetime.now(timezone.utc) + timedelta(days=30)).strftime("%Y-%m-%d"),
            "items": [
                {"product_id": "prod_03", "name": "Kablosuz Hızlı Şarj Standı 15W MagSafe Uyumlu", "quantity": 30, "unit": "Adet", "unit_price": 499.0, "vat_rate": 20, "discount_percent": 0.0, "total": 14970.0}
            ],
            "subtotal": 14970.0,
            "vat_total": 2994.0,
            "discount_total": 0.0,
            "grand_total": 17964.0,
            "currency": "TRY",
            "status": "approved",
            "gib_status": "GİB'e Gönderildi",
            "gib_tracking_id": "EAR-20260601-554412",
            "payment_status": "unpaid",
            "paid_amount": 0.0,
            "notes": "E-Arşiv Fatura PDF oluşturuldu.",
            "source_channel": "trendyol",
            "created_at": datetime.now(timezone.utc).isoformat()
        },
        {
            "_id": "inv_03",
            "company_id": company_id,
            "invoice_type": "purchase",
            "e_type": "e_invoice",
            "invoice_number": "MKR202600000450",
            "contact_id": "cnt_03",
            "contact_name": "Mikro Çip & Komponent İthalat A.Ş.",
            "contact_tax_id": "6201948273",
            "issue_date": today_str,
            "due_date": (datetime.now(timezone.utc) + timedelta(days=20)).strftime("%Y-%m-%d"),
            "items": [
                {"product_id": "prod_raw_01", "name": "Bluetooth 5.3 Ses İşlemci Çipi", "quantity": 100, "unit": "Adet", "unit_price": 240.0, "vat_rate": 20, "discount_percent": 0.0, "total": 24000.0}
            ],
            "subtotal": 24000.0,
            "vat_total": 4800.0,
            "discount_total": 0.0,
            "grand_total": 28800.0,
            "currency": "TRY",
            "status": "approved",
            "gib_status": "Gelen E-Fatura Onaylandı",
            "gib_tracking_id": "GIB-IN-20260601-112233",
            "payment_status": "unpaid",
            "paid_amount": 0.0,
            "notes": "Hammadde girişi deposu: DEP-03",
            "source_channel": "manual",
            "created_at": datetime.now(timezone.utc).isoformat()
        }
    ]
    await db.invoices.insert_many(invoices)

    # Seed E-Commerce Integrations
    ecom_configs = [
        {
            "_id": "ecom_trendyol",
            "company_id": company_id,
            "channel": "trendyol",
            "channel_name": "Trendyol Pazaryeri",
            "is_active": True,
            "api_key": "ty_prod_key_998127391028",
            "api_secret": "ty_sec_*********************",
            "supplier_id": "184920",
            "store_url": "https://www.trendyol.com/magaza/nexus-teknoloji-m-184920",
            "auto_sync_orders": True,
            "auto_sync_stock": True,
            "auto_create_invoice": True,
            "last_synced_at": datetime.now(timezone.utc).isoformat(),
            "status": "connected"
        },
        {
            "_id": "ecom_hepsiburada",
            "company_id": company_id,
            "channel": "hepsiburada",
            "channel_name": "Hepsiburada Satıcı Portalı",
            "is_active": True,
            "api_key": "hb_merchant_key_448291038",
            "api_secret": "hb_sec_*********************",
            "supplier_id": "HB-90821",
            "store_url": "https://www.hepsiburada.com/magaza/nexus-turkiye",
            "auto_sync_orders": True,
            "auto_sync_stock": True,
            "auto_create_invoice": True,
            "last_synced_at": datetime.now(timezone.utc).isoformat(),
            "status": "connected"
        },
        {
            "_id": "ecom_amazon",
            "company_id": company_id,
            "channel": "amazon",
            "channel_name": "Amazon Türkiye SP-API",
            "is_active": False,
            "api_key": "",
            "api_secret": "",
            "supplier_id": "",
            "store_url": "",
            "auto_sync_orders": True,
            "auto_sync_stock": True,
            "auto_create_invoice": False,
            "last_synced_at": None,
            "status": "disconnected"
        },
        {
            "_id": "ecom_shopify",
            "company_id": company_id,
            "channel": "shopify",
            "channel_name": "Shopify Resmi E-Ticaret Sitesi",
            "is_active": True,
            "api_key": "shpat_99283719283019283",
            "api_secret": "shpss_********************",
            "supplier_id": "nexus-official",
            "store_url": "https://nexus-turkiye.myshopify.com",
            "auto_sync_orders": True,
            "auto_sync_stock": True,
            "auto_create_invoice": True,
            "last_synced_at": datetime.now(timezone.utc).isoformat(),
            "status": "connected"
        },
        {
            "_id": "ecom_n11",
            "company_id": company_id,
            "channel": "n11",
            "channel_name": "N11 Entegrasyonu",
            "is_active": False,
            "api_key": "",
            "api_secret": "",
            "supplier_id": "",
            "store_url": "",
            "auto_sync_orders": False,
            "auto_sync_stock": False,
            "auto_create_invoice": False,
            "last_synced_at": None,
            "status": "disconnected"
        },
        {
            "_id": "ecom_woocommerce",
            "company_id": company_id,
            "channel": "woocommerce",
            "channel_name": "WooCommerce WordPress",
            "is_active": False,
            "api_key": "",
            "api_secret": "",
            "supplier_id": "",
            "store_url": "",
            "auto_sync_orders": False,
            "auto_sync_stock": False,
            "auto_create_invoice": False,
            "last_synced_at": None,
            "status": "disconnected"
        }
    ]
    await db.integration_configs.insert_many(ecom_configs)

    # Seed Cargo Integrations
    cargo_configs = [
        {
            "_id": "cargo_yurtici",
            "company_id": company_id,
            "carrier_code": "yurtici",
            "carrier_name": "Yurtiçi Kargo API",
            "is_active": True,
            "customer_number": "YK-9948210",
            "api_username": "nexus_yk_user",
            "api_password": "************",
            "auto_create_barcode": True,
            "status": "connected"
        },
        {
            "_id": "cargo_aras",
            "company_id": company_id,
            "carrier_code": "aras",
            "carrier_name": "Aras Kargo Entegrasyonu",
            "is_active": True,
            "customer_number": "ARAS-332910",
            "api_username": "nexus_aras_api",
            "api_password": "************",
            "auto_create_barcode": True,
            "status": "connected"
        },
        {
            "_id": "cargo_mng",
            "company_id": company_id,
            "carrier_code": "mng",
            "carrier_name": "MNG Kargo",
            "is_active": False,
            "customer_number": "",
            "api_username": "",
            "api_password": "",
            "auto_create_barcode": True,
            "status": "disconnected"
        },
        {
            "_id": "cargo_ptt",
            "company_id": company_id,
            "carrier_code": "ptt",
            "carrier_name": "PTT Kargo & E-PttAVM",
            "is_active": False,
            "customer_number": "",
            "api_username": "",
            "api_password": "",
            "auto_create_barcode": True,
            "status": "disconnected"
        }
    ]
    await db.cargo_configs.insert_many(cargo_configs)

    # Seed Orders (Siparişler)
    orders = [
        {
            "_id": "ord_01",
            "company_id": company_id,
            "order_number": "TY-98421049",
            "channel": "trendyol",
            "customer_name": "Mert Demirtaş",
            "customer_email": "mert.demirtas@gmail.com",
            "customer_phone": "0532 999 88 77",
            "shipping_address": "Barbaros Mah. Mor Sümbül Sok. Varyap Meridian C Blok D:94",
            "city": "İstanbul",
            "items": [
                {"product_id": "prod_01", "product_name": "Nexus Akıllı Bluetooth Kulaklık Pro Max (ANC)", "sku": "NX-BT-PRO", "quantity": 1, "unit_price": 1899.0, "total": 1899.0}
            ],
            "total_amount": 1899.0,
            "currency": "TRY",
            "order_status": "preparing",
            "cargo_carrier": "yurtici",
            "cargo_tracking_number": "YK-9872145920",
            "cargo_barcode": "8690001928371",
            "is_invoiced": True,
            "invoice_id": "inv_02",
            "order_date": datetime.now(timezone.utc).isoformat()
        },
        {
            "_id": "ord_02",
            "company_id": company_id,
            "order_number": "HB-10294820",
            "channel": "hepsiburada",
            "customer_name": "Selin Aydın",
            "customer_email": "selin.aydin@hotmail.com",
            "customer_phone": "0544 333 22 11",
            "shipping_address": "Göztepe Cad. Gül Apt. No:14 D:6 Kadıköy",
            "city": "İstanbul",
            "items": [
                {"product_id": "prod_02", "product_name": "Nexus RGB Mekanik Gaming Klavye (Blue Switch)", "sku": "NX-KB-RGB", "quantity": 1, "unit_price": 1450.0, "total": 1450.0}
            ],
            "total_amount": 1450.0,
            "currency": "TRY",
            "order_status": "shipped",
            "cargo_carrier": "aras",
            "cargo_tracking_number": "AR-4491029384",
            "cargo_barcode": "8690008839201",
            "is_invoiced": True,
            "invoice_id": None,
            "order_date": datetime.now(timezone.utc).isoformat()
        },
        {
            "_id": "ord_03",
            "company_id": company_id,
            "order_number": "B2B-2026-004",
            "channel": "b2b",
            "customer_name": "Trend Mağazacılık ve Perakende A.Ş.",
            "customer_email": "siparis@trendmagaza.com",
            "customer_phone": "0532 340 50 60",
            "shipping_address": "Nispetiye Cad. No:88 Akmerkez Şube Deposu",
            "city": "İstanbul",
            "items": [
                {"product_id": "prod_01", "product_name": "Nexus Akıllı Bluetooth Kulaklık Pro Max (ANC)", "sku": "NX-BT-PRO", "quantity": 20, "unit_price": 1650.0, "total": 33000.0},
                {"product_id": "prod_03", "product_name": "Kablosuz Hızlı Şarj Standı 15W MagSafe Uyumlu", "sku": "NX-CHG-15W", "quantity": 15, "unit_price": 420.0, "total": 6300.0}
            ],
            "total_amount": 39300.0,
            "currency": "TRY",
            "order_status": "approved",
            "cargo_carrier": "yurtici",
            "cargo_tracking_number": None,
            "cargo_barcode": None,
            "is_invoiced": False,
            "invoice_id": None,
            "order_date": datetime.now(timezone.utc).isoformat()
        }
    ]
    await db.orders.insert_many(orders)

    # Seed Employees (Personel & Bordro)
    employees = [
        {
            "_id": "emp_01",
            "company_id": company_id,
            "full_name": "Ahmet Yılmaz",
            "tc_kimlik": "28391029482",
            "department": "Üretim & Montaj",
            "position": "Baş Teknisyen",
            "phone": "0533 111 22 33",
            "email": "ahmet.yilmaz@nexus.com",
            "salary": 38500.0,
            "start_date": "2023-04-15",
            "status": "active",
            "annual_leave_days": 14,
            "used_leave_days": 4,
            "shopfloor_pin_hash": hash_password("1234"),
            "created_at": datetime.now(timezone.utc).isoformat()
        },
        {
            "_id": "emp_02",
            "company_id": company_id,
            "full_name": "Zeynep Korkmaz",
            "tc_kimlik": "44910293847",
            "department": "Pazarlama & E-Ticaret",
            "position": "E-Ticaret Operasyon Uzmanı",
            "phone": "0542 444 55 66",
            "email": "zeynep.korkmaz@nexus.com",
            "salary": 34000.0,
            "start_date": "2024-01-10",
            "status": "active",
            "annual_leave_days": 14,
            "used_leave_days": 2,
            "shopfloor_pin_hash": hash_password("1234"),
            "created_at": datetime.now(timezone.utc).isoformat()
        },
        {
            "_id": "emp_03",
            "company_id": company_id,
            "full_name": "Emre Çetin",
            "tc_kimlik": "10293847561",
            "department": "Lojistik & Depo",
            "position": "Depo ve Sevkiyat Görevlisi",
            "phone": "0555 777 88 99",
            "email": "emre.cetin@nexus.com",
            "salary": 29500.0,
            "start_date": "2024-06-01",
            "status": "active",
            "annual_leave_days": 14,
            "used_leave_days": 0,
            "shopfloor_pin_hash": hash_password("1234"),
            "created_at": datetime.now(timezone.utc).isoformat()
        }
    ]
    await db.employees.insert_many(employees)

    # Seed Payroll
    payrolls = [
        {
            "_id": "pay_01",
            "company_id": company_id,
            "employee_id": "emp_01",
            "employee_name": "Ahmet Yılmaz",
            "period": "2026-05",
            "net_salary": 38500.0,
            "gross_salary": 54200.0,
            "bonus": 3000.0,
            "deduction": 0.0,
            "advance_payment": 5000.0,
            "final_payable": 36500.0,
            "status": "paid",
            "paid_date": "2026-05-31",
            "created_at": datetime.now(timezone.utc).isoformat()
        },
        {
            "_id": "pay_02",
            "company_id": company_id,
            "employee_id": "emp_02",
            "employee_name": "Zeynep Korkmaz",
            "period": "2026-05",
            "net_salary": 34000.0,
            "gross_salary": 47800.0,
            "bonus": 2000.0,
            "deduction": 0.0,
            "advance_payment": 0.0,
            "final_payable": 36000.0,
            "status": "paid",
            "paid_date": "2026-05-31",
            "created_at": datetime.now(timezone.utc).isoformat()
        }
    ]
    await db.payrolls.insert_many(payrolls)

    print("Successfully seeded NexusHesap full demo data.")


DEMO_SHOPFLOOR_PIN = "1234"


async def seed_shopfloor_pins(db):
    """Demo personeline atölye şifresi (1234) — yalnızca henüz şifresi yoksa."""
    for eid in ("emp_01", "emp_02", "emp_03"):
        emp = await db.employees.find_one({"_id": eid})
        if emp and not emp.get("shopfloor_pin_hash"):
            await db.employees.update_one({"_id": eid}, {"$set": {"shopfloor_pin_hash": hash_password(DEMO_SHOPFLOOR_PIN)}})
