"""BizimHesap ürün foto URL normalizasyonu."""
from migration import _bh_photo_url


def test_bh_photo_http():
    assert _bh_photo_url({"photo": "https://cdn.example.com/a.jpg"}) == "https://cdn.example.com/a.jpg"


def test_bh_photo_relative():
    assert _bh_photo_url({"photo": "/uploads/p1.png"}) == "https://bizimhesap.com/uploads/p1.png"
    assert _bh_photo_url({"imageUrl": "uploads/x.jpg"}) == "https://bizimhesap.com/uploads/x.jpg"


def test_bh_photo_protocol_relative():
    assert _bh_photo_url({"photoUrl": "//cdn.bizimhesap.com/x.webp"}) == "https://cdn.bizimhesap.com/x.webp"


def test_bh_photo_nested_and_empty():
    assert _bh_photo_url({"image": {"url": "https://x.test/i.jpg"}}) == "https://x.test/i.jpg"
    assert _bh_photo_url({"photo": ""}) is None
    assert _bh_photo_url({"photo": "null"}) is None
    assert _bh_photo_url({}) is None
