"""Host → JWT audience mapping (site / app / b2b / ik / ynt)."""
from __future__ import annotations

import os
from typing import Any, Optional

ROOT_DOMAIN = (os.environ.get("ROOT_DOMAIN") or "tamkobi.com").strip().lower()

# Host kind constants
KIND_SITE = "site"
KIND_APP = "app"
KIND_B2B = "b2b"
KIND_IK = "ik"
KIND_YNT = "ynt"

# JWT aud values (match kinds used for cookie-bearing hosts)
AUD_SITE = "site"
AUD_APP = "app"
AUD_IK = "ik"
AUD_YNT = "ynt"

_PROXY_PEERS = frozenset({"127.0.0.1", "::1"})

_IK_SELF_SERVICE_PREFIXES = (
    "/api/personnel/me",
    "/api/personnel/messages",
    "/api/personnel/attendance/self",
    "/api/personnel/attendance/me",
    "/api/personnel/attendance/reminder-prefs",
    "/api/personnel/attendance/geo",
    "/api/personnel/attendance/early-leave-request",
    "/api/personnel/attendance/intraday-leave-request",
    "/api/personnel/leaves/self",
    "/api/personnel/leaves/me",
    "/api/personnel/bonuses/self",
    "/api/auth/login",
    "/api/auth/logout",
    "/api/auth/me",
    "/api/auth/switch-company",
    "/api/auth/forgot-password",
    "/api/auth/reset/",
    "/api/auth/sso-exchange",
    "/api/license/me",
    "/api/version",
    "/api/health",
)

# Paths allowed for aud=ynt sessions on ynt host (beyond SA APIs checked separately)
_YNT_ALLOWED_PREFIXES = (
    "/api/auth/",
    "/api/version",
    "/api/health",
    "/api/system",
    "/api/platform/admin",
    "/api/saas",  # legacy SA saas routes if any
    # Platform şirket çekmecesi: e-fatura entegratörü + İşNet SOAP/portal
    "/api/einvoice/providers",
    "/api/einvoice/settings",
    "/api/einvoice/test",
    "/api/integrations/isnet/",
    "/api/integrations/isnet-portal/",
    # Şirket SMS uçları allowlist'te kalır ki ynt yazması handler'da 403 + audit olsun.
    # Özet: GET /api/system/companies/{id}/sms (şifre ve düzenleme yok).
    "/api/comm/sms/",
    "/api/files/upload",
    "/api/public/plans",
    # ynt /yasal* sayfası
    "/api/public/legal",
    # Yardım merkezi dağıtımı (TamKobi / TamEticaret ürün etiketleri)
    "/api/public/help",
    "/api/system/help",
)


def root_domain() -> str:
    return ROOT_DOMAIN or "tamkobi.com"


def ynt_host() -> str:
    return (os.environ.get("YNT_HOST") or "ynt.taiyazilim.com").strip().lower()


def superadmin_ynt_only() -> bool:
    return (os.environ.get("SUPERADMIN_YNT_ONLY") or "0").strip() == "1"


def _strip_port(host: str) -> str:
    h = (host or "").strip().lower()
    if not h:
        return ""
    if h.startswith("["):
        end = h.find("]")
        return h[: end + 1] if end != -1 else h
    return h.split(":", 1)[0]


def request_host(request: Any) -> str:
    """Host for audience: trust nginx Host; X-Forwarded-Host only from local proxy."""
    if request is None:
        return ""
    headers = getattr(request, "headers", None) or {}
    host = headers.get("host") or headers.get("Host") or ""
    peer = ""
    client = getattr(request, "client", None)
    if client is not None:
        peer = (getattr(client, "host", None) or "").strip()
    if peer in _PROXY_PEERS:
        xf = (headers.get("x-forwarded-host") or headers.get("X-Forwarded-Host") or "").split(",")[0].strip()
        if xf:
            host = xf
    return _strip_port(host)


def host_kind_from_hostname(hostname: str) -> str:
    """Map hostname to site|app|b2b|ik|ynt. YNT_HOST checked before ROOT_DOMAIN."""
    h = _strip_port(hostname)
    # Platform yönetimi — farklı alan adı (ynt.taiyazilim.com)
    if h and h == ynt_host():
        return KIND_YNT
    root = root_domain()
    if h in {root, f"www.{root}"}:
        return KIND_SITE
    if h == f"app.{root}":
        return KIND_APP
    if h == f"b2b.{root}":
        return KIND_B2B
    if h == f"ik.{root}":
        return KIND_IK
    # Local / unknown → site (legacy mobile + local API)
    return KIND_SITE


def host_kind(request: Any) -> str:
    return host_kind_from_hostname(request_host(request))


def audience_for_host_kind(kind: str) -> Optional[str]:
    """JWT aud for cookie-bearing hosts. b2b uses URL tokens (no aud)."""
    if kind == KIND_APP:
        return AUD_APP
    if kind == KIND_IK:
        return AUD_IK
    if kind == KIND_SITE:
        return AUD_SITE
    if kind == KIND_YNT:
        return AUD_YNT
    return None


def audience_for_request(request: Any) -> Optional[str]:
    return audience_for_host_kind(host_kind(request))


def public_host_url(kind: str) -> str:
    """https://… base for kind (no trailing slash)."""
    if kind == KIND_YNT:
        env = (os.environ.get("PUBLIC_YNT_URL") or "").strip().rstrip("/")
        if env:
            return env if "://" in env else f"https://{env}"
        return f"https://{ynt_host()}"
    root = root_domain()
    if kind == KIND_APP:
        return f"https://app.{root}"
    if kind == KIND_B2B:
        return f"https://b2b.{root}"
    if kind == KIND_IK:
        return f"https://ik.{root}"
    return f"https://{root}"


def is_employee_user(user: dict) -> bool:
    """Çalışan = employee_id dolu ve rolü personel."""
    if not user:
        return False
    eid = user.get("employee_id")
    role = (user.get("role") or "").strip().lower()
    return bool(eid) and role == "personel"


def is_ik_allowed_api_path(path: str, method: str = "GET") -> bool:
    """İK /api geçidi: self-servis, PORTAL_API_RULES satırı veya yardımcı GET.

    Saha uçlarında yöntem+yol rbac.PORTAL_API_RULES ile birebir eşleşmezse reddedilir;
    özellik (portal_*) kararı burada verilmez, rbac middleware verir. Böylece ik
    hostuna kurallarda olmayan yazma (PUT ayar, trash-completed, depo POST) açılmaz.
    Yardımcı okumalar yalnız GET/HEAD olarak geçer; özellik kapalıysa rbac 403 döner.
    """
    if is_ik_self_service_path(path):
        return True
    p = (path or "").split("?", 1)[0]
    if not p.startswith("/api"):
        return True
    import rbac
    if rbac.portal_rule_for_path(p, method):
        return True
    if rbac.ik_helper_read_feature(p, method):
        return True
    return False


def is_ik_self_service_path(path: str) -> bool:
    p = (path or "").split("?", 1)[0]
    for pref in _IK_SELF_SERVICE_PREFIXES:
        if pref.endswith("/"):
            if p == pref.rstrip("/") or p.startswith(pref):
                return True
        elif p == pref or p.startswith(pref + "/"):
            return True
    if p.startswith("/api/personnel/attendance/") and any(
        p.endswith(s)
        for s in (
            "/confirm",
            "/dispute",
            "/early-leave-cancel",
            "/time-edit-decision",
        )
    ):
        return True
    if p.startswith("/api/projects/") and p.endswith("/stage-photos/visibility"):
        return True
    return False


def is_ynt_allowed_path(path: str) -> bool:
    """API paths allowed for ynt sessions (auth/health/version + SA APIs)."""
    p = (path or "").split("?", 1)[0]
    if p in ("/api/version", "/api/health", "/api/auth/login", "/api/auth/logout", "/api/auth/me",
             "/api/auth/sso-exchange", "/api/auth/2fa/verify", "/api/auth/2fa/status",
             "/api/auth/2fa/setup/start", "/api/auth/2fa/setup/confirm",
             "/api/auth/forgot-password"):
        return True
    if p.startswith("/api/auth/reset/"):
        return True
    if p.startswith("/api/health/"):
        return True
    for pref in _YNT_ALLOWED_PREFIXES:
        if p == pref.rstrip("/") or p.startswith(pref if pref.endswith("/") else pref + "/") or p.startswith(pref):
            return True
    return False


def is_super_admin_api_path(path: str) -> bool:
    """Süper admin API — /api/system/* ve /api/platform/admin/*.

    /api/license/* ve /api/auth/2fa/* bu sınıfa GİRMEZ (kiracı / ortak auth).
    Eski genel '/system/' substring kuralı kaldırıldı (yanlış pozitif riski).
    """
    p = (path or "").split("?", 1)[0]
    if p.startswith("/api/license"):
        return False
    if p.startswith("/api/auth/2fa"):
        return False
    return (
        p.startswith("/api/system")
        or p.startswith("/api/platform/admin")
        or p.startswith("/api/saas")
    )


def default_cors_origins() -> list:
    root = root_domain()
    origins = [
        f"https://{root}",
        f"https://www.{root}",
        f"https://app.{root}",
        f"https://b2b.{root}",
        f"https://ik.{root}",
        public_host_url(KIND_YNT),
    ]
    # Deduplicate while preserving order
    seen = set()
    out = []
    for o in origins:
        if o not in seen:
            seen.add(o)
            out.append(o)
    return out


def parse_cors_origins_env() -> list:
    listed = [o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()]
    if listed:
        return listed
    return default_cors_origins()
