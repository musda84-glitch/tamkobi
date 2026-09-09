"""Döviz kurları: TCMB günlük bülten + şirket bazlı manuel kur.

Kur 1 birim döviz = X TRY (JPY gibi Unit=100 olanlarda birim başına bölünür).
Belgeler (fatura, masraf, dış ticaret) `currency` + `fx_rate` + `local_total` (TRY) tutar.
RBAC: /api/fx → Firma Ayarları.
"""
from __future__ import annotations

import uuid
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, date, timedelta
from typing import Any, Dict, Optional, Tuple

import httpx
from fastapi import APIRouter, HTTPException, Request

from auth_utils import get_user_from_token

router = APIRouter(prefix="/api")
_db = None

CURRENCIES = ["TRY", "USD", "EUR", "GBP", "CHF", "JPY"]
TCMB_TODAY = "https://www.tcmb.gov.tr/kurlar/today.xml"
TCMB_DAY = "https://www.tcmb.gov.tr/kurlar/{ym}/{dmy}.xml"


def init(db):
    global _db
    _db = db


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean(d: dict) -> dict:
    if d and "_id" in d:
        d["id"] = str(d.pop("_id"))
    return d


def parse_tcmb_xml(xml_text: str) -> Tuple[str, Dict[str, dict]]:
    """TCMB XML → (ISO date, {USD: {unit, buying, selling, rate, name}}). rate = satış / unit."""
    root = ET.fromstring(xml_text)
    raw_date = (root.attrib.get("Date") or "").strip()  # MM/DD/YYYY
    iso = ""
    if raw_date and "/" in raw_date:
        mm, dd, yy = raw_date.split("/")
        iso = f"{yy}-{mm.zfill(2)}-{dd.zfill(2)}" if len(yy) == 4 else ""
    if not iso:
        tr = (root.attrib.get("Tarih") or "").strip()  # DD.MM.YYYY
        if tr.count(".") == 2:
            dd, mm, yy = tr.split(".")
            iso = f"{yy}-{mm}-{dd}"
    rates = {}
    for node in root.findall("Currency"):
        code = (node.attrib.get("CurrencyCode") or node.attrib.get("Kod") or "").upper()
        if not code or code == "TRY":
            continue
        unit = float((node.findtext("Unit") or "1") or 1) or 1.0
        buying = _xml_float(node.findtext("ForexBuying"))
        selling = _xml_float(node.findtext("ForexSelling"))
        if buying is None and selling is None:
            continue
        per = (selling if selling is not None else buying) / unit
        rates[code] = {
            "currency": code,
            "unit": unit,
            "buying": round((buying or 0) / unit, 6) if buying is not None else None,
            "selling": round((selling or 0) / unit, 6) if selling is not None else None,
            "rate": round(per, 6),
            "name": (node.findtext("Isim") or node.findtext("CurrencyName") or code).strip(),
        }
    if not rates:
        raise ValueError("TCMB XML içinde kur yok.")
    return iso or date.today().isoformat(), rates


def _xml_float(v: Optional[str]) -> Optional[float]:
    if v is None:
        return None
    s = str(v).strip().replace(",", ".")
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _tcmb_urls(on: date) -> list:
    urls = []
    cur = on
    for _ in range(8):
        if cur == date.today():
            urls.append(TCMB_TODAY)
        urls.append(TCMB_DAY.format(ym=cur.strftime("%Y%m"), dmy=cur.strftime("%d%m%Y")))
        cur -= timedelta(days=1)
    seen, out = set(), []
    for u in urls:
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out


async def fetch_tcmb(on_date: Optional[str] = None) -> Tuple[str, Dict[str, dict], str]:
    target = date.fromisoformat(on_date) if on_date else date.today()
    last_err = "TCMB yanıt vermedi."
    async with httpx.AsyncClient(timeout=12.0, follow_redirects=True, headers={"User-Agent": "TamKobiERP/1.0"}) as client:
        for url in _tcmb_urls(target):
            try:
                r = await client.get(url)
                if r.status_code != 200 or "<Currency" not in r.text:
                    last_err = f"TCMB {url} → {r.status_code}"
                    continue
                iso, rates = parse_tcmb_xml(r.text)
                return iso, rates, url
            except Exception as e:
                last_err = str(e)
                continue
    raise HTTPException(status_code=502, detail=f"TCMB kurları alınamadı ({last_err}). Manuel kur girin.")


async def _upsert_rates(company_id: str, iso: str, rates: Dict[str, dict], source: str, bulletin_url: str = "") -> list:
    saved = []
    for code, row in rates.items():
        existing = await _db.fx_rates.find_one({"company_id": company_id, "date": iso, "currency": code})
        doc = {
            "company_id": company_id,
            "date": iso,
            "currency": code,
            "unit": row.get("unit") or 1,
            "buying": row.get("buying"),
            "selling": row.get("selling"),
            "rate": float(row["rate"]),
            "name": row.get("name") or code,
            "source": source,
            "bulletin_url": bulletin_url,
            "updated_at": _now(),
        }
        if existing and existing.get("source") == "manual" and source == "tcmb":
            saved.append(_clean(dict(existing)))
            continue
        if existing:
            await _db.fx_rates.update_one({"_id": existing["_id"]}, {"$set": doc})
            saved.append(_clean({**existing, **doc}))
        else:
            doc["_id"] = str(uuid.uuid4())
            doc["created_at"] = _now()
            await _db.fx_rates.insert_one(doc)
            saved.append(_clean(dict(doc)))
    return saved


async def ensure_rates(company_id: str, on_date: Optional[str] = None, fetch: bool = True) -> dict:
    iso = on_date or date.today().isoformat()
    rows = [_clean(x) for x in await _db.fx_rates.find({"company_id": company_id, "date": iso}).to_list(50)]
    fetched = False
    source = rows[0]["source"] if rows else None
    if fetch and not rows:
        try:
            iso2, rates, url = await fetch_tcmb(iso)
            rows = await _upsert_rates(company_id, iso2, rates, "tcmb", url)
            iso, fetched, source = iso2, True, "tcmb"
        except HTTPException:
            # Header chip and settings must still load; user can type a rate or retry TCMB.
            pass
        iso2, rates, url = await fetch_tcmb(iso)
        rows = await _upsert_rates(company_id, iso2, rates, "tcmb", url)
        iso, fetched, source = iso2, True, "tcmb"
    return {
        "date": iso,
        "source": source,
        "fetched": fetched,
        "currencies": CURRENCIES,
        "rates": {r["currency"]: r for r in rows},
    }


async def resolve_rate(company_id: str, currency: str, on_date: Optional[str] = None, side: str = "selling") -> dict:
    code = (currency or "TRY").upper()
    iso = on_date or date.today().isoformat()
    if code == "TRY":
        return {"currency": "TRY", "date": iso, "rate": 1.0, "source": "try", "buying": 1.0, "selling": 1.0}
    pack = await ensure_rates(company_id, iso, fetch=True)
    row = pack["rates"].get(code)
    if not row:
        prev = await _db.fx_rates.find({"company_id": company_id, "currency": code}).sort("date", -1).to_list(1)
        if prev:
            row = _clean(prev[0])
        else:
            raise HTTPException(status_code=400, detail=f"{code} kuru yok. Ayarlar → Döviz Kurları’ndan TCMB çekin veya manuel girin.")
    rate = float(row.get(side) or row.get("rate") or 0) or float(row.get("rate") or 0)
    if rate <= 0:
        raise HTTPException(status_code=400, detail=f"{code} kuru geçersiz.")
    return {"currency": code, "date": row.get("date") or iso, "rate": rate, "source": row.get("source") or "tcmb", "buying": row.get("buying"), "selling": row.get("selling")}


def typed_rate(currency: Optional[str], fx_rate: Any = None, fx_source: Optional[str] = None):
    """Formdan gelen kuru stamp'e geçir. TCMB satışı (JPY < 1 dahil) source=tcmb iken None döner."""
    if (currency or "TRY").upper() == "TRY":
        return None
    if (fx_source or "") == "manual":
        return fx_rate
    try:
        r = float(fx_rate or 0)
    except (TypeError, ValueError):
        return None
    return r if r > 1.000001 else None


async def stamp(company_id: str, currency: Optional[str], on_date: Optional[str], fx_rate: Any = None) -> dict:
    """Belgeye yazılacak kur damgası. fx_rate verilirse (manuel satır kuru) o kullanılır."""
    code = (currency or "TRY").upper()
    iso = on_date or date.today().isoformat()
    if code == "TRY":
        return {"currency": "TRY", "fx_rate": 1.0, "fx_date": iso, "fx_source": "try"}
    if fx_rate not in (None, "", 0, "0"):
        rate = float(fx_rate)
        if rate <= 0:
            raise HTTPException(status_code=400, detail="Kur sıfırdan büyük olmalı.")
        return {"currency": code, "fx_rate": round(rate, 6), "fx_date": iso, "fx_source": "manual"}
    q = await resolve_rate(company_id, code, iso)
    return {"currency": code, "fx_rate": q["rate"], "fx_date": q["date"], "fx_source": q["source"]}


def local_of(amount: Any, fx_rate: Any) -> float:
    return round(float(amount or 0) * float(fx_rate or 1), 2)


async def defaults_map(company_id: str, on_date: Optional[str] = None, fetch: bool = True) -> dict:
    pack = await ensure_rates(company_id, on_date, fetch=fetch)
    out = {"TRY": 1.0}
    for code in CURRENCIES:
        if code == "TRY":
            continue
        row = (pack.get("rates") or {}).get(code)
        if row:
            out[code] = float(row.get("rate") or 0) or 1.0
    return out


def try_amount(doc: dict, amount: Any = None) -> float:
    """Belge tutarını TRY'ye çevir. amount verilmezse local_total / grand_total."""
    amt = float(doc.get("grand_total") if amount is None else amount)
    if (doc.get("currency") or "TRY").upper() == "TRY":
        return round(amt, 2)
    if amount is None and doc.get("local_total"):
        return round(float(doc["local_total"]), 2)
    return local_of(amt, doc.get("fx_rate") or 1)


async def _tenant_id(request: Request) -> str:
    """Kur okuma/yazma yalnızca oturum + query company_id. Body'deki company_id yok sayılır."""
    token = request.cookies.get("access_token")
    auth = request.headers.get("Authorization") or ""
    if not token and auth.startswith("Bearer "):
        token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Giriş yapmanız gerekiyor.")
    user = await get_user_from_token(token, _db)
    cid = request.query_params.get("company_id")
    if not cid:
        raise HTTPException(status_code=400, detail="company_id gerekli.")
    if not user.get("is_super_admin") and cid not in (user.get("company_ids") or []):
        raise HTTPException(status_code=403, detail="Bu şirket hesabına erişiminiz yok.")
    return cid


@router.get("/fx/currencies")
async def list_currencies():
    return {"currencies": CURRENCIES}


@router.get("/fx/rates")
async def get_rates(request: Request, date: Optional[str] = None, fetch: bool = True):
    company_id = await _tenant_id(request)
    return await ensure_rates(company_id, date, fetch=fetch)


@router.get("/fx/quote")
async def quote_rate(request: Request, currency: str, date: Optional[str] = None, side: str = "selling"):
    company_id = await _tenant_id(request)
    return await resolve_rate(company_id, currency, date, side=side if side in ("buying", "selling") else "selling")


@router.post("/fx/fetch")
async def fetch_rates(req: Dict[str, Any], request: Request):
    company_id = await _tenant_id(request)
    iso, rates, url = await fetch_tcmb(req.get("date"))
    rows = await _upsert_rates(company_id, iso, rates, "tcmb", url)
    return {"date": iso, "source": "tcmb", "bulletin_url": url, "count": len(rows), "rates": {r["currency"]: r for r in rows}, "message": f"TCMB {iso} bülteni alındı ({len(rows)} kur). Manuel girilmiş kurlar korundu."}


@router.put("/fx/rates")
async def save_manual_rate(req: Dict[str, Any], request: Request):
    company_id = await _tenant_id(request)
    code = (req.get("currency") or "").upper()
    if code not in CURRENCIES or code == "TRY":
        raise HTTPException(status_code=400, detail="Para birimi USD, EUR, GBP, CHF veya JPY olmalı.")
    iso = req.get("date") or date.today().isoformat()
    try:
        rate = float(req.get("rate") if req.get("rate") not in (None, "") else req.get("selling") or req.get("buying"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Kur sayı olmalı.")
    if rate <= 0:
        raise HTTPException(status_code=400, detail="Kur sıfırdan büyük olmalı.")
    buying = float(req["buying"]) if req.get("buying") not in (None, "") else rate
    selling = float(req["selling"]) if req.get("selling") not in (None, "") else rate
    row = {"currency": code, "unit": 1, "buying": buying, "selling": selling, "rate": rate, "name": code}
    saved = await _upsert_rates(company_id, iso, {code: row}, "manual")
    return saved[0]
