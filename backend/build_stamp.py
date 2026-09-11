"""Which git commit this API process was built from.

Docker images have no `.git` directory, so the SHA has to be baked in at
build time (`APP_GIT_SHA`). A live checkout (uvicorn on the host) can fall
back to `git rev-parse`. Either way the answer is the same question: "is
the process I'm talking to the commit I think it is?"
"""
from __future__ import annotations

import os
import subprocess
from typing import Any, Dict, Optional

_ENV_SHA = "APP_GIT_SHA"
_ENV_BRANCH = "APP_GIT_BRANCH"
_ENV_BUILT = "APP_BUILD_TIME"


def _env(name: str) -> str:
    return (os.environ.get(name) or "").strip()


def _repo_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _git(*args: str) -> str:
    try:
        out = subprocess.check_output(
            ["git", *args],
            cwd=_repo_root(),
            stderr=subprocess.DEVNULL,
            timeout=2,
        )
        return out.decode("utf-8", "replace").strip()
    except Exception:
        return ""


def short_sha(sha: Optional[str]) -> Optional[str]:
    if not sha:
        return None
    return sha[:7]


def read_stamp() -> Dict[str, Any]:
    env_sha = _env(_ENV_SHA)
    sha = env_sha or _git("rev-parse", "HEAD")
    branch = _env(_ENV_BRANCH) or _git("rev-parse", "--abbrev-ref", "HEAD")
    built_at = _env(_ENV_BUILT)
    if env_sha:
        source = "env"
    elif sha:
        source = "git"
    else:
        source = "unknown"
    return {
        "service": "TamKobi API",
        "git_sha": sha or None,
        "git_sha_short": short_sha(sha),
        "git_branch": branch or None,
        "built_at": built_at or None,
        "source": source,
    }
