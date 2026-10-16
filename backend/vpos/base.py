"""Sanal POS adaptör arayüzü ve aile kaydı."""
from __future__ import annotations

from typing import Any, Dict, Mapping

# Sağlayıcının bildirdiği tutar / para birimi / sipariş intent ile birebir
# eşleşmezse confirm/verify bu kodları döner. Tutar daima intent tutarıdır.
MISMATCH_ERRORS = frozenset({"amount_mismatch", "currency_mismatch", "order_mismatch"})


class VposStartError(Exception):
    """Sağlayıcı oturumu açılamadı. Intent failed yazılır; kart verisi taşımaz."""

    def __init__(self, error: str, detail: str = "", detail_key: str = "reason"):
        super().__init__(error)
        self.error = error or "start_failed"
        self.detail = detail or ""
        self.detail_key = detail_key or "reason"


class VposAdapter:
    """3D yönlendirmeli sanal POS ailesi.

    Kart verisi bu arayüzden geçmez. ``build_3d_form`` yalnız banka sayfasına
    POST edilecek alanları döner; ``verify_callback`` bankanın dönüş formunu
    intent ile karşılaştırır.

    ``start`` / ``confirm`` varsayılanı senkron NestPay metotlarını çağırır;
    yeni aileler bunları ezer.
    """

    family: str = ""
    model: str = ""

    def build_3d_form(self, config: Mapping[str, Any], intent: Mapping[str, Any], return_urls: Mapping[str, Any]) -> Dict[str, Any]:
        """``{action_url, fields}``. ``fields`` kart numarası / CVV içermez."""
        raise NotImplementedError

    def verify_callback(self, config: Mapping[str, Any], intent: Mapping[str, Any], form: Mapping[str, Any]) -> Dict[str, Any]:
        """``{ok, approved, amount, currency, order_id, auth_code, proc_return_code, md_status, error}``.

        ``amount`` daima intent tutarıdır. ``ok`` bütünlük (hash + kimlik),
        ``approved`` bankanın satış onayıdır.
        """
        raise NotImplementedError

    async def start(
        self,
        config: Mapping[str, Any],
        intent: Mapping[str, Any],
        ctx: Mapping[str, Any],
        client: Any = None,
    ) -> Dict[str, Any]:
        """``{kind: form|iframe|redirect, ...}``.

        Varsayılan, NestPay ``build_3d_form`` çıktısını form POST'una çevirir.
        ``client`` yalnız HTTP kullanan aileler içindir; NestPay kullanmaz.
        """
        urls = {
            "ok_url": (ctx or {}).get("ok_url") or (ctx or {}).get("callback_url") or "",
            "fail_url": (ctx or {}).get("fail_url") or (ctx or {}).get("callback_url") or "",
        }
        built = self.build_3d_form(config, intent, urls)
        return {"kind": "form", "action_url": built["action_url"], "fields": built["fields"]}

    async def confirm(
        self,
        config: Mapping[str, Any],
        intent: Mapping[str, Any],
        payload: Mapping[str, Any],
        client: Any = None,
    ) -> Dict[str, Any]:
        """``verify_callback`` ile aynı sözlük. ``amount`` daima intent tutarıdır."""
        return self.verify_callback(config, intent, payload)


FAMILIES: Dict[str, VposAdapter] = {}


def register(adapter: VposAdapter) -> None:
    key = (adapter.family or "").strip().lower()
    if not key:
        raise ValueError("adapter family boş")
    FAMILIES[key] = adapter


def get_adapter(family: str) -> VposAdapter:
    key = (family or "").strip().lower()
    adapter = FAMILIES.get(key)
    if adapter is None:
        raise KeyError(key)
    return adapter
