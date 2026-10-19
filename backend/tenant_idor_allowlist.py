"""Kasıtlı olarak şirketler arası / genel erişimli path-id rotaları.

AST testi (`tests/test_tenant_idor_routes.py`) bu listedekileri şirket
kontrolü zorunluluğundan muaf tutar. Yeni muafiyet eklerken neden yazın.
"""
from __future__ import annotations

# (METHOD, path) — decorator path; /api prefix'siz. Test normalize eder.

TENANT_IDOR_ALLOWLIST: set[tuple[str, str]] = {
    # Auth — token kimlik yerine geçer
    ("GET", "/auth/reset/{token}"),
    ("POST", "/auth/reset/{token}"),
    ("GET", "/auth/invite/{token}"),
    ("POST", "/auth/invite/{token}"),
    # Bildirim — kullanıcıya özel
    ("POST", "/notifications/{notif_id}/read"),
    ("DELETE", "/notifications/{notif_id}"),
    # Yardım makalesi şirkete bağlı değil; oturum (help_center) veya API anahtarı (platform v1) durur.
    ("GET", "/help/articles/{slug}"),
    # İsim / kanal / belge türü anahtarı (UUID kayıt değil)
    ("PUT", "/products/units/{name}"),
    ("DELETE", "/products/units/{name}"),
    ("DELETE", "/products/categories/{name}"),
    ("PUT", "/pricing/rules/{channel}"),
    ("PUT", "/companies/{company_id}/print-templates/{doc_type}"),
    ("DELETE", "/companies/{company_id}/print-templates/{doc_type}"),
    ("GET", "/reports/{kind}"),
    ("GET", "/products/barcode/{barcode}"),
    ("GET", "/pos/receipt/{invoice_number}"),
    ("GET", "/storage/me/folders/{area_key}/files"),
    # Mail IMAP uid
    ("GET", "/comm/mail/messages/{uid}"),
    ("POST", "/comm/mail/messages/{uid}/flag"),
    # Migration şablon entity adı
    ("GET", "/migration/template/{entity}"),
    # Destek — müşteri kendi ticket'ı (email)
    ("GET", "/support/tickets/{ticket_id}"),
    ("POST", "/support/tickets/{ticket_id}/messages"),
    ("POST", "/support/tickets/{ticket_id}/close"),
    # SaaS ödeme oturumu
    ("GET", "/payments/status/{session_id}"),
    # Sanal POS banka dönüşü — oturum yok; intent id + hash doğrulanır.
    ("POST", "/vpos/callback/{intent_id}"),
    # PayTR bildirim URL — oturum yok; hash doğrulanmadan intent yazılmaz.
    ("POST", "/vpos/paytr/notify/{config_id}"),
    # iyzico Checkout Form dönüşü — oturum yok; karar sunucu retrieve yanıtıdır.
    ("POST", "/vpos/iyzico/callback/{intent_id}"),
    # Platform silme onayı (süper-admin / support akışı)
    ("POST", "/companies/{company_id}/deletion-confirmations/{req_id}/reply"),
    # /api/companies/{company_id}/… — PermissionAndAuditMiddleware path'ten cid alır,
    # üye değilse 403. Handler'da ek resolve yoksa burada belgelenir.
    ("GET", "/companies/{company_id}"),
    ("PUT", "/companies/{company_id}"),
    ("GET", "/companies/{company_id}/project-stages"),
    ("GET", "/companies/{company_id}/work-parks"),
    ("GET", "/companies/{company_id}/office-task-types"),
    ("GET", "/companies/{company_id}/workshop-zones"),
    ("GET", "/companies/{company_id}/b2b-settings"),
    ("PUT", "/companies/{company_id}/b2b-settings"),
    ("GET", "/companies/{company_id}/print-templates"),
    ("PUT", "/companies/{company_id}/location"),
    # Super-admin YNT — require_super_admin; şirket üyeliği aranmaz.
    ("GET", "/saas/companies/{company_id}/notify-prefs"),
    ("PUT", "/saas/companies/{company_id}/notify-prefs"),
    ("GET", "/saas/companies/{company_id}/notify-mail-log"),
    # Platform admin-v1 — şirket oturumu yok; HMAC platform_admin anahtarı.
    ("GET", "/platform/admin-v1/companies/{company_id}"),
    ("GET", "/platform/admin-v1/companies/{company_id}/users"),
}

ALLOWLIST_REASONS: dict[tuple[str, str], str] = {
    ("GET", "/auth/reset/{token}"): "Şifre sıfırlama token'ı",
    ("POST", "/notifications/{notif_id}/read"): "Bildirim user-scoped",
    ("GET", "/help/articles/{slug}"): "Genel yardım makalesi; slug anahtarı, şirket verisi yok",
    ("PUT", "/products/units/{name}"): "Birim adı anahtarı",
    ("GET", "/support/tickets/{ticket_id}"): "Müşteri kendi ticket'ı",
    ("GET", "/payments/status/{session_id}"): "Ödeme oturumu token'ı",
    ("POST", "/vpos/callback/{intent_id}"): "Banka 3D dönüşü; oturum yok, hash ile doğrulanır",
    ("POST", "/vpos/paytr/notify/{config_id}"): "PayTR bildirim URL; oturum yok, hash ile doğrulanır",
    ("POST", "/vpos/iyzico/callback/{intent_id}"): "iyzico CF dönüşü; oturum yok, retrieve ile doğrulanır",
    ("POST", "/companies/{company_id}/deletion-confirmations/{req_id}/reply"): "Platform silme onay akışı",
    ("GET", "/companies/{company_id}"): "RBAC middleware path company_id üyeliği",
    ("PUT", "/companies/{company_id}/b2b-settings"): "RBAC middleware path company_id üyeliği",
    ("PUT", "/companies/{company_id}/location"): "RBAC middleware path company_id üyeliği",
    ("GET", "/saas/companies/{company_id}/notify-prefs"): "Süper-admin platform firma bildirimi; require_super_admin",
    ("PUT", "/saas/companies/{company_id}/notify-prefs"): "Süper-admin platform firma bildirimi; require_super_admin",
    ("GET", "/saas/companies/{company_id}/notify-mail-log"): "Süper-admin olay e-posta logu; require_super_admin",
    ("GET", "/platform/admin-v1/companies/{company_id}"): "Platform yönetim API'si; HMAC platform_admin anahtarı (kind=platform_admin, admin.* kapsamı), şirket oturumu yok",
    ("GET", "/platform/admin-v1/companies/{company_id}/users"): "Platform yönetim API'si; HMAC platform_admin anahtarı (kind=platform_admin, admin.* kapsamı), şirket oturumu yok",
}
