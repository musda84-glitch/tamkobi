"""nginx subdomain templates: nginx -t, 301 redirects, noindex, site_rewrite include untouched."""
from __future__ import annotations

import re
import shutil
import socket
import subprocess
import textwrap
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
NGINX_DIR = ROOT / "deploy" / "nginx"
LIB = ROOT / "deploy" / "lib"
REDIRECTS = (NGINX_DIR / "tamkobi-site-redirects.conf").read_text(encoding="utf-8")
SUBDOMAINS = (NGINX_DIR / "tamkobi-subdomains.conf.example").read_text(encoding="utf-8")
YNT_CONF = (NGINX_DIR / "ynt-taiyazilim.conf.example").read_text(encoding="utf-8")
SISTEM_REDIRECT = (NGINX_DIR / "tamkobi-sistem-redirect.conf").read_text(encoding="utf-8")
SITE_REWRITE = (LIB / "site_rewrite.py").read_text(encoding="utf-8")


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _have_nginx() -> bool:
    return shutil.which("nginx") is not None


@pytest.fixture(scope="module")
def openssl_bin():
    p = shutil.which("openssl")
    if not p:
        pytest.skip("openssl yok")
    return p


def test_site_rewrite_does_not_touch_include_lines(tmp_path: Path):
    """site_rewrite.py must not alter include …tamkobi-site-redirects.conf lines."""
    import sys

    sys.path.insert(0, str(LIB))
    from site_rewrite import rewrite_site_root_and_proxy

    root = "/var/www/tamkobi.com"
    site = tmp_path / "tamkobi.com"
    include_line = "    include /etc/nginx/snippets/tamkobi-site-redirects.conf;\n"
    site.write_text(
        "server {\n"
        "  listen 443 ssl;\n"
        "  # managed by Certbot\n"
        "  ssl_certificate /etc/letsencrypt/live/tamkobi.com/fullchain.pem;\n"
        f"  root {root}/frontend/build;\n"
        + include_line
        + "  location /api {\n"
        "      proxy_pass http://127.0.0.1:8000;\n"
        "  }\n"
        "}\n",
        encoding="utf-8",
    )
    before = site.read_text()
    assert "tamkobi-site-redirects.conf" in before
    status, _, _ = rewrite_site_root_and_proxy(site, root)
    assert status == "ok"
    after = site.read_text()
    assert include_line in after
    assert after.count("tamkobi-site-redirects.conf") == before.count("tamkobi-site-redirects.conf")
    # Only root/proxy lines change
    assert "frontend-current" in after
    assert "tamkobi_api" in after
    # site_rewrite source never references the redirects include
    assert "tamkobi-site-redirects" not in SITE_REWRITE


def test_subdomain_templates_have_required_listen_and_noindex():
    assert "listen 85.95.240.184:443 ssl http2;" in SUBDOMAINS
    assert "listen 85.95.240.184:80;" in SUBDOMAINS
    for host in ("app.tamkobi.com", "b2b.tamkobi.com", "ik.tamkobi.com"):
        assert host in SUBDOMAINS
    assert SUBDOMAINS.count('X-Robots-Tag "noindex, nofollow"') >= 3
    assert "proxy_pass http://tamkobi_api;" in SUBDOMAINS
    assert "root /var/www/tamkobi.com/frontend-current;" in SUBDOMAINS
    # Tek SAN: üç blok da app.tamkobi.com cert yolunu kullanır
    assert SUBDOMAINS.count("/etc/letsencrypt/live/app.tamkobi.com/fullchain.pem") == 3
    assert "live/b2b.tamkobi.com" not in SUBDOMAINS
    assert "live/ik.tamkobi.com" not in SUBDOMAINS
    assert SUBDOMAINS.count("proxy_set_header X-Forwarded-Host $host;") == 5
    assert SUBDOMAINS.count("location = /sso {") == 2
    b2b_block = SUBDOMAINS.split("# b2b.tamkobi.com", 1)[1].split("# ik.tamkobi.com", 1)[0]
    assert "location = /sso" not in b2b_block
    assert "location = /sso" in SUBDOMAINS.split("# b2b.tamkobi.com", 1)[0]
    assert "location = /sso" in SUBDOMAINS.split("# ik.tamkobi.com", 1)[1]

    ssl_ex = (NGINX_DIR / "tamkobi-ssl.conf.example").read_text(encoding="utf-8")
    assert ssl_ex.count("listen 85.95.240.184:443 ssl http2;") >= 2
    assert "tamkobi-site-redirects.conf" in ssl_ex
    assert "proxy_set_header X-Forwarded-Host $host;" in ssl_ex


def _parse_redirect_locations(conf: str) -> list[dict]:
    """Read location blocks from tamkobi-site-redirects.conf (comments skipped)."""
    text = "\n".join(ln for ln in conf.splitlines() if not ln.strip().startswith("#"))
    locations = []
    for m in re.finditer(
        r"location\s+(?P<mod>=|\^~|~\*|~)?\s*(?P<pat>\S+)\s*\{(?P<body>.*?)\}",
        text,
        re.S,
    ):
        dest_m = re.search(r"return\s+301\s+(\S+)\s*;", m.group("body"))
        if not dest_m:
            continue
        locations.append({
            "mod": m.group("mod") or "",
            "pat": m.group("pat"),
            "dest": dest_m.group(1),
        })
    return locations


_REDIRECT_LOCATIONS = _parse_redirect_locations(REDIRECTS)


def _redirect_target(path: str) -> str | None:
    """nginx location order against the real snippet: =, then ^~, then ~ in file order."""
    path_only = path.split("?", 1)[0]

    def apply(dest: str) -> str:
        if "$request_uri" in dest:
            return dest.replace("$request_uri", path)
        return dest

    for loc in _REDIRECT_LOCATIONS:
        if loc["mod"] == "=" and path_only == loc["pat"]:
            return apply(loc["dest"])

    best = None
    for loc in _REDIRECT_LOCATIONS:
        if loc["mod"] != "^~":
            continue
        if path_only.startswith(loc["pat"]) and (best is None or len(loc["pat"]) > len(best["pat"])):
            best = loc
    if best is not None:
        return apply(best["dest"])

    for loc in _REDIRECT_LOCATIONS:
        if loc["mod"] not in ("~", "~*"):
            continue
        flags = re.I if loc["mod"] == "~*" else 0
        if re.search(loc["pat"], path_only, flags):
            return apply(loc["dest"])
    return None


@pytest.mark.parametrize(
    "path,expected_prefix",
    [
        ("/panel?x=1", "https://app.tamkobi.com/panel?x=1"),
        ("/invoices/abc", "https://app.tamkobi.com/invoices/abc"),
        ("/mesajlar", "https://app.tamkobi.com/mesajlar"),
        ("/mesajlar/", "https://app.tamkobi.com/mesajlar/"),
        ("/mesajlar?yeni=1", "https://app.tamkobi.com/mesajlar?yeni=1"),
        ("/mesajlar/sohbet", "https://app.tamkobi.com/mesajlar/sohbet"),
        ("/mesajlar/sohbet?c=m%3Au2", "https://app.tamkobi.com/mesajlar/sohbet?c=m%3Au2"),
        ("/portal/T", "https://b2b.tamkobi.com/portal/T"),
        ("/portal", "https://b2b.tamkobi.com/portal"),
        ("/b2b", "https://b2b.tamkobi.com/b2b/giris"),
        ("/b2b/giris", "https://b2b.tamkobi.com/b2b/giris"),
        ("/personelim", "https://ik.tamkobi.com/personelim"),
    ],
)
def test_redirect_rules_preserve_query(path, expected_prefix):
    assert _redirect_target(path) == expected_prefix


@pytest.mark.parametrize(
    "path",
    ["/api/version", "/sistem/giris", "/yasal/kvkk", "/web", "/kayit", "/kurulum", "/robots.txt", "/sitemap.xml"],
)
def test_never_redirect_paths(path):
    assert _redirect_target(path) is None
    # location satırlarında ASLA yönlendirilmeyecek yollar olmamalı (yorumlar hariç)
    loc_lines = [
        ln for ln in REDIRECTS.splitlines()
        if ln.strip().startswith("location ")
    ]
    joined = "\n".join(loc_lines)
    assert "location ^~ /api" not in joined
    assert "/sistem" not in joined
    assert "yasal" not in joined
    assert "/web" not in joined
    assert "/kayit" not in joined
    assert "/kurulum" not in joined


@pytest.mark.skipif(not _have_nginx(), reason="nginx binary required")
def test_nginx_t_subdomain_and_site_templates(tmp_path: Path, openssl_bin):
    """Real `nginx -t` against assembled configs with stub certs."""
    conf_root = tmp_path / "nginx"
    conf_d = conf_root / "conf.d"
    snippets = conf_root / "snippets"
    sites = conf_root / "sites"
    certs = tmp_path / "certs"
    html = tmp_path / "html"
    for d in (conf_d, snippets, sites, certs, html):
        d.mkdir(parents=True)

    # Apex + tek SAN (app) — b2b/ik şablonu da app yolunu kullanır
    for name in ("tamkobi.com", "app.tamkobi.com"):
        cdir = certs / name
        cdir.mkdir()
        subprocess.run(
            [
                openssl_bin, "req", "-x509", "-nodes", "-newkey", "rsa:2048",
                "-keyout", str(cdir / "privkey.pem"),
                "-out", str(cdir / "fullchain.pem"),
                "-days", "1",
                "-subj", f"/CN={name}",
            ],
            check=True,
            capture_output=True,
        )

    shutil.copy(NGINX_DIR / "security-headers.conf", snippets / "tamkobi-security-headers.conf")
    shutil.copy(NGINX_DIR / "tamkobi-site-redirects.conf", snippets / "tamkobi-site-redirects.conf")
    shutil.copy(NGINX_DIR / "spa-routes.map.conf", conf_d / "tamkobi-spa-routes.map.conf")
    (conf_d / "tamkobi-upstream.conf").write_text(
        "upstream tamkobi_api { server 127.0.0.1:18000; keepalive 2; }\n",
        encoding="utf-8",
    )
    # Dummy letsencrypt options (included by SSL templates)
    le = tmp_path / "letsencrypt"
    (le / "options-ssl-nginx.conf").parent.mkdir(parents=True, exist_ok=True)
    # options file at predictable path — rewrite subdomain/ssl templates
    options = tmp_path / "options-ssl-nginx.conf"
    options.write_text("ssl_protocols TLSv1.2 TLSv1.3;\n", encoding="utf-8")
    dh = tmp_path / "ssl-dhparams.pem"
    # minimal dhparam (reuse key gen is heavy) — skip include by rewriting

    def _prep(text: str) -> str:
        text = text.replace("/etc/nginx/snippets/", str(snippets) + "/")
        text = text.replace("/etc/letsencrypt/live/", str(certs) + "/")
        text = text.replace("/etc/letsencrypt/options-ssl-nginx.conf", str(options))
        text = text.replace("ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;", "# ssl_dhparam stub;")
        text = text.replace("/var/www/tamkobi.com/frontend-current", str(html))
        # Unprivileged ports. Apex templates have both bare listen 443 and IP-bind;
        # drop the IP-bind duplicate. Subdomain templates only have IP-bind — rewrite those.
        if re.search(r"listen\s+443\b", text):
            text = re.sub(r"^\s*listen\s+85\.95\.240\.184:443[^;]*;\s*\n", "", text, flags=re.M)
            text = re.sub(r"listen\s+443\b", "listen 127.0.0.1:18443", text)
        else:
            text = re.sub(r"listen\s+85\.95\.240\.184:443\b", "listen 127.0.0.1:18443", text)
        if re.search(r"(?m)^\s*listen\s+80\b", text):
            text = re.sub(r"^\s*listen\s+85\.95\.240\.184:80[^;]*;\s*\n", "", text, flags=re.M)
            text = re.sub(r"(?m)^\s*listen\s+80\b", "listen 127.0.0.1:18080", text)
        else:
            text = re.sub(r"listen\s+85\.95\.240\.184:80\b", "listen 127.0.0.1:18080", text)
        text = re.sub(r"listen\s+\[::\]:443\b", "listen [::]:18444", text)
        text = re.sub(r"listen\s+\[::\]:80\b", "listen [::]:18081", text)
        return text

    # Apex SSL example (listen IP + redirects include)
    ssl_body = _prep((NGINX_DIR / "tamkobi-ssl.conf.example").read_text(encoding="utf-8"))
    (sites / "apex.conf").write_text(ssl_body, encoding="utf-8")
    sub_body = _prep(SUBDOMAINS)
    (sites / "subdomains.conf").write_text(sub_body, encoding="utf-8")

    for sub in ("body", "proxy", "fastcgi", "uwsgi", "scgi"):
        (conf_root / sub).mkdir(exist_ok=True)
    main = conf_root / "nginx.conf"
    main.write_text(
        textwrap.dedent(
            f"""
            worker_processes 1;
            error_log {tmp_path}/error.log;
            pid {tmp_path}/nginx.pid;
            events {{ worker_connections 64; }}
            http {{
                client_body_temp_path {conf_root}/body;
                proxy_temp_path {conf_root}/proxy;
                fastcgi_temp_path {conf_root}/fastcgi;
                uwsgi_temp_path {conf_root}/uwsgi;
                scgi_temp_path {conf_root}/scgi;
                include {conf_d}/*.conf;
                include {sites}/*.conf;
                access_log {tmp_path}/access.log;
            }}
            """
        ).strip()
        + "\n",
        encoding="utf-8",
    )
    # Ensure spa map is loaded: conf.d include already has the map file
    r = subprocess.run(
        ["nginx", "-t", "-c", str(main), "-p", str(conf_root)],
        capture_output=True,
        text=True,
    )
    assert r.returncode == 0, f"nginx -t failed:\n{r.stderr}\n{r.stdout}"


def test_ynt_template_static_requirements():
    assert "listen 85.95.240.184:443 ssl http2;" in YNT_CONF
    assert "listen 85.95.240.184:80;" in YNT_CONF
    assert "server_name ynt.taiyazilim.com;" in YNT_CONF
    assert "/etc/letsencrypt/live/ynt.taiyazilim.com/fullchain.pem" in YNT_CONF
    assert "include /etc/nginx/snippets/tamkobi-security-headers.conf;" in YNT_CONF
    assert 'X-Robots-Tag "noindex, nofollow"' in YNT_CONF
    assert "Disallow: /" in YNT_CONF
    assert "proxy_pass http://tamkobi_api;" in YNT_CONF
    assert "proxy_set_header X-Forwarded-Host $host;" in YNT_CONF
    active = "\n".join(ln for ln in YNT_CONF.splitlines() if not ln.strip().startswith("#"))
    assert "default_server" not in active
    assert "root /var/www/tamkobi.com/frontend-current;" in YNT_CONF
    # sistem redirect snippet
    assert "location ^~ /sistem" in SISTEM_REDIRECT
    assert "https://ynt.taiyazilim.com$request_uri" in SISTEM_REDIRECT
    # Active location lines must not touch /api
    loc_body = "\n".join(
        ln for ln in SISTEM_REDIRECT.splitlines() if not ln.strip().startswith("#")
    )
    assert "location" in loc_body and "/api" not in loc_body


@pytest.mark.skipif(not _have_nginx(), reason="nginx binary required")
def test_nginx_t_ynt_template(tmp_path: Path, openssl_bin):
    """ynt şablonu stub sertifikayla nginx -t geçer."""
    conf_root = tmp_path / "nginx"
    conf_d = conf_root / "conf.d"
    snippets = conf_root / "snippets"
    sites = conf_root / "sites"
    certs = tmp_path / "certs"
    html = tmp_path / "html"
    for d in (conf_d, snippets, sites, certs, html):
        d.mkdir(parents=True)
    cdir = certs / "ynt.taiyazilim.com"
    cdir.mkdir()
    subprocess.run(
        [
            openssl_bin, "req", "-x509", "-nodes", "-newkey", "rsa:2048",
            "-keyout", str(cdir / "privkey.pem"),
            "-out", str(cdir / "fullchain.pem"),
            "-days", "1",
            "-subj", "/CN=ynt.taiyazilim.com",
        ],
        check=True,
        capture_output=True,
    )
    shutil.copy(NGINX_DIR / "security-headers.conf", snippets / "tamkobi-security-headers.conf")
    shutil.copy(NGINX_DIR / "spa-routes.map.conf", conf_d / "tamkobi-spa-routes.map.conf")
    (conf_d / "tamkobi-upstream.conf").write_text(
        "upstream tamkobi_api { server 127.0.0.1:18000; keepalive 2; }\n",
        encoding="utf-8",
    )
    options = tmp_path / "options-ssl-nginx.conf"
    options.write_text("ssl_protocols TLSv1.2 TLSv1.3;\n", encoding="utf-8")

    def _prep(text: str) -> str:
        text = text.replace("/etc/nginx/snippets/", str(snippets) + "/")
        text = text.replace("/etc/letsencrypt/live/", str(certs) + "/")
        text = text.replace("/etc/letsencrypt/options-ssl-nginx.conf", str(options))
        text = text.replace("ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;", "# ssl_dhparam stub;")
        text = text.replace("/var/www/tamkobi.com/frontend-current", str(html))
        text = text.replace("/var/www/letsencrypt", str(html))
        text = re.sub(r"listen\s+85\.95\.240\.184:443\b", "listen 127.0.0.1:18443", text)
        text = re.sub(r"listen\s+85\.95\.240\.184:80\b", "listen 127.0.0.1:18080", text)
        return text

    (sites / "ynt.conf").write_text(_prep(YNT_CONF), encoding="utf-8")
    for sub in ("body", "proxy", "fastcgi", "uwsgi", "scgi"):
        (conf_root / sub).mkdir(exist_ok=True)
    main = conf_root / "nginx.conf"
    main.write_text(
        textwrap.dedent(
            f"""
            worker_processes 1;
            error_log {tmp_path}/error.log;
            pid {tmp_path}/nginx.pid;
            events {{ worker_connections 64; }}
            http {{
                client_body_temp_path {conf_root}/body;
                proxy_temp_path {conf_root}/proxy;
                fastcgi_temp_path {conf_root}/fastcgi;
                uwsgi_temp_path {conf_root}/uwsgi;
                scgi_temp_path {conf_root}/scgi;
                include {conf_d}/*.conf;
                include {sites}/*.conf;
                access_log {tmp_path}/access.log;
            }}
            """
        ).strip()
        + "\n",
        encoding="utf-8",
    )
    r = subprocess.run(
        ["nginx", "-t", "-c", str(main), "-p", str(conf_root)],
        capture_output=True,
        text=True,
    )
    assert r.returncode == 0, f"nginx -t ynt failed:\n{r.stderr}\n{r.stdout}"


@pytest.mark.skipif(not _have_nginx(), reason="nginx binary required")
def test_sistem_redirect_and_ynt_api_noindex(tmp_path: Path):
    """tamkobi.com/sistem → ynt 301 (query korunur); /api/system yönlendirilmez; ynt /api noindex."""
    port_site = _free_port()
    port_ynt = _free_port()
    port_app = _free_port()
    conf_root = tmp_path / "ngx"
    snippets = conf_root / "snippets"
    html = tmp_path / "www"
    for d in (snippets, html, conf_root):
        d.mkdir(parents=True, exist_ok=True)
    shutil.copy(NGINX_DIR / "security-headers.conf", snippets / "tamkobi-security-headers.conf")
    (snippets / "tamkobi-sistem-redirect.conf").write_text(SISTEM_REDIRECT, encoding="utf-8")
    (html / "index.html").write_text("<!doctype html><title>ok</title>", encoding="utf-8")
    for sub in ("body", "proxy", "fastcgi", "uwsgi", "scgi"):
        (conf_root / sub).mkdir(exist_ok=True)

    # Fake upstream for ynt /api
    api_port = _free_port()
    api_proc = subprocess.Popen(
        ["python3", "-c", textwrap.dedent(f"""
            from http.server import BaseHTTPRequestHandler, HTTPServer
            class H(BaseHTTPRequestHandler):
                def do_GET(self):
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(b'{{"ok":true}}')
                def log_message(self, *a):
                    pass
            HTTPServer(("127.0.0.1", {api_port}), H).serve_forever()
        """)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    conf = textwrap.dedent(
        f"""
        worker_processes 1;
        error_log {tmp_path}/e.log;
        pid {tmp_path}/n.pid;
        events {{ worker_connections 32; }}
        http {{
            access_log {tmp_path}/access.log;
            client_body_temp_path {conf_root}/body;
            proxy_temp_path {conf_root}/proxy;
            fastcgi_temp_path {conf_root}/fastcgi;
            uwsgi_temp_path {conf_root}/uwsgi;
            scgi_temp_path {conf_root}/scgi;
            upstream tamkobi_api {{ server 127.0.0.1:{api_port}; }}
            server {{
                listen 127.0.0.1:{port_site};
                server_name tamkobi.com;
                include {snippets}/tamkobi-sistem-redirect.conf;
                location /api/ {{ return 200 "api-ok"; add_header Content-Type text/plain; }}
                location / {{ return 200 "site"; }}
            }}
            server {{
                listen 127.0.0.1:{port_app};
                server_name app.tamkobi.com;
                location / {{ return 200 "app"; }}
            }}
            server {{
                listen 127.0.0.1:{port_ynt};
                server_name ynt.taiyazilim.com;
                add_header X-Robots-Tag "noindex, nofollow" always;
                location /api {{
                    add_header X-Robots-Tag "noindex, nofollow" always;
                    proxy_pass http://tamkobi_api;
                    proxy_set_header Host $host;
                    proxy_set_header X-Forwarded-Host $host;
                }}
                location / {{ return 200 "ynt"; add_header X-Robots-Tag "noindex, nofollow" always; }}
            }}
        }}
        """
    )
    conf_path = conf_root / "nginx.conf"
    conf_path.write_text(conf, encoding="utf-8")
    proc = subprocess.Popen(
        ["nginx", "-c", str(conf_path), "-p", str(conf_root), "-g", "daemon off;"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    try:
        deadline = time.time() + 5
        while time.time() < deadline:
            try:
                with socket.create_connection(("127.0.0.1", port_site), timeout=0.2):
                    break
            except OSError:
                time.sleep(0.05)
                if proc.poll() is not None:
                    err = proc.stderr.read().decode() if proc.stderr else ""
                    pytest.fail(f"nginx exited early: {err}")
        else:
            pytest.fail("nginx did not start")

        def curl(url: str, host: str):
            return subprocess.check_output(
                ["curl", "-sS", "-D", "-", "-o", "/dev/null", "--max-redirs", "0", "-H", f"Host: {host}", url],
                text=True,
            )

        h = curl(f"http://127.0.0.1:{port_site}/sistem/sirketler?x=1", "tamkobi.com")
        assert "301" in h.splitlines()[0]
        assert "Location: https://ynt.taiyazilim.com/sistem/sirketler?x=1" in h

        # /api/system not redirected by ^~ /sistem
        h = curl(f"http://127.0.0.1:{port_site}/api/system/companies", "tamkobi.com")
        assert "301" not in h.splitlines()[0]
        assert "Location:" not in h

        # Host routing: app vs ynt vs site
        h = curl(f"http://127.0.0.1:{port_app}/", "app.tamkobi.com")
        assert "200" in h.splitlines()[0]
        h = curl(f"http://127.0.0.1:{port_ynt}/api/version", "ynt.taiyazilim.com")
        assert "200" in h.splitlines()[0]
        assert "X-Robots-Tag: noindex, nofollow" in h
        h = curl(f"http://127.0.0.1:{port_site}/", "tamkobi.com")
        assert "200" in h.splitlines()[0]
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
        api_proc.terminate()
        try:
            api_proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            api_proc.kill()


@pytest.mark.skipif(not _have_nginx(), reason="nginx binary required")
def test_live_redirects_and_robots_header(tmp_path: Path):
    """Spin a minimal HTTP nginx with redirects + subdomain robots header; curl checks."""
    port_site = _free_port()
    port_app = _free_port()
    port_b2b = _free_port()
    port_ik = _free_port()
    conf_root = tmp_path / "ngx"
    snippets = conf_root / "snippets"
    conf_d = conf_root / "conf.d"
    html = tmp_path / "www"
    for d in (snippets, conf_d, html):
        d.mkdir(parents=True)
    shutil.copy(NGINX_DIR / "security-headers.conf", snippets / "tamkobi-security-headers.conf")
    shutil.copy(NGINX_DIR / "tamkobi-site-redirects.conf", snippets / "tamkobi-site-redirects.conf")
    (html / "index.html").write_text("<!doctype html><title>ok</title>", encoding="utf-8")

    for sub in ("body", "proxy", "fastcgi", "uwsgi", "scgi"):
        (conf_root / sub).mkdir(exist_ok=True)
    conf = textwrap.dedent(
        f"""
        worker_processes 1;
        error_log {tmp_path}/e.log;
        pid {tmp_path}/n.pid;
        events {{ worker_connections 32; }}
            http {{
            access_log {tmp_path}/access.log;
            error_log {tmp_path}/e.log;
            client_body_temp_path {conf_root}/body;
            proxy_temp_path {conf_root}/proxy;
            fastcgi_temp_path {conf_root}/fastcgi;
            uwsgi_temp_path {conf_root}/uwsgi;
            scgi_temp_path {conf_root}/scgi;
            server {{
                listen 127.0.0.1:{port_site};
                server_name tamkobi.com;
                root {html};
                include {snippets}/tamkobi-site-redirects.conf;
                location /api/ {{ return 200 "api-ok"; add_header Content-Type text/plain; }}
                location /sistem {{ return 200 "sistem-ok"; add_header Content-Type text/plain; }}
                location /yasal/ {{ return 200 "yasal-ok"; add_header Content-Type text/plain; }}
                location /web {{ return 200 "web-ok"; add_header Content-Type text/plain; }}
                location / {{ try_files $uri /index.html; }}
            }}
            server {{
                listen 127.0.0.1:{port_app};
                server_name app.tamkobi.com;
                root {html};
                add_header X-Robots-Tag "noindex, nofollow" always;
                location / {{ return 200 "app"; add_header X-Robots-Tag "noindex, nofollow" always; }}
            }}
            server {{
                listen 127.0.0.1:{port_b2b};
                server_name b2b.tamkobi.com;
                add_header X-Robots-Tag "noindex, nofollow" always;
                location / {{ return 200 "b2b"; add_header X-Robots-Tag "noindex, nofollow" always; }}
            }}
            server {{
                listen 127.0.0.1:{port_ik};
                server_name ik.tamkobi.com;
                add_header X-Robots-Tag "noindex, nofollow" always;
                location / {{ return 200 "ik"; add_header X-Robots-Tag "noindex, nofollow" always; }}
            }}
        }}
        """
    )
    conf_path = conf_root / "nginx.conf"
    conf_path.write_text(conf, encoding="utf-8")
    proc = subprocess.Popen(
        ["nginx", "-c", str(conf_path), "-p", str(conf_root), "-g", "daemon off;"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    try:
        deadline = time.time() + 5
        while time.time() < deadline:
            try:
                with socket.create_connection(("127.0.0.1", port_site), timeout=0.2):
                    break
            except OSError:
                time.sleep(0.05)
                if proc.poll() is not None:
                    err = proc.stderr.read().decode() if proc.stderr else ""
                    pytest.fail(f"nginx exited early: {err}")
        else:
            pytest.fail("nginx did not start")

        def curl(url: str, host: str | None = None):
            cmd = ["curl", "-sS", "-D", "-", "-o", "/dev/null", "--max-redirs", "0"]
            if host:
                cmd += ["-H", f"Host: {host}"]
            cmd.append(url)
            out = subprocess.check_output(cmd, text=True)
            return out

        # Redirects from site
        h = curl(f"http://127.0.0.1:{port_site}/panel?x=1", "tamkobi.com")
        assert "301" in h.splitlines()[0]
        assert "Location: https://app.tamkobi.com/panel?x=1" in h

        h = curl(f"http://127.0.0.1:{port_site}/invoices/abc", "tamkobi.com")
        assert "Location: https://app.tamkobi.com/invoices/abc" in h

        h = curl(f"http://127.0.0.1:{port_site}/mesajlar", "tamkobi.com")
        assert "301" in h.splitlines()[0]
        assert "Location: https://app.tamkobi.com/mesajlar" in h

        h = curl(f"http://127.0.0.1:{port_site}/mesajlar?yeni=1", "tamkobi.com")
        assert "301" in h.splitlines()[0]
        assert "Location: https://app.tamkobi.com/mesajlar?yeni=1" in h

        h = curl(f"http://127.0.0.1:{port_site}/mesajlar/sohbet?c=1", "tamkobi.com")
        assert "301" in h.splitlines()[0]
        assert "Location: https://app.tamkobi.com/mesajlar/sohbet?c=1" in h

        h = curl(f"http://127.0.0.1:{port_site}/portal/T", "tamkobi.com")
        assert "Location: https://b2b.tamkobi.com/portal/T" in h

        h = curl(f"http://127.0.0.1:{port_site}/b2b/giris", "tamkobi.com")
        assert "Location: https://b2b.tamkobi.com/b2b/giris" in h

        h = curl(f"http://127.0.0.1:{port_site}/personelim", "tamkobi.com")
        assert "Location: https://ik.tamkobi.com/personelim" in h

        # Never redirect
        for p in ("/api/version", "/sistem/giris", "/yasal/kvkk", "/web"):
            h = curl(f"http://127.0.0.1:{port_site}{p}", "tamkobi.com")
            assert "301" not in h.splitlines()[0], p
            assert "Location:" not in h, p

        # X-Robots-Tag on app/b2b/ik
        for port, name in ((port_app, "app"), (port_b2b, "b2b"), (port_ik, "ik")):
            h = curl(f"http://127.0.0.1:{port}/", f"{name}.tamkobi.com")
            assert "X-Robots-Tag: noindex, nofollow" in h, name
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()


def _wait_nginx(proc: subprocess.Popen, port: int, tmp_path: Path) -> None:
    deadline = time.time() + 5
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                return
        except OSError:
            time.sleep(0.05)
            if proc.poll() is not None:
                err = ""
                if proc.stderr:
                    err = proc.stderr.read().decode()
                log = tmp_path / "e.log"
                extra = log.read_text(encoding="utf-8") if log.exists() else ""
                pytest.fail(f"nginx exited early: {err}\n{extra}")
    pytest.fail("nginx did not start")


def _stop_proc(proc: subprocess.Popen) -> None:
    proc.terminate()
    try:
        proc.wait(timeout=3)
    except subprocess.TimeoutExpired:
        proc.kill()


@pytest.mark.skipif(not _have_nginx(), reason="nginx binary required")
def test_mesajlar_apex_301_beats_spa_404(tmp_path: Path):
    """Apex /mesajlar is 301 (query and subpaths kept), not the SPA map's HTTP 404.

    app.tamkobi.com still serves index.html for the same path via spa-routes.map.conf.
    Marketing paths stay on the apex host.
    """
    port_site = _free_port()
    port_app = _free_port()
    conf_root = tmp_path / "ngx"
    snippets = conf_root / "snippets"
    conf_d = conf_root / "conf.d"
    html = tmp_path / "www"
    for d in (snippets, conf_d, html):
        d.mkdir(parents=True)
    shutil.copy(NGINX_DIR / "tamkobi-site-redirects.conf", snippets / "tamkobi-site-redirects.conf")
    shutil.copy(NGINX_DIR / "spa-routes.map.conf", conf_d / "tamkobi-spa-routes.map.conf")
    (html / "index.html").write_text("<!doctype html><title>mesajlar-ok</title>", encoding="utf-8")
    (html / "404.html").write_text("missing", encoding="utf-8")
    for sub in ("body", "proxy", "fastcgi", "uwsgi", "scgi"):
        (conf_root / sub).mkdir(exist_ok=True)

    spa_fallback = textwrap.dedent(
        """
        location / {
            try_files $uri $uri/ @spa_or_404;
        }
        location @spa_or_404 {
            if ($tamkobi_spa = 0) { return 404; }
            rewrite ^ /index.html last;
        }
        """
    )
    conf = textwrap.dedent(
        f"""
        worker_processes 1;
        error_log {tmp_path}/e.log;
        pid {tmp_path}/n.pid;
        events {{ worker_connections 32; }}
        http {{
            access_log {tmp_path}/access.log;
            client_body_temp_path {conf_root}/body;
            proxy_temp_path {conf_root}/proxy;
            fastcgi_temp_path {conf_root}/fastcgi;
            uwsgi_temp_path {conf_root}/uwsgi;
            scgi_temp_path {conf_root}/scgi;
            include {conf_d}/tamkobi-spa-routes.map.conf;
            server {{
                listen 127.0.0.1:{port_site};
                server_name tamkobi.com;
                root {html};
                include {snippets}/tamkobi-site-redirects.conf;
                error_page 404 /404.html;
                {spa_fallback}
            }}
            server {{
                listen 127.0.0.1:{port_app};
                server_name app.tamkobi.com;
                root {html};
                {spa_fallback}
            }}
        }}
        """
    )
    conf_path = conf_root / "nginx.conf"
    conf_path.write_text(conf, encoding="utf-8")
    proc = subprocess.Popen(
        ["nginx", "-c", str(conf_path), "-p", str(conf_root), "-g", "daemon off;"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    try:
        _wait_nginx(proc, port_site, tmp_path)

        def curl(url: str, host: str) -> tuple[str, str]:
            headers = subprocess.check_output(
                ["curl", "-sS", "-D", "-", "-o", str(tmp_path / "body.txt"), "--max-redirs", "0",
                 "-H", f"Host: {host}", url],
                text=True,
            )
            body = (tmp_path / "body.txt").read_text(encoding="utf-8")
            return headers, body

        cases = [
            ("/mesajlar", "https://app.tamkobi.com/mesajlar"),
            ("/mesajlar/", "https://app.tamkobi.com/mesajlar/"),
            ("/mesajlar?yeni=1", "https://app.tamkobi.com/mesajlar?yeni=1"),
            ("/mesajlar/sohbet?c=m%3Au2", "https://app.tamkobi.com/mesajlar/sohbet?c=m%3Au2"),
        ]
        for path, location in cases:
            headers, _body = curl(f"http://127.0.0.1:{port_site}{path}", "tamkobi.com")
            status = headers.splitlines()[0]
            assert "301" in status, path
            assert f"Location: {location}" in headers, path

        headers, body = curl(f"http://127.0.0.1:{port_site}/hakkimizda", "tamkobi.com")
        assert "200" in headers.splitlines()[0]
        assert "Location:" not in headers
        assert "mesajlar-ok" in body

        headers, _body = curl(f"http://127.0.0.1:{port_site}/bu-yol-yok", "tamkobi.com")
        assert "404" in headers.splitlines()[0]
        assert "Location:" not in headers

        for path in ("/mesajlar", "/mesajlar?yeni=1", "/mesajlar/sohbet"):
            headers, body = curl(f"http://127.0.0.1:{port_app}{path}", "app.tamkobi.com")
            assert "200" in headers.splitlines()[0], path
            assert "Location:" not in headers
            assert "mesajlar-ok" in body
    finally:
        _stop_proc(proc)
