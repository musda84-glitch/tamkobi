"""Whitespace-tolerant nginx site rewrites for zero-downtime migrate (testable)."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Tuple


def rewrite_site_root_and_proxy(site_path: Path, root: str) -> Tuple[str, int, int]:
    """Replace root …/frontend/build and proxy_pass 127.0.0.1:8000 lines.

    Matching is indentation/whitespace tolerant. Requires at least one match
    each; no upper bound. Certbot/SSL lines must be preserved byte-for-byte
    except for the replaced root/proxy lines.

    Returns (status, root_count, proxy_count) where status is 'ok' or 'already'.
    """
    root = root.rstrip("/")
    root_re = re.escape(root)
    text = site_path.read_text(encoding="utf-8")
    # Preserve original newlines
    lines = text.splitlines(keepends=True)

    root_pat = re.compile(rf"^(\s*)root\s+{root_re}/frontend/build\s*;\s*\n?\Z")
    root_new_pat = re.compile(rf"^(\s*)root\s+{root_re}/frontend-current\s*;\s*\n?\Z")
    proxy_pat = re.compile(r"^(\s*)proxy_pass\s+http://127\.0\.0\.1:8000\s*;\s*\n?\Z")
    proxy_new_pat = re.compile(r"^(\s*)proxy_pass\s+http://tamkobi_api\s*;\s*\n?\Z")

    root_n = sum(1 for ln in lines if root_pat.match(ln))
    proxy_n = sum(1 for ln in lines if proxy_pat.match(ln))
    root_new_n = sum(1 for ln in lines if root_new_pat.match(ln))
    proxy_new_n = sum(1 for ln in lines if proxy_new_pat.match(ln))

    if root_new_n >= 1 and proxy_new_n >= 1 and root_n == 0 and proxy_n == 0:
        return "already", root_new_n, proxy_new_n

    if root_n < 1:
        raise ValueError(f"unexpected root line count: {root_n}")
    if proxy_n < 1:
        raise ValueError(f"unexpected proxy_pass line count: {proxy_n}")

    out = []
    for ln in lines:
        m_root = root_pat.match(ln)
        m_proxy = proxy_pat.match(ln)
        if m_root:
            indent = m_root.group(1)
            nl = "\n" if ln.endswith("\n") else ""
            out.append(f"{indent}root {root}/frontend-current;{nl}")
        elif m_proxy:
            indent = m_proxy.group(1)
            nl = "\n" if ln.endswith("\n") else ""
            out.append(f"{indent}proxy_pass http://tamkobi_api;{nl}")
        else:
            out.append(ln)
    new_text = "".join(out)

    # Certbot markers / ssl lines must survive unchanged (count equality)
    ssl_re = re.compile(r"ssl_certificate|letsencrypt|managed by Certbot")
    old_ssl = ssl_re.findall(text)
    new_ssl = ssl_re.findall(new_text)
    if old_ssl != new_ssl:
        raise ValueError("SSL/Certbot lines would be lost or altered")
    # Also require every "# managed by Certbot" line to remain identical
    cert_lines_old = [ln for ln in lines if "managed by Certbot" in ln or "ssl_certificate" in ln]
    cert_lines_new = [ln for ln in out if "managed by Certbot" in ln or "ssl_certificate" in ln]
    if cert_lines_old != cert_lines_new:
        raise ValueError("Certbot/ssl_certificate lines must be preserved exactly")

    site_path.write_text(new_text, encoding="utf-8")
    return "ok", root_n, proxy_n
