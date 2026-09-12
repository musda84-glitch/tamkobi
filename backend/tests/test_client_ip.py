from starlette.requests import Request

from client_ip import request_ip


def _request(peer, headers):
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": "/",
        "raw_path": b"/",
        "query_string": b"",
        "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
        "client": (peer, 1234),
        "server": ("127.0.0.1", 8000),
    }
    return Request(scope)


def test_loopback_uses_x_real_ip():
    req = _request("127.0.0.1", {"x-real-ip": "203.0.113.9", "x-forwarded-for": "198.51.100.1"})
    assert request_ip(req) == "203.0.113.9"


def test_loopback_xff_last_hop_not_client_spoof():
    req = _request("127.0.0.1", {"x-forwarded-for": "198.51.100.1, 203.0.113.9"})
    assert request_ip(req) == "203.0.113.9"


def test_direct_client_xff_ignored():
    req = _request("198.51.100.20", {"x-forwarded-for": "203.0.113.1"})
    assert request_ip(req) == "198.51.100.20"
