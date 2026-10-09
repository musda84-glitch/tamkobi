#!/usr/bin/env python3
"""Yerel Ethernet etiket köprüsü — telefon/tarayıcı → LAN yazıcı (TSPL :9100).

Kullanım (yazıcıyla aynı Wi‑Fi/LAN'daki bir PC'de):
  python3 scripts/ethernet_print_bridge.py
  # http://0.0.0.0:19100

TamKobi Barkod Etiketi penceresinde:
  Gönderim: Yerel köprü
  Köprü URL: http://<bu-pc-ip>:19100
  Yazıcı IP: örn. 192.168.1.100  Port: 9100
"""
from __future__ import annotations

import argparse
import base64
import ipaddress
import json
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


ALLOWED_PORTS = frozenset(range(9100, 9110)) | {515, 631}


def allowed_host(host: str) -> str:
    ip = ipaddress.ip_address(host.strip())
    if ip.version != 4 or not ip.is_private:
        raise ValueError("Yalnızca özel IPv4")
    return str(ip)


def tcp_send(host: str, port: int, payload: bytes) -> dict:
    h = allowed_host(host)
    p = int(port)
    if p not in ALLOWED_PORTS:
        raise ValueError(f"Port {p} engelli")
    sock = socket.create_connection((h, p), timeout=5)
    try:
        sock.settimeout(8)
        sock.sendall(payload)
    finally:
        sock.close()
    return {"ok": True, "host": h, "port": p, "bytes": len(payload)}


def tcp_probe(host: str, port: int) -> dict:
    h = allowed_host(host)
    p = int(port)
    if p not in ALLOWED_PORTS:
        raise ValueError(f"Port {p} engelli")
    sock = socket.create_connection((h, p), timeout=4)
    sock.close()
    return {"ok": True, "host": h, "port": p, "reachable": True}


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):  # noqa: N802
        if self.path in ("/", "/health"):
            self._json(200, {"ok": True, "service": "tamkobi-ethernet-print-bridge"})
            return
        self._json(404, {"ok": False, "detail": "not found"})

    def do_POST(self):  # noqa: N802
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            self._json(400, {"ok": False, "detail": "JSON bekleniyor"})
            return
        try:
            if self.path == "/probe":
                self._json(200, tcp_probe(body.get("host", ""), int(body.get("port") or 9100)))
                return
            if self.path == "/send":
                if body.get("data_b64"):
                    payload = base64.b64decode(body["data_b64"])
                else:
                    payload = str(body.get("data") or "").encode("utf-8", errors="replace")
                if not payload:
                    raise ValueError("Boş veri")
                self._json(200, tcp_send(body.get("host", ""), int(body.get("port") or 9100), payload))
                return
            self._json(404, {"ok": False, "detail": "not found"})
        except Exception as e:
            self._json(502, {"ok": False, "detail": str(e)})

    def _json(self, code: int, obj: dict):
        data = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self._cors()
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        print(f"[bridge] {self.address_string()} {fmt % args}")


def main():
    ap = argparse.ArgumentParser(description="TamKobi Ethernet etiket köprüsü")
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=19100)
    args = ap.parse_args()
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Ethernet print bridge http://{args.host}:{args.port}  (POST /probe /send)")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
