from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import build_stamp  # noqa: E402


def test_env_stamp_wins_over_git(monkeypatch):
    monkeypatch.setenv("APP_GIT_SHA", "abcdef1234567890")
    monkeypatch.setenv("APP_GIT_BRANCH", "cursor/build-version-70ae")
    monkeypatch.setenv("APP_BUILD_TIME", "2026-09-11T15:00:00Z")
    monkeypatch.setenv("APP_GIT_MESSAGE", "Merge pull request #8 from musda84-glitch/cursor/use-backend-unit-70ae")
    monkeypatch.setattr(build_stamp, "_git", lambda *a: "should-not-run")
    stamp = build_stamp.read_stamp()
    assert stamp["git_sha"] == "abcdef1234567890"
    assert stamp["git_sha_short"] == "abcdef1"
    assert stamp["git_branch"] == "cursor/build-version-70ae"
    assert stamp["built_at"] == "2026-09-11T15:00:00Z"
    assert stamp["git_message"].startswith("Merge pull request #8")
    assert stamp["source"] == "env"
    assert stamp["service"] == "TamKobi API"


def test_empty_env_falls_back_to_git(monkeypatch):
    monkeypatch.delenv("APP_GIT_SHA", raising=False)
    monkeypatch.delenv("APP_GIT_BRANCH", raising=False)
    monkeypatch.delenv("APP_BUILD_TIME", raising=False)
    monkeypatch.delenv("APP_GIT_MESSAGE", raising=False)

    def fake_git(*args):
        if args[:2] == ("rev-parse", "HEAD"):
            return "feedface99"
        if args[:2] == ("rev-parse", "--abbrev-ref"):
            return "main"
        if args[:2] == ("log", "-1"):
            return "Restart tamkobi-backend on deploy, not a second uvicorn unit"
        return ""

    monkeypatch.setattr(build_stamp, "_git", fake_git)
    stamp = build_stamp.read_stamp()
    assert stamp["git_sha"] == "feedface99"
    assert stamp["git_sha_short"] == "feedfac"
    assert stamp["git_branch"] == "main"
    assert stamp["git_message"].startswith("Restart tamkobi-backend")
    assert stamp["source"] == "git"
    assert stamp["built_at"] is None


def test_no_git_and_no_env_is_unknown(monkeypatch):
    monkeypatch.delenv("APP_GIT_SHA", raising=False)
    monkeypatch.delenv("APP_GIT_BRANCH", raising=False)
    monkeypatch.delenv("APP_BUILD_TIME", raising=False)
    monkeypatch.delenv("APP_GIT_MESSAGE", raising=False)
    monkeypatch.setattr(build_stamp, "_git", lambda *a: "")
    stamp = build_stamp.read_stamp()
    assert stamp["git_sha"] is None
    assert stamp["git_sha_short"] is None
    assert stamp["git_message"] is None
    assert stamp["source"] == "unknown"


def test_short_sha_none():
    assert build_stamp.short_sha(None) is None
    assert build_stamp.short_sha("") is None
    assert build_stamp.short_sha("abc") == "abc"


def test_clean_message_collapses_and_truncates():
    assert build_stamp.clean_message("  a \n b  ") == "a b"
    assert build_stamp.clean_message("") is None
    long = "x" * 200
    cleaned = build_stamp.clean_message(long)
    assert cleaned.endswith("…")
    assert len(cleaned) == 160


def test_rbac_skips_version_endpoint():
    import rbac
    assert "/api/version" in rbac.SKIP_PREFIXES
