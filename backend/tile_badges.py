"""Ana ekran kutucuk rozetleri — sadece sayılar."""


def tile_badge_payload(
    *,
    pending_orders: int = 0,
    incoming_orders: int = 0,
    pickable: int = 0,
    pick_missing: int = 0,
    personnel: int = 0,
    unmatched: int = 0,
    atolye: int = 0,
    edoc: int = 0,
    unread: int = 0,
) -> dict:
    def n(v: object) -> int:
        try:
            return max(0, int(v or 0))
        except (TypeError, ValueError):
            return 0

    return {
        "orders": max(n(pending_orders), n(incoming_orders)),
        "sevk": max(n(pickable), n(pick_missing)),
        "personnel": n(personnel),
        "banking": n(unmatched),
        "atolye": n(atolye),
        "edoc": n(edoc),
        "unread": n(unread),
    }
