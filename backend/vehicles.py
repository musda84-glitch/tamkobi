"""Araçlarım — şirket filo araçları (plaka, marka/model, durum)."""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException

import trash

router = APIRouter(prefix="/api")
_db = None

STATUSES = ("active", "inactive", "maintenance")
STATUS_LABELS = {
    "active": "Aktif",
    "inactive": "Pasif",
    "maintenance": "Bakımda",
}


def init(db):
    global _db
    _db = db


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean(d: Optional[dict]) -> Optional[dict]:
    if not d:
        return d
    out = dict(d)
    if "_id" in out:
        out["id"] = str(out.pop("_id"))
    return out


def normalize_plate(raw: Any) -> str:
    s = str(raw or "").strip().upper()
    s = s.replace("İ", "I").replace("ı", "I")
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def plate_key(raw: Any) -> str:
    return re.sub(r"[^A-Z0-9]", "", normalize_plate(raw))


def validate_vehicle(data: Dict[str, Any], *, partial: bool = False) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    if not partial or "plate" in data:
        plate = normalize_plate(data.get("plate"))
        if not plate:
            raise HTTPException(status_code=400, detail="Plaka zorunlu.")
        if len(plate_key(plate)) < 5:
            raise HTTPException(status_code=400, detail="Plaka geçersiz.")
        out["plate"] = plate
        out["plate_key"] = plate_key(plate)
    if not partial or "brand" in data:
        out["brand"] = str(data.get("brand") or "").strip()
    if not partial or "model" in data:
        out["model"] = str(data.get("model") or "").strip()
    if not partial or "color" in data:
        out["color"] = str(data.get("color") or "").strip()
    if not partial or "notes" in data:
        out["notes"] = str(data.get("notes") or "").strip()
    if not partial or "year" in data:
        year_raw = data.get("year")
        if year_raw in (None, ""):
            out["year"] = None
        else:
            try:
                year = int(year_raw)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="Model yılı sayı olmalı.") from None
            if year < 1950 or year > 2100:
                raise HTTPException(status_code=400, detail="Model yılı 1950–2100 arasında olmalı.")
            out["year"] = year
    if not partial or "status" in data:
        status = str(data.get("status") or "active").strip().lower()
        if status not in STATUSES:
            raise HTTPException(status_code=400, detail="Durum active, inactive veya maintenance olmalı.")
        out["status"] = status
    return out


def vehicle_label(doc: Dict[str, Any]) -> str:
    plate = doc.get("plate") or "—"
    brand = " ".join(x for x in [doc.get("brand"), doc.get("model")] if x).strip()
    return f"{plate} · {brand}" if brand else str(plate)


def filter_vehicles(rows: List[Dict[str, Any]], status: Optional[str] = None, q: Optional[str] = None) -> List[Dict[str, Any]]:
    out = list(rows or [])
    st = str(status or "").strip().lower()
    if st and st != "all":
        out = [r for r in out if str(r.get("status") or "").lower() == st]
    needle = str(q or "").strip().lower()
    if needle:
        out = [
            r for r in out
            if needle in " ".join(
                str(r.get(k) or "") for k in ("plate", "brand", "model", "color", "notes", "year")
            ).lower()
        ]
    return out


def summarize(rows: List[Dict[str, Any]]) -> Dict[str, int]:
    summary = {"total": len(rows), "active": 0, "inactive": 0, "maintenance": 0}
    for r in rows:
        st = str(r.get("status") or "active")
        if st in summary:
            summary[st] += 1
    return summary


@router.get("/vehicles")
async def list_vehicles(company_id: str = "comp_nexus_main_01", status: Optional[str] = None, q: Optional[str] = None):
    rows = await _db.vehicles.find({"company_id": company_id}).sort("plate", 1).to_list(500)
    filtered = filter_vehicles(rows, status=status, q=q)
    all_clean = [_clean(r) for r in rows]
    return {
        "vehicles": [_clean(r) for r in filtered],
        "summary": summarize(all_clean),
        "statuses": [{"value": k, "label": STATUS_LABELS[k]} for k in STATUSES],
    }


@router.get("/vehicles/{vehicle_id}")
async def get_vehicle(vehicle_id: str):
    doc = await _db.vehicles.find_one({"_id": vehicle_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Araç bulunamadı.")
    return _clean(doc)


@router.post("/vehicles")
async def create_vehicle(req: Dict[str, Any]):
    company_id = req.get("company_id") or "comp_nexus_main_01"
    fields = validate_vehicle(req)
    dup = await _db.vehicles.find_one({"company_id": company_id, "plate_key": fields["plate_key"]})
    if dup:
        raise HTTPException(status_code=400, detail=f"Bu plaka zaten kayıtlı: {dup.get('plate')}")
    now = _now()
    doc = {
        "_id": f"veh_{uuid.uuid4().hex[:10]}",
        "company_id": company_id,
        **fields,
        "created_at": now,
        "updated_at": now,
    }
    await _db.vehicles.insert_one(doc)
    return {**_clean(doc), "message": f"{fields['plate']} kaydedildi."}


@router.put("/vehicles/{vehicle_id}")
async def update_vehicle(vehicle_id: str, req: Dict[str, Any]):
    doc = await _db.vehicles.find_one({"_id": vehicle_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Araç bulunamadı.")
    fields = validate_vehicle(req, partial=True)
    if "plate_key" in fields and fields["plate_key"] != doc.get("plate_key"):
        dup = await _db.vehicles.find_one({
            "company_id": doc["company_id"],
            "plate_key": fields["plate_key"],
            "_id": {"$ne": vehicle_id},
        })
        if dup:
            raise HTTPException(status_code=400, detail=f"Bu plaka zaten kayıtlı: {dup.get('plate')}")
    fields["updated_at"] = _now()
    await _db.vehicles.update_one({"_id": vehicle_id}, {"$set": fields})
    fresh = await _db.vehicles.find_one({"_id": vehicle_id})
    return {**_clean(fresh), "message": "Araç güncellendi."}


@router.delete("/vehicles/{vehicle_id}")
async def delete_vehicle(vehicle_id: str):
    doc = await _db.vehicles.find_one({"_id": vehicle_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Araç bulunamadı.")
    await trash.soft_delete("vehicles", doc, "vehicle", vehicle_label(doc), note=doc.get("plate") or "")
    return {"status": "success", "message": f"{doc.get('plate') or 'Araç'} çöp kutusuna taşındı."}
