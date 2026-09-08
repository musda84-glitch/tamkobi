# TamKobi MySQL schema map

Generated: `2026-09-08T19:57:07.387372+00:00` · `127.0.0.1:3306/tamkobi`

TamKobi does **not** use one SQL table per entity. Application documents
(invoices, contacts, users, …) live as JSON rows in `docs`, keyed by
`(collection, id)`. `meta_indexes` stores uniqueness rules enforced in Python.
`system_logs` is a native relational audit table.

## Physical tables

### `docs`

- Engine: InnoDB · Collation: utf8mb4_unicode_ci
- Approx rows: 1527 · data 2.516 MB · indexes 0.0 MB

```sql
CREATE TABLE `docs` (
  `collection` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `doc` json NOT NULL,
  `updated_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `company_id` varchar(64) COLLATE utf8mb4_unicode_ci GENERATED ALWAYS AS (json_unquote(json_extract(`doc`,_utf8mb4'$.company_id'))) STORED,
  PRIMARY KEY (`collection`,`id`),
  KEY `idx_docs_coll_company` (`collection`,`company_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
```

### `meta_indexes`

- Engine: InnoDB · Collation: utf8mb4_unicode_ci
- Approx rows: 7 · data 0.016 MB · indexes 0.0 MB

```sql
CREATE TABLE `meta_indexes` (
  `collection` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `spec` json NOT NULL,
  `unique_index` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`collection`,`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
```

### `system_logs`

- Engine: InnoDB · Collation: utf8mb4_unicode_ci
- Approx rows: 2 · data 0.016 MB · indexes 0.062 MB

```sql
CREATE TABLE `system_logs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `level` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `category` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `event` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `user_email` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `company_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ip` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `method` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `path` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status_code` smallint DEFAULT NULL,
  `duration_ms` int DEFAULT NULL,
  `collection_name` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `message` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `details` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_syslogs_created` (`created_at`),
  KEY `idx_syslogs_cat_created` (`category`,`created_at`),
  KEY `idx_syslogs_user` (`user_email`,`created_at`),
  KEY `idx_syslogs_event` (`event`,`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
```

## JSON collections (`docs.collection`)

Each collection is a logical Mongo-style table. Reads historically scanned
the whole collection in Python; `company_id` equality now uses the generated
column + `idx_docs_coll_company`.

### SaaS / platform

| collection | rows | KB | sample fields |
|---|---:|---:|---|
| `users` | 34 | 12.8 | `_id`, `active_company_id`, `company_ids`, `created_at`, `email`, `is_active`, `name`, `password_hash`, `preferences`, `role` |
| `companies` | 40 | 12.9 | `_id`, `address`, `city`, `created_at`, `currency`, `email`, `license_id`, `name`, `phone`, `tax_number`, `tax_office` |
| `company_licenses` | 150 | 49.7 | `_id`, `created_at`, `expires_at`, `module_overrides`, `notes`, `plan_id`, `started_at`, `status`, `trial_ends_at`, `user_limit` |
| `saas_plans` | 4 | 2.5 | `_id`, `code`, `color`, `company_limit`, `created_at`, `is_public`, `modules`, `name`, `price_monthly`, `price_yearly`, `sort`, `tagline` |
| `roles` | 242 | 168.7 | `_id`, `code`, `company_id`, `created_at`, `is_system`, `name`, `permissions` |
| `user_invites` | 3 | 1.9 | `_id`, `accepted_at`, `company_id`, `company_name`, `created_at`, `email`, `employee_id`, `expires_at`, `invited_by`, `link`, `mail`, `name` |
| `platform_settings` | 1 | 1.0 | `_id`, `ai`, `brand_name`, `created_at`, `currency`, `email_enabled`, `gib_packs`, `public_url`, `reminder_days`, `sender_company_id`, `support_email`, `support_phone` |
| `platform_mail_servers` | 1 | 0.4 | `_id`, `created_at`, `is_active`, `name`, `password_enc`, `provider`, `smtp_host`, `smtp_port`, `smtp_user`, `updated_at` |
| `platform_mailboxes` | 1 | 0.4 | `_id`, `allow_all_admins`, `allowed_user_ids`, `created_at`, `created_by`, `display_name`, `email`, `is_active`, `is_default`, `purposes`, `reply_to`, `server_id` |
| `upgrade_requests` | 2 | 0.7 | `_id`, `admin_note`, `company_id`, `company_name`, `created_at`, `message`, `modules`, `plan_id`, `plan_name`, `requested_by`, `resolved_at`, `status` |
| `login_attempts` | 13 | 2.0 | `_id`, `count`, `identifier`, `last_attempt` |

### Muhasebe

| collection | rows | KB | sample fields |
|---|---:|---:|---|
| `invoices` | 45 | 45.0 | `_id`, `company_id`, `contact_id`, `contact_name`, `created_at`, `currency`, `direction`, `discount_total`, `e_type`, `fx_rate`, `general_discount_amount`, `general_discount_rate` |
| `contacts` | 26 | 15.1 | `_id`, `b2b_discount`, `b2b_enabled`, `balance`, `category`, `company_id`, `created_at`, `credit_limit`, `currency`, `default_discount`, `email_opt_in`, `is_e_invoice_user` |
| `installments` | 8 | 3.9 | `_id`, `amount`, `company_id`, `contact_id`, `contact_name`, `created_at`, `direction`, `due_date`, `invoice_id`, `invoice_number`, `invoice_type`, `label` |
| `expenses` | 6 | 3.9 | `_id`, `account_id`, `account_name`, `amount`, `category`, `company_id`, `contact_id`, `contact_name`, `created_at`, `currency`, `date`, `description` |
| `expense_categories` | 1 | 0.1 | `_id`, `company_id`, `created_at`, `name` |
| `expense_budgets` | 1 | 0.2 | `_id`, `category`, `company_id`, `monthly_limit`, `updated_at` |
| `quotes` | 6 | 4.8 | `_id`, `company_id`, `contact_id`, `contact_name`, `created_at`, `currency`, `grand_total`, `images`, `invoice_id`, `issue_date`, `items`, `notes` |
| `trade_files` | 6 | 7.2 | `_id`, `amount_fx`, `amount_try`, `bl_awb`, `certificate`, `cif`, `company_id`, `contact_id`, `contact_name`, `container_no`, `country`, `created_at` |

### Finans

| collection | rows | KB | sample fields |
|---|---:|---:|---|
| `bank_accounts` | 13 | 4.3 | `_id`, `account_name`, `account_number`, `bank_name`, `company_id`, `created_at`, `currency`, `current_balance`, `iban`, `pos_commission_rate`, `type` |
| `bank_transactions` | 22 | 9.6 | `_id`, `account_id`, `account_name`, `amount`, `category`, `company_id`, `created_at`, `currency`, `date`, `description`, `partner_tx_id`, `source` |
| `partners` | 2 | 0.7 | `_id`, `balance`, `company_id`, `created_at`, `email`, `is_active`, `is_demo`, `name`, `phone`, `share_percent`, `total_capital_in`, `total_profit_share` |
| `partner_transactions` | 18 | 7.1 | `_id`, `amount`, `company_id`, `created_at`, `date`, `description`, `is_demo`, `is_paid`, `partner_id`, `partner_name`, `type` |
| `cash_approval_requests` | 4 | 2.7 | `_id`, `account_ids`, `approved_at`, `approved_by`, `approved_by_name`, `company_id`, `created_at`, `kind`, `payload`, `requested_by`, `requested_by_email`, `requested_by_name` |
| `fx_rates` | 3 | 1.0 | `_id`, `bulletin_url`, `buying`, `company_id`, `created_at`, `currency`, `date`, `name`, `rate`, `selling`, `source`, `unit` |
| `gib_wallets` | 4 | 0.6 | `_id`, `balance`, `created_at`, `updated_at` |
| `gib_credit_ledger` | 11 | 2.7 | `_id`, `company_id`, `created_at`, `credits`, `note`, `type`, `wallet_id` |

### Satış / sipariş

| collection | rows | KB | sample fields |
|---|---:|---:|---|
| `orders` | 32 | 28.4 | `_id`, `approved_at`, `channel`, `city`, `company_id`, `contact_id`, `contact_name`, `currency`, `customer_name`, `is_invoiced`, `items`, `order_date` |
| `order_pick_sessions` | 10 | 8.8 | `_id`, `city`, `company_id`, `complete_mode`, `completed_at`, `created_at`, `customer_name`, `items`, `last_scan`, `notified_missing_at`, `order_id`, `order_number` |
| `projects` | 1 | 0.6 | `_id`, `address`, `budget`, `company_id`, `contact_id`, `contact_name`, `created_at`, `description`, `end_date`, `images`, `invoice_id`, `invoice_number` |
| `surveys` | 5 | 2.7 | `_id`, `address`, `assigned_to`, `company_id`, `contact_id`, `contact_name`, `created_at`, `images`, `latitude`, `location_url`, `longitude`, `measurements` |
| `cargo_configs` | 4 | 1.1 | `_id`, `api_password`, `api_username`, `auto_create_barcode`, `carrier_code`, `carrier_name`, `company_id`, `customer_number`, `is_active`, `is_demo`, `status` |
| `cargo_shipments` | 1 | 0.4 | `_id`, `address`, `barcode`, `carrier_code`, `carrier_name`, `city`, `company_id`, `customer_name`, `estimated_delivery`, `is_live`, `shipment_date`, `status` |

### Stok / üretim

| collection | rows | KB | sample fields |
|---|---:|---:|---|
| `products` | 18 | 11.2 | `_id`, `barcode`, `category`, `company_id`, `created_at`, `currency`, `has_recipe`, `has_variants`, `images`, `is_active`, `min_stock_alert`, `name` |
| `product_categories` | 5 | 0.7 | `_id`, `company_id`, `created_at`, `name` |
| `units` | 86 | 8.0 | `_id`, `company_id`, `name` |
| `warehouses` | 4 | 1.0 | `_id`, `code`, `company_id`, `created_at`, `is_default`, `is_demo`, `location`, `manager_name`, `name` |
| `stock_movements` | 27 | 8.2 | `_id`, `change`, `date`, `new_stock`, `product_id`, `product_name`, `reason`, `variant_id`, `variant_name` |
| `stock_counts` | 2 | 1.0 | `_id`, `company_id`, `completed_at`, `created_at`, `items`, `name`, `status`, `warehouse_id`, `warehouse_name` |
| `recipes` | 4 | 3.0 | `_id`, `code`, `company_id`, `created_at`, `finished_product_id`, `finished_product_name`, `is_active`, `labor_cost`, `material_cost`, `materials`, `name`, `notes` |
| `production_orders` | 3 | 1.9 | `_id`, `company_id`, `completed_quantity`, `created_at`, `end_date`, `finished_product_id`, `finished_product_name`, `notes`, `order_code`, `planned_date`, `planned_quantity`, `recipe_id` |
| `work_orders` | 3 | 2.5 | `_id`, `assigned_name`, `assigned_to`, `company_id`, `created_at`, `duration_min`, `finished_at`, `logs`, `notes`, `operator_name`, `order_code`, `order_id` |
| `label_templates` | 1 | 0.9 | `_id`, `company_id`, `created_at`, `elements`, `height_mm`, `is_default`, `name`, `page`, `width_mm` |

### İK

| collection | rows | KB | sample fields |
|---|---:|---:|---|
| `employees` | 3 | 1.7 | `_id`, `annual_leave_days`, `company_id`, `created_at`, `department`, `email`, `full_name`, `is_demo`, `meal_allowance`, `phone`, `position`, `salary` |
| `payrolls` | 5 | 2.7 | `_id`, `advance_payment`, `bonus`, `company_id`, `created_at`, `deduction`, `employee_id`, `employee_name`, `final_payable`, `gross_salary`, `is_demo`, `net_salary` |
| `leave_requests` | 4 | 1.5 | `_id`, `company_id`, `created_at`, `days`, `decided_at`, `decision_note`, `employee_id`, `employee_name`, `end_date`, `reason`, `start_date`, `status` |
| `bonus_payments` | 2 | 0.7 | `_id`, `account_id`, `account_name`, `amount`, `company_id`, `created_at`, `employee_id`, `employee_name`, `is_official`, `note`, `period`, `status` |
| `attendance_alerts` | 2 | 0.3 | `_id`, `company_id`, `created_at`, `type` |

### Entegrasyon

| collection | rows | KB | sample fields |
|---|---:|---:|---|
| `integration_configs` | 7 | 3.1 | `_id`, `api_key`, `api_secret`, `auto_create_invoice`, `auto_sync_orders`, `auto_sync_stock`, `channel`, `channel_name`, `company_id`, `is_active`, `is_demo`, `last_synced_at` |
| `einvoice_settings` | 2 | 0.8 | `_id`, `alias`, `api_url`, `assigned_at`, `company_id`, `corporate_code`, `mode`, `password_enc`, `provider`, `status`, `updated_at`, `username` |
| `migration_api_configs` | 1 | 0.5 | `_id`, `company_id`, `firm_id`, `last_test`, `provider`, `token_enc`, `token_tail`, `updated_at` |
| `migration_api_cache` | 1 | 1052.2 | `_id`, `company_id`, `fetched_at`, `items`, `kind`, `provider` |

### Sistem

| collection | rows | KB | sample fields |
|---|---:|---:|---|
| `activity_logs` | 676 | 210.6 | `_id`, `company_id`, `created_at`, `ip`, `method`, `module`, `path`, `status`, `user_id`, `user_name` |
| `notifications` | 42 | 16.5 | `_id`, `company_id`, `created_at`, `is_read`, `message`, `ref_id`, `ref_type`, `title`, `type` |
| `trash` | 95 | 99.2 | `_id`, `collection`, `company_id`, `deleted_at`, `deleted_by`, `doc`, `entity_type`, `expires_at`, `label`, `note`, `related` |
| `counters` | 21 | 1.0 | `_id`, `seq` |

## Application indexes (`meta_indexes`)

These are **not** InnoDB indexes (except `users.email` uniqueness checked in app).
They prevent duplicate JSON documents on write.

| collection | name | unique | fields |
|---|---|---|---|
| `contacts` | `tax_number_or_id` | False | `tax_number_or_id` |
| `invoices` | `invoice_number` | False | `invoice_number` |
| `login_attempts` | `identifier` | False | `identifier` |
| `orders` | `order_number` | False | `order_number` |
| `products` | `barcode` | False | `barcode` |
| `products` | `sku` | False | `sku` |
| `users` | `email` | True | `email` |

## Query pattern

1. `SELECT doc FROM docs WHERE collection=? [AND company_id=?]`
2. Filter/sort remaining predicates in Python (`match_query` / `sort_docs`).
3. Writes: `INSERT` / `REPLACE` / `DELETE` on `(collection, id)`.

See `docs/mysql-performance-report.md` for load, buffer pool, and scaling.
