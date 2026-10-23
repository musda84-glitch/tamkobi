"""python -m storage_migrations status|plan|apply"""
from __future__ import annotations

import sys

from storage_migrations.catalog import load_cli_catalog
from storage_migrations.cli import main
from storage_migrations.errors import CatalogError
from storage_migrations.masking import scrub


def _run() -> int:
    try:
        catalog = load_cli_catalog()
    except CatalogError as exc:
        sys.stderr.write(scrub(str(exc)) + "\n")
        return 2
    return main(catalog=catalog)


if __name__ == "__main__":
    sys.exit(_run())
