import user_numbers
"""WordPress-style first-run installer: database, site name, admin account."""
from __future__ import annotations

import os
import re
import secrets
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import quote_plus

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

import db_ssl
from auth_utils import hash_password
from mysql_store import MySQLDatabase
from setup_state import (
    apply_saved_secrets,
    lock_installed,
    load_install,
    mark_installed,
    public_defaults,
    sanitize_db_name,
    save_database_settings,
)

router = APIRouter(prefix="/api")

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class DbProbe(BaseModel):
    db_host: str = Field(..., min_length=1, max_length=253)
    db_port: int = Field(3306, ge=1, le=65535)
    db_name: str = Field(..., min_length=1, max_length=64)
    db_user: str = Field(..., min_length=1, max_length=128)
    db_password: str = ""
    ssl_mode: Optional[str] = None
    ssl_ca: str = ""


class InstallRequest(DbProbe):
    site_name: str = Field(..., min_length=2, max_length=120)
    admin_email: str = Field(..., min_length=5, max_length=191)
    admin_password: str = Field(..., min_length=8, max_length=200)
    admin_name: str = Field("", max_length=120)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _settings_from(req: DbProbe) -> dict:
    host = req.db_host.strip()
    # An explicit choice from the form wins; otherwise the host decides and
    # MYSQL_SSL_MODE may only raise that, never lower it for another server.
    env_mode, env_ca = db_ssl.for_target(host)
    mode = (req.ssl_mode or "").strip() or env_mode
    ca = (req.ssl_ca or "").strip() or env_ca
    try:
        mode = db_ssl.normalize_mode(mode)
        db_ssl.context(mode, ca)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "host": host,
        "port": int(req.db_port),
        "user": req.db_user.strip(),
        "password": req.db_password or "",
        "db": sanitize_db_name(req.db_name),
        "charset": "utf8mb4",
        "autocommit": True,
        "ssl_mode": mode,
        "ssl_ca": ca,
    }


def _connect(settings: dict, database: Optional[str]):
    import pymysql

    return pymysql.connect(
        host=settings["host"],
        port=int(settings["port"]),
        user=settings["user"],
        password=settings.get("password") or "",
        database=database,
        charset="utf8mb4",
        autocommit=True,
        connect_timeout=8,
        **db_ssl.connect_kwargs(settings),
    )


def probe_database(settings: dict) -> dict:
    """Connect, create the schema database if missing, return server info."""
    dbname = settings["db"]
    err = None
    conn = None
    created = False
    try:
        conn = _connect(settings, dbname)
    except Exception as exc:
        err = exc
        try:
            conn = _connect(settings, None)
        except Exception as exc2:
            raise RuntimeError(f"MySQL bağlantısı kurulamadı: {exc2}.{db_ssl.explain(exc2)}") from exc2
        try:
            cur = conn.cursor()
            cur.execute(
                f"CREATE DATABASE IF NOT EXISTS `{dbname}` "
                "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
            )
            created = True
            conn.select_db(dbname)
        except Exception as exc2:
            conn.close()
            raise RuntimeError(
                "Veritabanı yok ve oluşturma yetkisi bulunamadı. "
                f"Veritabanını önceden oluşturun veya yetkili bir kullanıcı girin. ({exc2})"
            ) from exc2
        err = None
    try:
        cur = conn.cursor()
        cur.execute("SELECT VERSION()")
        version = cur.fetchone()[0]
        cur.execute("SELECT DATABASE()")
        current = cur.fetchone()[0]
        return {
            "ok": True,
            "server_version": version,
            "database": current or dbname,
            "created": created,
            "ssl_mode": db_ssl.settings(settings)[0],
            "note": None if err is None else str(err),
        }
    finally:
        conn.close()


def apply_env(settings: dict) -> None:
    ssl_mode, ssl_ca = db_ssl.settings(settings)
    os.environ["MYSQL_SSL_MODE"] = ssl_mode
    os.environ["MYSQL_SSL_CA"] = ssl_ca
    os.environ["MYSQL_HOST"] = str(settings["host"])
    os.environ["MYSQL_PORT"] = str(settings["port"])
    os.environ["MYSQL_USER"] = str(settings["user"])
    os.environ["MYSQL_PASSWORD"] = str(settings.get("password") or "")
    os.environ["MYSQL_DATABASE"] = str(settings["db"])
    os.environ["DB_NAME"] = str(settings["db"])
    user = quote_plus(str(settings["user"]))
    pwd = quote_plus(str(settings.get("password") or ""))
    os.environ["DATABASE_URL"] = (
        f"mysql://{user}:{pwd}@{settings['host']}:{int(settings['port'])}/{settings['db']}"
    )


async def rebind_runtime(settings: dict) -> None:
    """Point the running API at `settings` without a restart."""
    import server as srv

    apply_env(settings)
    srv._mysql_cfg = settings
    srv.DB_NAME = settings["db"]
    await srv.db.reconfigure(settings)


async def users_exist(db) -> bool:
    try:
        await db._ensure()
        doc = await db.users.find_one({})
        return bool(doc)
    except Exception:
        return False


async def detect_installed(db) -> bool:
    if lock_installed():
        return True
    if await users_exist(db):
        st = {}
        try:
            plat = await db.platform_settings.find_one({"_id": "platform"}) or {}
            admin = await db.users.find_one({}) or {}
            st = {
                "site_name": plat.get("brand_name") or "",
                "admin_email": admin.get("email") or "",
                "company_id": admin.get("active_company_id") or "",
                "detected": True,
            }
        except Exception:
            st = {"detected": True}
        mark_installed(st)
        return True
    return False


async def perform_install(req: InstallRequest) -> dict:
    if lock_installed():
        raise HTTPException(status_code=409, detail="TamKobi zaten kurulu.")
    email = req.admin_email.strip().lower()
    if not _EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="Geçerli bir yönetici e-posta adresi girin.")
    site_name = req.site_name.strip()
    admin_name = (req.admin_name or "").strip() or "Yönetici"
    settings = _settings_from(req)
    try:
        probe_database(settings)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    local = MySQLDatabase(settings)
    try:
        await local._ensure()
        if await local.users.find_one({}):
            raise HTTPException(
                status_code=409,
                detail="Bu veritabanında zaten kullanıcı var. Kurulum tekrarlanamaz.",
            )
        company_id = "comp_main_01"
        user_id = "usr_admin_01"
        await local.companies.insert_one(
            {
                "_id": company_id,
                "name": site_name,
                "email": email,
                "currency": "TRY",
                "created_at": _now(),
                "license_id": company_id,
            }
        )
        await local.users.insert_one(
            {
                "_id": user_id,
                "email": email,
                "password_hash": hash_password(req.admin_password),
                "name": admin_name,
                "role": "admin",
                "is_super_admin": True,
                "is_active": True,
                "company_ids": [company_id],
                "active_company_id": company_id,
                "preferences": {},
                "user_number": await user_numbers.next_user_number(local),
                "created_at": _now(),
            }
        )
        public_url = (os.environ.get("PUBLIC_APP_URL") or "http://127.0.0.1").rstrip("/")
        await local.platform_settings.insert_one(
            {
                "_id": "platform",
                "reminder_days": [7, 1],
                "email_enabled": True,
                "whatsapp_enabled": True,
                "sender_company_id": company_id,
                "trial_days": 14,
                "trial_plan_id": "plan_pro",
                "support_email": email,
                "support_phone": "",
                "brand_name": site_name,
                "currency": "try",
                "public_url": public_url,
                "created_at": _now(),
            }
        )
    finally:
        await local.close()

    jwt_secret = (os.environ.get("JWT_SECRET") or "").strip()
    if jwt_secret in {"", "change-me", "secret", "jwt-secret", "nexus_default_secret_key_99482910"}:
        jwt_secret = secrets.token_urlsafe(48)
        os.environ["JWT_SECRET"] = jwt_secret

    save_database_settings(settings)
    apply_env(settings)
    meta = mark_installed(
        {
            "site_name": site_name,
            "admin_email": email,
            "company_id": "comp_main_01",
            "jwt_secret": jwt_secret,
        }
    )
    apply_saved_secrets()
    await rebind_runtime(settings)

    import rbac
    import saas

    await saas.seed()
    await rbac.ensure_roles("comp_main_01")
    try:
        import server as srv

        await srv.db.users.create_index("email", unique=True)
        await srv.db.products.create_index("sku")
        await srv.db.products.create_index("barcode")
        await srv.db.contacts.create_index("tax_number_or_id")
        await srv.db.invoices.create_index("invoice_number")
        await srv.db.orders.create_index("order_number")
        await srv.db.login_attempts.create_index("identifier")
    except Exception:
        pass
    return {
        "ok": True,
        "installed": True,
        "site_name": site_name,
        "admin_email": email,
        "installed_at": meta.get("installed_at"),
        "redirect": "/",
    }


@router.get("/setup/status")
async def setup_status():
    from server import db

    installed = await detect_installed(db)
    info = load_install()
    return {
        "installed": bool(installed),
        "site_name": info.get("site_name") or "",
        "admin_email": info.get("admin_email") or "",
        "defaults": public_defaults(),
    }


@router.post("/setup/test-db")
async def setup_test_db(req: DbProbe):
    if lock_installed():
        raise HTTPException(status_code=409, detail="TamKobi zaten kurulu.")
    from server import db

    if await detect_installed(db):
        raise HTTPException(status_code=409, detail="TamKobi zaten kurulu.")
    try:
        settings = _settings_from(req)
        return probe_database(settings)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/setup/install")
async def setup_install(req: InstallRequest):
    return await perform_install(req)
