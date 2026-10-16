"""Sanal POS adaptör arayüzü ve aile kaydı."""
from __future__ import annotations

from typing import Any, Dict, Mapping


class VposAdapter:
    """3D yönlendirmeli sanal POS ailesi.

    Kart verisi bu arayüzden geçmez. ``build_3d_form`` yalnız banka sayfasına
    POST edilecek alanları döner; ``verify_callback`` bankanın dönüş formunu
    intent ile karşılaştırır.
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
