# Dedicated depo denetimi

Matek (`comp_505a96e8`) ve Ersay Home (`comp_9039c0ec`) dedicated kipe geçince
`company_id` taşımayan sorgular paylaşılan katalogda kalır. Dedicated satır
okunmaz (404: Sipariş/Fatura/E-belge bulunamadı) ya da silme `deleted_count=0`
döner ve API başarı gibi görünür.

Router yalnız düz `company_id` görünce dedicated / shared_v2 deposuna gider.
Legacy kip ve router kapalıyken sorgu eskisi gibi yalnız `_id` olabilir;
bu PR o yolda 0 satırı hata saymaz.

## Bu PR'de kapananlar

#1564 çöp silmeyi ve banka/ortak silme uçlarını company_id ile yapar: silinen satır 0 ise 409, bakiye `_snapshot` / `_rewind_delete` / `_abort_failed_effect` ile geri alınır. Bu dal o akışı değiştirmez.

| Konu | Yer | Risk | Düzeltme |
| --- | --- | --- | --- |
| Çöp ve hareket silme | backend/trash.py, delete_bank_transaction, delete_partner_transaction | — | #1564 davranışı durur (409, anlık görüntü, geri sarma). |
| Cari ödeme bakiyesi dedicated depoda | backend/server.py create_bank_transaction ve #1564 silme ucu | P0 yazma | Oluşturma company_id ile gider. Silme #1564 sırasını kullanır: önce çöp, sonra bakiye. |
| Fatura ve taksit ödemesi telafi silmesi `_id` | backend/server.py _record_invoice_payment_core, pay_installment, unpay_installment | P0 yazma | Sorgu ve telafi `company_id` taşır. unpay aynı şirketin taksitini ve fatura sayacını günceller. 0 eşleşme dedicated'de 404. |
| Cari ortak ödemesi ve virman carisi | backend/server.py _execute_contact_partner_payment, _virman_load_contact | P0 | Aktif company_id ile okunur. Legacy/router kapalıyken company_id'siz eski cari `_id` yedeği durur. |
| Bağlı masraf başka şirketten silinebiliyordu | backend/server.py _linked_expense_related | P0 okuma | company_id varsa masraf onunla okunur. Legacy/router kapalıyken eski `_id` yedeği durur. |
| POS kasa bakiyesi katalogda kalıyordu | backend/server.py _pos_checkout_core | P0 yazma | Ürün, lot ve kasa güncellemesi company_id ile. Legacy üründe `_id` yedeği durur. recalc company_id alır. |
| Prim / bordro telafi silmesi `_id` | backend/server.py create_bonus, bordro _body | P0 yazma | Hesap ve telafi silmesi company_id ile. |
| POS bakiye hareket toplamından kopuktu | backend/account_balance.py overlay_pos_movement_balances | P0 okuma | Liste cevabı opening dahil hareket toplamı. Yalnız gösterim; entegre POS/ÖKC dışarıda. Tavan aşılırsa örtü yok. persist yok. pos_settlement kayıtlı bakiyeye bakar. |
| Ay giriş/çıkış virmanı saymıyordu | backend/bank_rematch.py attach_month_totals | P0 okuma | Mevcut aggregate durur. type=transfer kaynak çıkış, hedef giriş. POS bloke outflow aggregate'te, ikinci kez eklenmez. |
| Açılış bakiyesi ve borç/alacak fişi | backend/server.py clear_contact_opening_balance, create_contact_ledger_slip | P0 yazma | Cari güncellemesi company_id ile. |

Veri taşınmadı. `current_balance` diske yazılmadı (POS örtüsü `persist=False`).
`rbac.py`, `addons.py`, `deploy/` ve storage router dosyalarına dokunulmadı.

## Bilinçli olarak bırakılanlar

- `server.py` içinde `_guard_effect_storage` (`storage_dedicated.collection`, fatura etkisi) dedicated deposunu bilerek yoklar. Hata değil.
- POS iade (`_pos_return_core`) kasa ve cari güncellemesi hâlâ `_id`. İade faturası işaretleri (#1562) ile aynı bölge; bu PR oraya girmedi.
- `account_balance._lookup_company_id` hâlâ `_id` ile hesap okur. Çağıran company_id verirse kullanılmaz. Dedicated hesap katalogda yoksa bağlantı görülmez ve manuel işleme izin çıkar.
- `tenant_access.get_tenant_doc` önce şirket deposuna bakar; olmazsa katalog `_id` yedeği durur. `get_tenant_child` hâlâ yalnız `_id`.
- Ortak hareketi silinirken (#1564) kayıt önce çöpe alınır, sonra kasa etkisi geri sarılır. Etki yarıda kalırsa `_abort_failed_effect` anlık görüntüye döner.
- `tenant_access.delete_many_company` kısmi silmede (bazı id'ler silindi) hata vermez. Çöp yolu bunu kullanmaz; #1564 bağlı kaydı şirket şirket siler ve 0 satırı loglar.
- Entegre banka ve entegre POS/ÖKC bakiyesi bankanın bildirdiği tutardır; örtü onlara yazılmaz. Örtü yalnız manuel POS/ÖKC cevabını değiştirir. `pos_settlement.apply` brüt eşiği kayıtlı `current_balance` üzerindedir.
- `_reverse_tx_effects` yetim cari/hesapta susar ve loglar. `matched_count==0` iken belge hâlâ duruyorsa yazılan bakiyeyi geri alır ve 404 verir. Hareket güncelleme ve çöp geri yükleme bu hatada anlık görüntüye döner.
- Kalan `_id` sorguları aşağıdaki listede ve `dedicated_id_allowlist.py` içindedir. Yeni `_id`-only çağrı CI'da kırmızıya düşer.

## Kalan yalnız-`_id` çağrıları

Toplam 212 çağrı, rbac/addons hariç (onlar dondurulmuş listededir).

| Öncelik | Koleksiyon | Yer | Okuma/yazma | Risk | Düzeltme |
| --- | --- | --- | --- | --- | --- |
| P0 | bank_transactions | backend/bank_match_desc.py:159 migrate_match_descriptions update_one | yazma | yüksek — bakiye veya kayıt kaçar | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P0 | bank_transactions | backend/bank_match_desc.py:179 migrate_match_descriptions update_one | yazma | yüksek — bakiye veya kayıt kaçar | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P0 | (dinamik) | backend/company_audit.py:777 purge_expired delete_one | yazma | yüksek — bakiye veya kayıt kaçar | Dinamik silme/güncelleme company_id ile gitmeli; 0 satır hata dönmeli. |
| P0 | (dinamik) | backend/einvoice_designs.py:827 _update_design_impl update_one | yazma | yüksek — bakiye veya kayıt kaçar | Dinamik silme/güncelleme company_id ile gitmeli; 0 satır hata dönmeli. |
| P0 | (dinamik) | backend/einvoice_designs.py:866 _unselect_scope update_one | yazma | yüksek — bakiye veya kayıt kaçar | Dinamik silme/güncelleme company_id ile gitmeli; 0 satır hata dönmeli. |
| P0 | (dinamik) | backend/einvoice_designs.py:884 _select_scoped update_one | yazma | yüksek — bakiye veya kayıt kaçar | Dinamik silme/güncelleme company_id ile gitmeli; 0 satır hata dönmeli. |
| P0 | (dinamik) | backend/einvoice_designs.py:892 _select_scoped update_one | yazma | yüksek — bakiye veya kayıt kaçar | Dinamik silme/güncelleme company_id ile gitmeli; 0 satır hata dönmeli. |
| P0 | (dinamik) | backend/einvoice_designs.py:1012 _delete_scoped delete_one | yazma | yüksek — bakiye veya kayıt kaçar | Dinamik silme/güncelleme company_id ile gitmeli; 0 satır hata dönmeli. |
| P0 | (dinamik) | backend/einvoice_designs.py:1018 _delete_scoped delete_one | yazma | yüksek — bakiye veya kayıt kaçar | Dinamik silme/güncelleme company_id ile gitmeli; 0 satır hata dönmeli. |
| P0 | (dinamik) | backend/einvoice_designs.py:1176 select_company_design update_one | yazma | yüksek — bakiye veya kayıt kaçar | Dinamik silme/güncelleme company_id ile gitmeli; 0 satır hata dönmeli. |
| P0 | (dinamik) | backend/einvoice_designs.py:1188 import_company_design update_one | yazma | yüksek — bakiye veya kayıt kaçar | Dinamik silme/güncelleme company_id ile gitmeli; 0 satır hata dönmeli. |
| P0 | (dinamik) | backend/einvoice_designs.py:1209 delete_company_design delete_one | yazma | yüksek — bakiye veya kayıt kaçar | Dinamik silme/güncelleme company_id ile gitmeli; 0 satır hata dönmeli. |
| P0 | (dinamik) | backend/mobile_logs.py:143 delete_mobile_log delete_one | yazma | yüksek — bakiye veya kayıt kaçar | Dinamik silme/güncelleme company_id ile gitmeli; 0 satır hata dönmeli. |
| P0 | invoices | backend/saas_extras.py:410 issue_subscription_invoice update_one | yazma | yüksek — bakiye veya kayıt kaçar | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P0 | contacts | backend/server.py:5506 create_statement_link update_one | yazma | yüksek — bakiye veya kayıt kaçar | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P0 | contacts | backend/server.py:7765 _execute_contact_partner_payment update_one | yazma | yüksek — bakiye veya kayıt kaçar | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P0 | invoices | backend/server.py:9090 _pos_return_core update_one | yazma | yüksek — bakiye veya kayıt kaçar | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P0 | invoices | backend/server.py:9147 _body delete_one | yazma | yüksek — bakiye veya kayıt kaçar | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P0 | invoices | backend/server.py:9148 _body update_one | yazma | yüksek — bakiye veya kayıt kaçar | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P0 | invoices | backend/server.py:9163 _pos_return_core update_one | yazma | yüksek — bakiye veya kayıt kaçar | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P0 | contacts | backend/server.py:9172 _pos_return_core update_one | yazma | yüksek — bakiye veya kayıt kaçar | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P0 | bank_accounts | backend/server.py:9183 _pos_return_core update_one | yazma | yüksek — bakiye veya kayıt kaçar | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P0 | bank_accounts | backend/server.py:9299 _pos_do_cancel_sale update_one | yazma | yüksek — bakiye veya kayıt kaçar | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P0 | installments | backend/server.py:12689 unpay_installment update_one | yazma | yüksek — bakiye veya kayıt kaçar | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P0 | invoices | backend/server.py:12695 unpay_installment update_one | yazma | yüksek — bakiye veya kayıt kaçar | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P0 | cash_approval_requests | backend/server.py:15115 approve_cash_request update_one | yazma | yüksek — bakiye veya kayıt kaçar | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P0 | bank_accounts | backend/server.py:20707 _post_marketplace_settlement update_one | yazma | yüksek — bakiye veya kayıt kaçar | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P0 | contacts | backend/server.py:20710 _post_marketplace_settlement update_one | yazma | yüksek — bakiye veya kayıt kaçar | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P0 | contacts | backend/server.py:20739 _post_marketplace_settlement update_one | yazma | yüksek — bakiye veya kayıt kaçar | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P0 | invoices | backend/server.py:20742 _post_marketplace_settlement update_one | yazma | yüksek — bakiye veya kayıt kaçar | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P0 | contacts | backend/server.py:20778 _post_marketplace_settlement update_one | yazma | yüksek — bakiye veya kayıt kaçar | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P0 | bank_accounts | backend/server.py:20847 _reverse_marketplace_settlement update_one | yazma | yüksek — bakiye veya kayıt kaçar | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P0 | contacts | backend/server.py:20853 _reverse_marketplace_settlement update_one | yazma | yüksek — bakiye veya kayıt kaçar | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P0 | invoices | backend/server.py:23200 convert_order_to_invoice update_one | yazma | yüksek — bakiye veya kayıt kaçar | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P0 | invoices | backend/server.py:23215 convert_order_to_invoice update_one | yazma | yüksek — bakiye veya kayıt kaçar | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P0 | partners | backend/server.py:28438 _restore_partner_tx update_one | yazma | yüksek — bakiye veya kayıt kaçar | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P0 | partners | backend/server.py:28440 _restore_partner_tx update_one | yazma | yüksek — bakiye veya kayıt kaçar | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P0 | bank_accounts | backend/server.py:28469 _restore_bonus update_one | yazma | yüksek — bakiye veya kayıt kaçar | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P0 | bank_accounts | backend/server.py:28506 _restore_payroll update_one | yazma | yüksek — bakiye veya kayıt kaçar | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P0 | (dinamik) | backend/storage_admin.py:221 _save update_one | yazma | yüksek — bakiye veya kayıt kaçar | Dinamik silme/güncelleme company_id ile gitmeli; 0 satır hata dönmeli. |
| P0 | (dinamik) | backend/storage_admin.py:421 _prune_snapshots delete_one | yazma | yüksek — bakiye veya kayıt kaçar | Dinamik silme/güncelleme company_id ile gitmeli; 0 satır hata dönmeli. |
| P0 | (dinamik) | backend/storage_admin.py:574 _running update_one | yazma | yüksek — bakiye veya kayıt kaçar | Dinamik silme/güncelleme company_id ile gitmeli; 0 satır hata dönmeli. |
| P0 | (dinamik) | backend/storage_admin.py:1172 cancel_job update_one | yazma | yüksek — bakiye veya kayıt kaçar | Dinamik silme/güncelleme company_id ile gitmeli; 0 satır hata dönmeli. |
| P0 | (dinamik) | backend/storage_admin.py:1178 _set_progress update_one | yazma | yüksek — bakiye veya kayıt kaçar | Dinamik silme/güncelleme company_id ile gitmeli; 0 satır hata dönmeli. |
| P0 | (dinamik) | backend/storage_admin.py:1222 execute update_one | yazma | yüksek — bakiye veya kayıt kaçar | Dinamik silme/güncelleme company_id ile gitmeli; 0 satır hata dönmeli. |
| P0 | (dinamik) | backend/storage_admin.py:1253 execute update_one | yazma | yüksek — bakiye veya kayıt kaçar | Dinamik silme/güncelleme company_id ile gitmeli; 0 satır hata dönmeli. |
| P0 | (dinamik) | backend/storage_admin.py:1289 claim_next update_one | yazma | yüksek — bakiye veya kayıt kaçar | Dinamik silme/güncelleme company_id ile gitmeli; 0 satır hata dönmeli. |
| P0 | (dinamik) | backend/trash.py:115 _delete_ids delete_one | yazma | yüksek — bakiye veya kayıt kaçar | Dinamik silme/güncelleme company_id ile gitmeli; 0 satır hata dönmeli. |
| P0 | (dinamik) | backend/trash.py:119 _delete_ids delete_many | yazma | yüksek — bakiye veya kayıt kaçar | Dinamik silme/güncelleme company_id ile gitmeli; 0 satır hata dönmeli. |
| P1 | bank_accounts | backend/account_balance.py:292 _lookup_company_id find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | bank_accounts | backend/account_balance.py:295 _lookup_company_id find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | contacts | backend/b2b_identity.py:915 _stored_contact_links find | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | bank_accounts | backend/balance_reconciliation.py:154 conflicting_connection_iban find | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | bank_accounts | backend/bank_guard.py:102 assert_collection_allowed find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | (dinamik) | backend/company_audit.py:423 prepare find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | (dinamik) | backend/company_audit.py:482 commit_from_request find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | invoices | backend/e_invoice.py:1834 _require_einvoice_access find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | (dinamik) | backend/einvoice_designs.py:284 ensure_defaults find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | (dinamik) | backend/einvoice_designs.py:597 _get find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | partners | backend/partner_pay.py:583 _partner_company_id find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | partners | backend/partner_pay.py:590 _partner_company_id find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | partners | backend/partner_pay.py:639 sync_partner_from_ledger find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | invoices | backend/saas_docs.py:179 _require_invoice_doc_access find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | contacts | backend/saas_docs.py:312 invoice_pdf find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | quotes | backend/saas_docs.py:568 quote_pdf find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | employees | backend/seed_data.py:905 seed_shopfloor_pins find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | contacts | backend/server.py:5475 _statement_bundle find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | employees | backend/server.py:6454 _notify_new_task_assignees find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | contacts | backend/server.py:7739 _execute_contact_partner_payment find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | invoices | backend/server.py:8364 convert_purchase_order_to_invoice find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | invoices | backend/server.py:9212 _pos_return_core find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | products | backend/server.py:9523 _store_product_image_bytes find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | bank_accounts | backend/server.py:13310 _save_signed_opening_balance find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | (dinamik) | backend/server.py:13860 _ensure_company_doc find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | bank_accounts | backend/server.py:15197 list_bank_connections find | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | bank_accounts | backend/server.py:15331 test_bank_connection find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | contacts | backend/server.py:15350 _suggest_contact find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | invoices | backend/server.py:19420 create_dispatch find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | contacts | backend/server.py:19712 accountant_export find | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | bank_accounts | backend/server.py:20662 _post_marketplace_settlement find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | bank_transactions | backend/server.py:20821 _reverse_marketplace_settlement find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | expenses | backend/server.py:20865 _reverse_marketplace_settlement find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | invoices | backend/server.py:22967 _annotate_orders_invoice_mismatch find | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | invoices | backend/server.py:23197 convert_order_to_invoice find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | invoices | backend/server.py:23229 convert_order_to_invoice find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | orders | backend/server.py:23303 convert_order_to_invoice find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | products | backend/server.py:24724 _enrich_work_orders_job_fields find | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | bank_accounts | backend/server.py:26209 _assert_salary_bank_only find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | employees | backend/server.py:26304 _employee_assigned_work find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | employees | backend/server.py:27120 upload_my_task_photo find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | employees | backend/server.py:27411 _pay_payroll_core find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | bank_accounts | backend/server.py:28427 _restore_bank_tx find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | bank_accounts | backend/server.py:28468 _restore_bonus find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | bank_accounts | backend/server.py:28505 _restore_payroll find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | orders | backend/server.py:28550 _restore_invoice find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | employees | backend/server.py:28582 _restore_assigned_task find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | (dinamik) | backend/tenant_access.py:125 get_tenant_doc find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | (dinamik) | backend/tenant_access.py:183 get_tenant_child find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | (dinamik) | backend/trash.py:246 _live_doc find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | contacts | backend/ubl_export.py:1323 invoice_xml_payload find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | employees | backend/user_erase.py:82 _linked_employee find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | orders | backend/warehouse_ship.py:122 apply_warehouse_ship find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | orders | backend/warehouse_ship.py:132 apply_warehouse_ship find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P1 | orders | backend/warehouse_ship.py:144 apply_warehouse_ship find_one | okuma | orta — 404 veya yanlış şirket | Okumayı aktif company_id ile router üzerinden yap. |
| P2 | b2b_password_resets | backend/b2b_identity.py:1513 finish_b2b_forgot update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | trash | backend/company_audit.py:428 prepare find_one | okuma | düşük — kenar yol | Okumayı aktif company_id ile router üzerinden yap. |
| P2 | company_notify_tenant | backend/event_notify.py:611 save_tenant_prefs update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | notify_sms_daily | backend/event_notify.py:985 _inc_sms_daily update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | fx_rates | backend/fx.py:146 _upsert_rates update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | idempotency_keys | backend/idempotency.py:345 purge_expired delete_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | push_receipts_pending | backend/notify.py:1291 remember_push_receipts update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | orders | backend/order_time.py:265 collect_order_date_fixes update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | idempotency_keys | backend/platform_admin_v1_write.py:281 _write find_one | okuma | düşük — kenar yol | Okumayı aktif company_id ile router üzerinden yap. |
| P2 | products | backend/saas.py:411 seed update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | password_resets | backend/saas.py:1312 send_password_reset_for update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | upgrade_requests | backend/saas.py:1884 apply_upgrade_resolution find_one | okuma | düşük — kenar yol | Okumayı aktif company_id ile router üzerinden yap. |
| P2 | employees | backend/seed_data.py:907 seed_shopfloor_pins update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | password_resets | backend/server.py:4305 _forgot_sms_deliver update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | password_resets | backend/server.py:4429 erp_forgot_password update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | password_resets | backend/server.py:4438 _erp_reset_doc find_one | okuma | düşük — kenar yol | Okumayı aktif company_id ile router üzerinden yap. |
| P2 | password_resets | backend/server.py:4472 erp_reset_post update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | b2b_password_resets | backend/server.py:5784 b2b_reset_post update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | b2b_password_resets | backend/server.py:5792 _b2b_reset_doc find_one | okuma | düşük — kenar yol | Okumayı aktif company_id ile router üzerinden yap. |
| P2 | payment_intents | backend/server.py:7368 finalize_b2b_order_payment find_one | okuma | düşük — kenar yol | Okumayı aktif company_id ile router üzerinden yap. |
| P2 | purchase_orders | backend/server.py:8401 convert_purchase_order_to_invoice update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | products | backend/server.py:9100 _body update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | products | backend/server.py:9107 _undo_stock update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | products | backend/server.py:9522 _store_product_image_bytes update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | quotes | backend/server.py:12706 set_quote_payment_plan update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | quotes | backend/server.py:12710 set_quote_payment_plan update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | trash | backend/server.py:13873 _drop_trash_row delete_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | bank_connections | backend/server.py:15317 delete_bank_connection delete_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | bank_connections | backend/server.py:15344 test_bank_connection update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | bank_connections | backend/server.py:15379 _sync_bank_connection_core find_one | okuma | düşük — kenar yol | Okumayı aktif company_id ile router üzerinden yap. |
| P2 | sms_settings | backend/server.py:17086 _sms_settings_view update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | sms_settings | backend/server.py:17182 _sms_creds update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | mail_logs | backend/server.py:17405 mail_open_pixel find_one | okuma | düşük — kenar yol | Okumayı aktif company_id ile router üzerinden yap. |
| P2 | mail_logs | backend/server.py:17408 mail_open_pixel update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | employees | backend/server.py:17867 _restore_approved_annual_leave update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | orders | backend/server.py:18666 _create_draft_invoice_for_order update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | orders | backend/server.py:19474 create_dispatch update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | orders | backend/server.py:19925 _collapse_marketplace_order_dupes delete_many | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | orders | backend/server.py:20779 _post_marketplace_settlement update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | orders | backend/server.py:20879 _reverse_marketplace_settlement update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | integration_configs | backend/server.py:20978 add_ecommerce_channel find_one | okuma | düşük — kenar yol | Okumayı aktif company_id ile router üzerinden yap. |
| P2 | integration_configs | backend/server.py:21002 _sync_ecommerce_channel_core find_one | okuma | düşük — kenar yol | Okumayı aktif company_id ile router üzerinden yap. |
| P2 | integration_configs | backend/server.py:21212 set_channel_fees update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | integration_configs | backend/server.py:21213 set_channel_fees find_one | okuma | düşük — kenar yol | Okumayı aktif company_id ile router üzerinden yap. |
| P2 | label_templates | backend/server.py:21305 update_label_template update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | label_templates | backend/server.py:21306 update_label_template find_one | okuma | düşük — kenar yol | Okumayı aktif company_id ile router üzerinden yap. |
| P2 | label_templates | backend/server.py:21311 delete_label_template delete_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | marketplace_claims | backend/server.py:22015 approve_marketplace_claim update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | marketplace_claims | backend/server.py:22024 approve_marketplace_claim find_one | okuma | düşük — kenar yol | Okumayı aktif company_id ile router üzerinden yap. |
| P2 | marketplace_claims | backend/server.py:22046 reject_marketplace_claim update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | marketplace_claims | backend/server.py:22055 reject_marketplace_claim find_one | okuma | düşük — kenar yol | Okumayı aktif company_id ile router üzerinden yap. |
| P2 | orders | backend/server.py:22935 list_orders delete_many | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | orders | backend/server.py:22937 list_orders delete_many | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | orders | backend/server.py:23298 convert_order_to_invoice update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | production_orders | backend/server.py:24660 _filter_active_production_work_orders find | okuma | düşük — kenar yol | Okumayı aktif company_id ile router üzerinden yap. |
| P2 | work_orders | backend/server.py:24803 _enrich_work_orders_job_fields update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | work_orders | backend/server.py:24806 _enrich_work_orders_job_fields update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | work_orders | backend/server.py:24809 _enrich_work_orders_job_fields update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | work_orders | backend/server.py:24962 _apply_shopfloor_station_grouping update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | recipes | backend/server.py:25014 generate_work_orders_for_order find_one | okuma | düşük — kenar yol | Okumayı aktif company_id ile router üzerinden yap. |
| P2 | production_orders | backend/server.py:25523 _soft_trash_work_order_cascade find_one | okuma | düşük — kenar yol | Okumayı aktif company_id ile router üzerinden yap. |
| P2 | recipes | backend/server.py:25703 update_production_order find_one | okuma | düşük — kenar yol | Okumayı aktif company_id ile router üzerinden yap. |
| P2 | recipes | backend/server.py:25723 update_production_order find_one | okuma | düşük — kenar yol | Okumayı aktif company_id ile router üzerinden yap. |
| P2 | production_orders | backend/server.py:25730 update_production_order update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | production_orders | backend/server.py:25734 update_production_order find_one | okuma | düşük — kenar yol | Okumayı aktif company_id ile router üzerinden yap. |
| P2 | production_orders | backend/server.py:25742 update_production_order find_one | okuma | düşük — kenar yol | Okumayı aktif company_id ile router üzerinden yap. |
| P2 | recipes | backend/server.py:25792 produce_production_order_shortages find_one | okuma | düşük — kenar yol | Okumayı aktif company_id ile router üzerinden yap. |
| P2 | production_orders | backend/server.py:25796 produce_production_order_shortages update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | production_orders | backend/server.py:25834 produce_production_order_shortages update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | recipes | backend/server.py:25894 _complete_production_order_core find_one | okuma | düşük — kenar yol | Okumayı aktif company_id ile router üzerinden yap. |
| P2 | products | backend/server.py:25926 _complete_production_order_core update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | products | backend/server.py:25943 _complete_production_order_core update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | products | backend/server.py:25945 _complete_production_order_core update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | production_orders | backend/server.py:25973 _complete_production_order_core update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | products | backend/server.py:25985 _complete_production_order_core update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | employees | backend/server.py:26910 complete_my_assigned_task update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | projects | backend/server.py:26924 complete_my_assigned_task update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | employees | backend/server.py:26927 complete_my_assigned_task update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | projects | backend/server.py:26989 trash_completed_employee_tasks update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | employees | backend/server.py:26998 trash_completed_employee_tasks update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | employees | backend/server.py:27036 update_employee_assigned_task update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | projects | backend/server.py:27048 update_employee_assigned_task update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | employees | backend/server.py:27052 update_employee_assigned_task update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | employees | backend/server.py:27080 delete_employee_assigned_task update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | projects | backend/server.py:27096 delete_employee_assigned_task update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | employees | backend/server.py:27099 delete_employee_assigned_task update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | employees | backend/server.py:27167 upload_my_task_photo update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | projects | backend/server.py:27191 upload_my_task_photo update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | projects | backend/server.py:27206 upload_my_task_photo find_one | okuma | düşük — kenar yol | Okumayı aktif company_id ile router üzerinden yap. |
| P2 | projects | backend/server.py:27229 set_stage_photo_visibility update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | files | backend/server.py:27240 delete_file_record update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | employees | backend/server.py:28449 _restore_leave update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | orders | backend/server.py:28552 _restore_invoice update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | projects | backend/server.py:28574 _restore_assigned_task find_one | okuma | düşük — kenar yol | Okumayı aktif company_id ile router üzerinden yap. |
| P2 | projects | backend/server.py:28580 _restore_assigned_task update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | employees | backend/server.py:28588 _restore_assigned_task update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | assigned_tasks | backend/server.py:28590 _restore_assigned_task delete_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | shopfloor_device_codes | backend/shopfloor_devices.py:525 _claim_pairing_code find_one | okuma | düşük — kenar yol | Okumayı aktif company_id ile router üzerinden yap. |
| P2 | storage_folders | backend/storage_manager.py:123 ensure_account_folders find_one | okuma | düşük — kenar yol | Okumayı aktif company_id ile router üzerinden yap. |
| P2 | storage_folders | backend/storage_manager.py:141 ensure_account_folders update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | storage_folders | backend/storage_manager.py:142 ensure_account_folders find_one | okuma | düşük — kenar yol | Okumayı aktif company_id ile router üzerinden yap. |
| P2 | trash | backend/trash.py:101 _rollback_new_trash delete_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | employees | backend/user_erase.py:180 apply_erase update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |
| P2 | payment_intents | backend/vpos/api.py:1034 vpos_callback find_one | okuma | düşük — kenar yol | Okumayı aktif company_id ile router üzerinden yap. |
| P2 | vpos_configs | backend/vpos/api.py:1112 paytr_notify find_one | okuma | düşük — kenar yol | Okumayı aktif company_id ile router üzerinden yap. |
| P2 | payment_intents | backend/vpos/api.py:1171 iyzico_callback find_one | okuma | düşük — kenar yol | Okumayı aktif company_id ile router üzerinden yap. |
| P2 | payment_intents | backend/vpos/api.py:1241 _kuveytturk_return find_one | okuma | düşük — kenar yol | Okumayı aktif company_id ile router üzerinden yap. |
| P2 | orders | backend/warehouse_ship.py:131 apply_warehouse_ship update_one | yazma | düşük — kenar yol | Sorguya company_id ekle. Dedicated/shared_v2'de 0 eşleşme hata. Legacy `_id` kalsın. |

Özet: P0 49, P1 55, P2 108.

## company_id'si görünmeyen diğer kiracı çağrıları

Bunlar saf `{_id}` olmayabilir (`$or`, değişken sorgu, insert). Statik tarama `missing` / `unclear`.
Tam taban `backend/tenant_scope_allowlist.py`. Aşağısı finans ve stok yüzeyi.

| Durum | Koleksiyon | Yer | Okuma/yazma | Risk | Düzeltme |
| --- | --- | --- | --- | --- | --- |
| missing | cheques | backend/cheques.py:1179 cancel_promissory_for_installments find | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| missing | stock_movements | backend/company_reset.py:256 _count_stock_movements count_documents | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| missing | stock_movements | backend/company_reset.py:393 wipe_company_business_data delete_many | yazma | orta | company_id anahtarını sorgu veya belgeye koy. |
| missing | partner_transactions | backend/demo.py:217 tag_legacy_seed update_many | yazma | yüksek | company_id anahtarını sorgu veya belgeye koy. |
| missing | invoices | backend/e_invoice.py:112 migrate_mislabelled_paper_invoices find | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| missing | invoices | backend/e_invoice.py:125 migrate_mislabelled_paper_invoices update_one | yazma | yüksek | company_id anahtarını sorgu veya belgeye koy. |
| missing | invoices | backend/e_invoice.py:2472 refresh_outbound_statuses find | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| missing | employees | backend/employee_pay.py:421 accrue_due_for_all_companies find | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| missing | employees | backend/employee_pay.py:470 scheduler_loop find | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| unclear | orders | backend/order_list_page.py:193 fetch_order_rows find | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| missing | orders | backend/order_time.py:237 collect_order_date_fixes find | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| unclear | partner_transactions | backend/partner_tx_page.py:110 _load_partner_txs find | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| unclear | products | backend/pricing.py:173 build_summary find | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| unclear | products | backend/pricing.py:176 build_summary count_documents | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| unclear | products | backend/product_list_page.py:414 fetch_product_rows find | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| unclear | contacts | backend/saas_extras.py:374 issue_subscription_invoice insert_one | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| missing | quotes | backend/server.py:2897 public_quote find_one | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| missing | quotes | backend/server.py:2920 public_quote_respond find_one | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| unclear | orders | backend/server.py:4673 dashboard_ops_alerts_payload count_documents | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| unclear | orders | backend/server.py:4674 dashboard_ops_alerts_payload find | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| unclear | orders | backend/server.py:4678 dashboard_ops_alerts_payload count_documents | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| unclear | orders | backend/server.py:4679 dashboard_ops_alerts_payload find | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| unclear | orders | backend/server.py:4789 dashboard_tile_badges_payload count_documents | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| unclear | invoices | backend/server.py:4849 dashboard_stats_payload find | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| unclear | contacts | backend/server.py:5381 create_contact insert_one | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| missing | contacts | backend/server.py:5536 public_statement find_one | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| missing | contacts | backend/server.py:5548 public_statement_pdf find_one | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| unclear | products | backend/server.py:6139 _b2b_match_cart_items find | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| missing | contacts | backend/server.py:6363 _b2b_contact find_one | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| unclear | products | backend/server.py:6669 b2b_portal find | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| unclear | orders | backend/server.py:7037 b2b_upsert_active_cart insert_one | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| unclear | orders | backend/server.py:7103 b2b_hold_cart insert_one | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| unclear | installments | backend/server.py:7609 create_contact_balance_installments insert_many | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| unclear | purchase_orders | backend/server.py:8260 reorder_purchases insert_one | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| unclear | purchase_orders | backend/server.py:8336 create_purchase_order insert_one | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| unclear | products | backend/server.py:8438 create_product insert_one | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| unclear | products | backend/server.py:8502 copy_product insert_one | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| missing | invoices | backend/server.py:8569 _product_usage_labels find_one | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| missing | orders | backend/server.py:8571 _product_usage_labels find_one | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| missing | quotes | backend/server.py:8573 _product_usage_labels find_one | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| unclear | contacts | backend/server.py:8797 _pos_checkout_core insert_one | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| missing | invoices | backend/server.py:9082 _pos_return_core update_one_atomic | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| missing | bank_transactions | backend/server.py:9291 _pos_do_cancel_sale find | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| missing | bank_transactions | backend/server.py:9292 _pos_do_cancel_sale find_one | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| unclear | bank_transactions | backend/server.py:9298 _pos_do_cancel_sale insert_one | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| missing | products | backend/server.py:9322 list_product_movements find_one | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| missing | products | backend/server.py:9509 _store_product_image_bytes update_one | yazma | orta | company_id anahtarını sorgu veya belgeye koy. |
| unclear | partner_transactions | backend/server.py:12259 _body insert_one | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| unclear | partner_transactions | backend/server.py:12584 _body insert_one | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| unclear | bank_transactions | backend/server.py:12597 _body insert_one | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| missing | installments | backend/server.py:12694 unpay_installment count_documents | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| unclear | invoices | backend/server.py:12724 get_report find | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| unclear | bank_transactions | backend/server.py:13303 _save_signed_opening_balance insert_one | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| unclear | bank_transactions | backend/server.py:13414 save_opening_from_difference insert_one | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| unclear | bank_transactions | backend/server.py:14239 _insert_cari_virman_ledger_pair insert_many | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| missing | cash_approval_requests | backend/server.py:15096 approve_cash_request update_one | yazma | yüksek | company_id anahtarını sorgu veya belgeye koy. |
| missing | cash_approval_requests | backend/server.py:15145 reject_cash_request update_one | yazma | yüksek | company_id anahtarını sorgu veya belgeye koy. |
| missing | invoices | backend/server.py:18580 _create_draft_invoice_for_order find_one | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| unclear | expenses | backend/server.py:20754 _post_marketplace_settlement insert_one | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| missing | bank_transactions | backend/server.py:20817 _reverse_marketplace_settlement find | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| missing | expenses | backend/server.py:20829 _reverse_marketplace_settlement find | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| missing | invoices | backend/server.py:23156 update_order_status find_one | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| missing | orders | backend/server.py:23171 update_order_status update_one | yazma | orta | company_id anahtarını sorgu veya belgeye koy. |
| missing | orders | backend/server.py:23174 update_order_status find_one | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| missing | orders | backend/server.py:23176 update_order_status find_one | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| unclear | contacts | backend/server.py:23235 convert_order_to_invoice insert_one | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| missing | invoices | backend/server.py:23290 convert_order_to_invoice replace_one | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| missing | attendance | backend/server.py:24911 _shopfloor_require_mesaim_check_in find_one | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| missing | attendance | backend/server.py:24912 _shopfloor_require_mesaim_check_in find_one | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| missing | expenses | backend/server.py:26236 _employee_receivable find | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| missing | personnel_receipts | backend/server.py:26755 _employee_receipts find | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| unclear | orders | backend/server.py:27652 ai_order_confirm insert_one | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| unclear | products | backend/server.py:27799 ai_product_confirm insert_one | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| unclear | contacts | backend/server.py:28114 ai_invoice_confirm insert_one | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| missing | employees | backend/user_erase.py:84 _linked_employee find_one | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| missing | employees | backend/user_erase.py:86 _linked_employee find_one | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |
| missing | orders | backend/warehouse_ship.py:124 apply_warehouse_ship find_one | okuma | orta | company_id anahtarını sorgu veya belgeye koy. |

Bu tabloda 77 satır. Tüm missing/unclear (rbac/addons hariç): 282.

## Router dışı tutamak

| Yer | Risk | Not |
| --- | --- | --- |
| backend/server.py `_guard_effect_storage` `storage_dedicated.collection` | yok | Fatura etki koruması dedicated depoyu bilerek açar. |
| backend/storage_router.py, storage_dedicated.py, storage_shared_v2.py, mysql_store.py | yok | Depo uygulaması. #1563 sync sayfalaması bu dosyalarda. |
| backend/mysql_backup.py, mysql_users.py, storage_admin.py, setup_install.py, applog.py, perfmon.py | düşük | Katalog veya yönetim bağlantısı. |
| backend/storage_migrations/session.py | düşük | Şema oturumu. |

Testler `tests/test_dedicated_storage_flows.py`, `tests/test_dedicated_id_scan.py` ve #1564 `tests/test_dedicated_trash_delete.py`.
