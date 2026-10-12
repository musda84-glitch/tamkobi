"""Exact-line nginx site rewrites for zero-downtime migrate (testable)."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Tuple


def rewrite_site_root_and_proxy(site_path: Path, root: str) -> Tuple[str, int, int]:
    """Replace exact root …/frontend/build and proxy_pass 127.0.0.1:8000 lines.

    Returns (status, root_count, proxy_count) where status is
    'ok', 'already', or raises ValueError on unexpected counts / SSL loss.
    """
    root = root.rstrip("/")
    text = site_path.read_text(encoding="utf-8")
    norm = [ln if ln.endswith("\n") else ln + "\n" for ln in text.splitlines(keepends=True)]

    root_old = f"    root {root}/frontend/build;\n"
    root_new = f"    root {root}/frontend-current;\n"
    proxy_old = "        proxy_pass http://127.0.0.1:8000;\n"
    proxy_new = "        proxy_pass http://tamkobi_api;\n"

    root_n = sum(1 for ln in norm if ln == root_old)
    proxy_n = sum(1 for ln in norm if ln == proxy_old)
    root_new_n = sum(1 for ln in norm if ln == root_new)
    proxy_new_n = sum(1 for ln in norm if ln == proxy_new)

    if root_new_n >= 1 and proxy_new_n >= 1 and root_n == 0 and proxy_n == 0:
        return "already", root_new_n, proxy_new_n

    if not (1 <= root_n <= 2):
        raise ValueError(f"unexpected root line count: {root_n}")
    if not (1 <= proxy_n <= 2):
        raise ValueError(f"unexpected proxy_pass line count: {proxy_n}")

    out = []
    for ln in norm:
        if ln == root_old:
            out.append(root_new)
        elif ln == proxy_old:
            out.append(proxy_new)
        else:
            out.append(ln)
    new_text = "".join(out)
    ssl_re = re.compile(r"ssl_certificate|letsencrypt|managed by Certbot")
    if ssl_re.search(text) and not ssl_re.search(new_text):
        raise ValueError("SSL/Certbot lines would be lost")
    site_path.write_text(new_text, encoding="utf-8")
    return "ok", root_n, proxy_n
