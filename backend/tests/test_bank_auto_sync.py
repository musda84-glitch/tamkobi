import asyncio

from bank_auto_sync import run_bank_auto_sync_tick, should_background_sync


def _live_enpara(**extra):
    return {
        "_id": "conn-1",
        "provider": "enpara",
        "auto_sync": True,
        "status": "connected",
        "mode": "live",
        "access_token": "tok-live",
        **extra,
    }


def test_skips_missing_and_opted_out():
    assert should_background_sync(None) is False
    assert should_background_sync({}) is False
    assert should_background_sync(_live_enpara(auto_sync=False)) is False
    assert should_background_sync(_live_enpara(status="disconnected")) is False
    assert should_background_sync(_live_enpara(mode="simulation")) is False


def test_skips_simulated_without_credentials():
    assert should_background_sync({
        "_id": "sim",
        "provider": "enpara",
        "auto_sync": True,
        "status": "simulated",
        "mode": "live",
    }) is False


def test_includes_live_and_error_with_credentials():
    assert should_background_sync(_live_enpara()) is True
    assert should_background_sync(_live_enpara(status="error")) is True
    assert should_background_sync(_live_enpara(auto_sync=True, access_token="••••abcd")) is False


def test_tick_syncs_only_eligible_and_swallows_errors():
    calls = []

    async def sync_one(conn):
        calls.append(conn["_id"])
        if conn["_id"] == "boom":
            raise RuntimeError("bank down")

    rows = [
        _live_enpara(_id="ok"),
        _live_enpara(_id="off", auto_sync=False),
        {**_live_enpara(_id="sim"), "access_token": "", "status": "simulated"},
        _live_enpara(_id="boom"),
    ]
    synced = asyncio.run(run_bank_auto_sync_tick(rows, sync_one))
    assert calls == ["ok", "boom"]
    assert synced == ["ok"]
