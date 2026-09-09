"""KVKK-style personal data export: text-only ZIP (JSON/CSV/TXT), no binaries."""
import csv
import io
import json
import re
import zipfile
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

router = APIRouter(prefix="/api")
_db = None
_current_user = None

TEXT_EXTS = (".json", ".csv", ".txt")
SECRET_KEYS = {
    "password", "password_hash", "b2b_password_hash", "refresh_token", "access_token",
    "api_key", "api_secret", "secret", "token", "jwt", "smtp_password", "client_secret",
    "password_enc", "access_token_enc", "sa_return",
}
SECRET_FRAGMENTS = ("password", "secret", "_enc", "api_key", "private_key")
DROP_VALUE_PREFIXES = ("data:image", "data:application/pdf", "data:application/vnd")
INVOICE_LIMIT = 8000
LOG_LIMIT = 2000

README = """TamKobi kişisel veri dışa aktarımı (KVKK)
===========================================
Bu ZIP yalnızca metin tabanlı kayıtlardır: JSON, CSV ve TXT.
Görsel, PDF ve Excel (xlsx) dosyaları bilinçli olarak dahil edilmedi.

İçerik
------
- profil.json          Hesap bilgileriniz (şifre hariç)
- sirketler.json       Üyesi olduğunuz şirketlerin metin bilgileri
- faturalar.json       Geçmiş faturalar (kalemler dahil, metin)
- faturalar.csv        Fatura başlıkları
- fatura_satirlari.csv Fatura satırları
- personel.json        Bağlı personel kartınız (varsa)
- puantaj.json / izinler.json / bordrolar.json
- aktivite.json        Sizin işlem kayıtlarınız
- manifest.json        Bu paketin özeti

Hariç tutulanlar: logolar, ürün görselleri, yüklenen PDF/Excel eklerinin
ikili içeriği, şifre ve API anahtarları. Eklerin adresi (URL) metin olarak
fatura kaydında durabilir; dosyanın kendisi bu ZIP'te yoktur.
"""


def init(db, current_user_dep):
    global _db, _current_user
    _db, _current_user = db, current_user_dep


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _is_secret_key(key: str) -> bool:
    k = (key or "").lower()
    if k in SECRET_KEYS:
        return True
    return any(frag in k for frag in SECRET_FRAGMENTS)


def sanitize(obj: Any) -> Any:
    """Drop secrets and inlined binary payloads; keep URL strings."""
    if isinstance(obj, bytes):
        return None
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if _is_secret_key(str(k)):
                continue
            cleaned = sanitize(v)
            if cleaned is None and v is not None and not isinstance(v, (int, float, bool)):
                continue
            out[k] = cleaned
        if "_id" in out and "id" not in out:
            out["id"] = str(out.pop("_id"))
        elif "_id" in out:
            out["id"] = str(out.pop("_id"))
        return out
    if isinstance(obj, list):
        return [sanitize(x) for x in obj]
    if isinstance(obj, str) and obj[:40].lower().startswith(DROP_VALUE_PREFIXES):
        return None
    return obj


def dumps(obj: Any) -> str:
    return json.dumps(sanitize(obj), ensure_ascii=False, indent=2, default=str)


def csv_text(rows: List[dict], columns: List[str]) -> str:
    buf = io.StringIO()
    buf.write("\ufeff")
    w = csv.writer(buf, delimiter=";", quoting=csv.QUOTE_MINIMAL)
    w.writerow(columns)
    for row in rows:
        w.writerow([_csv_cell(row.get(c)) for c in columns])
    return buf.getvalue()


def _csv_cell(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, bool):
        return "evet" if v else "hayır"
    if isinstance(v, (dict, list)):
        return json.dumps(v, ensure_ascii=False, default=str)
    return str(v)


def build_zip(files: Dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for name, content in files.items():
            if not name.lower().endswith(TEXT_EXTS):
                raise ValueError(f"yalnızca metin dosyaları: {name}")
            zf.writestr(name, content.encode("utf-8") if isinstance(content, str) else content)
    return buf.getvalue()


def invoice_header_row(inv: dict) -> dict:
    s = sanitize(inv)
    return {
        "id": s.get("id"),
        "invoice_number": s.get("invoice_number"),
        "invoice_type": s.get("invoice_type"),
        "e_type": s.get("e_type"),
        "issue_date": s.get("issue_date"),
        "due_date": s.get("due_date"),
        "contact_name": s.get("contact_name"),
        "contact_tax_id": s.get("contact_tax_id"),
        "subtotal": s.get("subtotal"),
        "vat_total": s.get("vat_total"),
        "grand_total": s.get("grand_total"),
        "currency": s.get("currency"),
        "status": s.get("status"),
        "payment_status": s.get("payment_status"),
        "paid_amount": s.get("paid_amount"),
        "notes": s.get("notes"),
        "company_id": s.get("company_id"),
    }


def invoice_line_rows(inv: dict) -> List[dict]:
    s = sanitize(inv)
    rows = []
    for i, line in enumerate(s.get("items") or [], 1):
        if not isinstance(line, dict):
            continue
        rows.append({
            "invoice_id": s.get("id"),
            "invoice_number": s.get("invoice_number"),
            "line_no": i,
            "name": line.get("name"),
            "quantity": line.get("quantity"),
            "unit": line.get("unit"),
            "unit_price": line.get("unit_price"),
            "vat_rate": line.get("vat_rate"),
            "total": line.get("total"),
        })
    return rows


async def _token_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    auth = request.headers.get("Authorization") or ""
    if auth.startswith("Bearer "):
        token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Veri dışa aktarımı için giriş yapmanız gerekiyor.")
    from auth_utils import get_user_from_token
    return await get_user_from_token(token, _db)


async def _safe_find(coll, query, limit=500) -> list:
    try:
        return await coll.find(query).sort("created_at", -1).to_list(limit)
    except Exception:
        try:
            return await coll.find(query).to_list(limit)
        except Exception:
            return []


@router.get("/me/data-export")
async def export_my_data(request: Request, company_id: Optional[str] = None):
    user = await _token_user(request)
    uid = str(user.get("id") or user.get("_id"))
    cids = [c for c in (user.get("company_ids") or []) if c]
    if company_id:
        if company_id not in cids:
            raise HTTPException(status_code=403, detail="Bu şirketin verisine erişiminiz yok.")
        cids = [company_id]
    companies = []
    for cid in cids:
        co = await _db.companies.find_one({"_id": cid})
        if co:
            companies.append(co)
    inv_q = {"company_id": {"$in": cids}} if cids else {"company_id": "__none__"}
    invoices = await _safe_find(_db.invoices, inv_q, INVOICE_LIMIT)
    emp = None
    if user.get("employee_id"):
        emp = await _db.employees.find_one({"_id": user["employee_id"]})
    if not emp:
        emp = await _db.employees.find_one({"user_id": uid})
    if not emp and user.get("email"):
        emp = await _db.employees.find_one({"email": user["email"]})
    emp_id = emp.get("_id") if emp else None
    attendance = await _safe_find(_db.attendance, {"employee_id": emp_id}, LOG_LIMIT) if emp_id else []
    leaves = await _safe_find(_db.leave_requests, {"employee_id": emp_id}, 500) if emp_id else []
    payrolls = await _safe_find(_db.payrolls, {"employee_id": emp_id}, 500) if emp_id else []
    bonuses = await _safe_find(_db.bonus_payments, {"employee_id": emp_id}, 500) if emp_id else []
    activity = await _safe_find(_db.activity_logs, {"user_id": uid}, LOG_LIMIT)
    headers = [invoice_header_row(i) for i in invoices]
    lines = []
    for i in invoices:
        lines.extend(invoice_line_rows(i))
    manifest = {
        "generated_at": _now(),
        "user_id": uid,
        "email": user.get("email"),
        "companies": cids,
        "counts": {
            "invoices": len(invoices),
            "invoice_lines": len(lines),
            "attendance": len(attendance),
            "leaves": len(leaves),
            "payrolls": len(payrolls),
            "activity_logs": len(activity),
        },
        "excluded": ["images", "pdf", "xlsx", "binaries", "passwords", "api_keys"],
        "note": "Yalnızca metin tabanlı kişisel veriler ve faturalar.",
    }
    files = {
        "README.txt": README,
        "manifest.json": dumps(manifest),
        "profil.json": dumps(user),
        "sirketler.json": dumps(companies),
        "faturalar.json": dumps(invoices),
        "faturalar.csv": csv_text(headers, [
            "id", "invoice_number", "invoice_type", "e_type", "issue_date", "due_date",
            "contact_name", "contact_tax_id", "subtotal", "vat_total", "grand_total",
            "currency", "status", "payment_status", "paid_amount", "notes", "company_id",
        ]),
        "fatura_satirlari.csv": csv_text(lines, [
            "invoice_id", "invoice_number", "line_no", "name", "quantity", "unit", "unit_price", "vat_rate", "total",
        ]),
        "aktivite.json": dumps(activity),
    }
    if emp:
        files["personel.json"] = dumps(emp)
        files["puantaj.json"] = dumps(attendance)
        files["izinler.json"] = dumps(leaves)
        files["bordrolar.json"] = dumps(payrolls)
        files["primler.json"] = dumps(bonuses)
    blob = build_zip(files)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    safe_mail = re.sub(r"[^a-zA-Z0-9._-]+", "_", (user.get("email") or "kullanici"))[:80]
    filename = f"tamkobi_veri_{safe_mail}_{stamp}.zip"
    return StreamingResponse(
        io.BytesIO(blob),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
