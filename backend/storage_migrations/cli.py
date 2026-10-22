"""Komut satırı. Dry-run varsayılan; --confirm olmadan yazılmaz.

DSN düz metin olarak verilemez ve çıktıya yazılmaz.
"""
from __future__ import annotations

import argparse
import sys

from . import session as session_mod
from .engine import ApplyResult, apply, plan, status
from .errors import CatalogError, ChecksumError, LegacyTargetError, MigrationError, UsageError
from .masking import mask_dsn, scrub, secret_scope
from .targets import list_targets, parse_target, resolve_dsn


def main(argv=None, catalog=None) -> int:
    with secret_scope():
        try:
            return _main(argv, catalog)
        except (LegacyTargetError, CatalogError, ChecksumError, UsageError) as exc:
            sys.stderr.write(scrub(str(exc)) + "\n")
            return 2
        except MigrationError as exc:
            sys.stderr.write(scrub(str(exc)) + "\n")
            return 1
        except Exception as exc:
            sys.stderr.write(scrub(str(exc)) + "\n")
            return 1


def _main(argv, catalog) -> int:
    parser = argparse.ArgumentParser(prog="python -m storage_migrations")
    parser.add_argument("command", choices=("status", "plan", "apply"))
    parser.add_argument("--target", default="", help="dsn-ref veya legacy dışı hedef")
    parser.add_argument("--dry-run", action="store_true", help="yazma; varsayılan budur")
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="apply yazmasını açar; --dry-run ile birlikte yazılmaz",
    )
    args = parser.parse_args(argv)
    if _looks_like_dsn(args.target):
        raise UsageError("Hedef düz DSN olamaz. dsn-ref veya legacy dışı kip verin.")
    if not str(args.target or "").strip():
        return _print_catalog(catalog)
    spec = parse_target(args.target)
    dry_run = bool(args.dry_run) or not bool(args.confirm)
    write = args.command == "apply" and args.confirm and not args.dry_run
    dsn = resolve_dsn(spec, catalog)
    opened = session_mod.connect(dsn, write=write)
    try:
        if args.command == "status":
            rows = status(opened)
            report = _report(args.command, spec.name, dsn, True, ApplyResult(rows, 0, False))
        elif args.command == "plan":
            rows = plan(opened)
            known = status(opened)
            report = _report(args.command, spec.name, dsn, True, ApplyResult(known, 0, False), planned=rows)
        else:
            result = apply(opened, confirm=bool(args.confirm), dry_run=dry_run)
            report = _report(args.command, spec.name, dsn, not result.wrote, result)
    finally:
        opened.close()
    sys.stdout.write(scrub(report))
    return 0


def _print_catalog(catalog) -> int:
    if catalog is None:
        raise CatalogError("Firma kataloğu yok. Hedef listesi okunmadı.")
    refs = list_targets(catalog)
    if not refs:
        sys.stdout.write("legacy dışı hedef yok\n")
        return 0
    for ref in refs:
        sys.stdout.write(scrub(ref.public()) + "\n")
    return 0


def _looks_like_dsn(value: str) -> bool:
    text = str(value or "").strip()
    if "://" in text:
        return True
    return "@" in text and ":" in text


def _report(command, target, dsn, dry_run, result: ApplyResult, planned=None) -> str:
    lines = [
        f"hedef: {target}",
        f"dsn: {mask_dsn(dsn)}",
        f"mod: {'dry-run' if dry_run else 'apply'}",
    ]
    shown = planned if planned is not None else result.rows
    if command == "plan":
        pending = planned if planned is not None else tuple(row for row in result.rows if row.state != "uygulandı")
        if not pending:
            lines.append("değişiklik yok")
        for row in pending:
            lines.append(_line(row))
    else:
        for row in shown:
            lines.append(_line(row))
    if command == "apply" and dry_run:
        lines.append("yazılmadı")
    elif command == "apply" and not dry_run:
        if result.advanced == 0:
            lines.append("değişiklik yok")
        else:
            lines.append(f"uygulandı: {result.advanced}")
    return "\n".join(lines) + "\n"


def _line(row) -> str:
    return f"{row.version:04d} {row.name} {row.state} {row.step}/{row.total}"
