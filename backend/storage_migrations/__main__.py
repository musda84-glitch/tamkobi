"""python -m storage_migrations status|plan|apply"""
from __future__ import annotations

import sys

from storage_migrations.cli import main

if __name__ == "__main__":
    sys.exit(main())
