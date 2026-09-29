"""Araçlarım unit tests (no FastAPI server import)."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

import vehicles as veh


def test_normalize_and_plate_key():
    assert veh.normalize_plate("  34 abc 123 ") == "34 ABC 123"
    assert veh.plate_key("34 ABC 123") == "34ABC123"
    assert veh.plate_key("06-tk-01") == "06TK01"


def test_validate_vehicle_requires_plate():
    with pytest.raises(HTTPException) as exc:
        veh.validate_vehicle({"brand": "Ford"})
    assert exc.value.status_code == 400


def test_validate_vehicle_ok():
    out = veh.validate_vehicle({
        "plate": "34 abc 123",
        "brand": "Ford",
        "model": "Transit",
        "year": "2022",
        "status": "active",
        "notes": "Depo araç",
    })
    assert out["plate"] == "34 ABC 123"
    assert out["plate_key"] == "34ABC123"
    assert out["year"] == 2022
    assert out["brand"] == "Ford"


def test_filter_and_summarize():
    rows = [
        {"plate": "34 A 1", "brand": "Ford", "status": "active"},
        {"plate": "06 B 2", "brand": "Fiat", "status": "inactive"},
        {"plate": "35 C 3", "brand": "Ford", "status": "maintenance"},
    ]
    assert len(veh.filter_vehicles(rows, status="active")) == 1
    assert len(veh.filter_vehicles(rows, q="ford")) == 2
    assert veh.summarize(rows) == {"total": 3, "active": 1, "inactive": 1, "maintenance": 1}


def test_create_vehicle_rejects_duplicate_plate():
    mock_db = MagicMock()
    mock_db.vehicles.find_one = AsyncMock(return_value={"_id": "x", "plate": "34 ABC 123"})
    mock_db.vehicles.insert_one = AsyncMock()
    veh.init(mock_db)

    with pytest.raises(HTTPException) as exc:
        asyncio.get_event_loop().run_until_complete(
            veh.create_vehicle({"company_id": "c1", "plate": "34ABC123", "brand": "Ford"})
        )
    assert exc.value.status_code == 400
    mock_db.vehicles.insert_one.assert_not_called()


def test_create_vehicle_inserts():
    mock_db = MagicMock()
    mock_db.vehicles.find_one = AsyncMock(return_value=None)
    mock_db.vehicles.insert_one = AsyncMock()
    veh.init(mock_db)

    out = asyncio.get_event_loop().run_until_complete(
        veh.create_vehicle({
            "company_id": "c1",
            "plate": "34 TK 01",
            "brand": "Ford",
            "model": "Transit",
            "year": 2021,
            "status": "active",
        })
    )
    assert out["plate"] == "34 TK 01"
    assert out["id"].startswith("veh_")
    mock_db.vehicles.insert_one.assert_awaited_once()
