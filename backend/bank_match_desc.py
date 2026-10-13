"""Banka eşleştirme açıklaması: Eşleşti: … ekleri (kullanıcı adı yok)."""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

MATCH_PREFIX = "Eşleşti:"
# "… · Eşleşti: …" veya satır sonundaki "Eşleşti: …"
_MATCH_SUFFIX_RE = re.compile(r"(?:\s*[·•]\s*|\s+)Eşleşti:\s*.+$", re.I | re.S)
# Eski: "… · Ayşe Yılmaz eşleştirdi" / "… · Ayşe eşleştirdi (manuel)"
_OLD_ACTOR_VERB_RE = re.compile(
    r"\s*[·•]\s*[^\n·•]+?\s+eşleştirdi(?:\s*\([^)]*\))?\s*$",
    re.I,
)


def match_phrase(
    *,
    contact_name: Optional[str] = None,
    invoice_number: Optional[str] = None,
    target_account_name: Optional[str] = None,
    category: Optional[str] = None,
) -> str:
    """Eşleşme hedefi metni — kullanıcı adı içermez."""
    inv = (invoice_number or "").strip()
    cari = (contact_name or "").strip()
    hedef = (target_account_name or "").strip()
    cat = (category or "").strip()
    if inv:
        return f"{MATCH_PREFIX} Fatura {inv}" + (f" – {cari}" if cari else "")
    if cari:
        return f"{MATCH_PREFIX} {cari} (cari)"
    if hedef:
        return f"{MATCH_PREFIX} {hedef}"
    if cat and not cat.lower().startswith("banka"):
        return f"{MATCH_PREFIX} {cat}"
    return MATCH_PREFIX


def strip_match_suffix(description: str) -> str:
    """Eşleşti: … ve eski «… eşleştirdi» eklerini kaldır."""
    s = str(description or "").rstrip()
    if not s:
        return ""
    prev = None
    while prev != s:
        prev = s
        s = _MATCH_SUFFIX_RE.sub("", s).rstrip()
        s = _OLD_ACTOR_VERB_RE.sub("", s).rstrip()
    return s


def strip_trailing_actor(description: str, actor_name: Optional[str]) -> str:
    """Açıklama sonundaki « · {eşleştiren}» ekini kaldır (eski kayıtlar)."""
    s = strip_match_suffix(description)
    name = (actor_name or "").strip()
    if not name or len(name) < 2:
        return s
    # Tam eşleşme: son segment kullanıcı adı
    for sep in (" · ", " • ", " - "):
        if s.endswith(sep + name):
            return s[: -len(sep + name)].rstrip()
    # Case-insensitive
    low = s.lower()
    suffix = (" · " + name).lower()
    if low.endswith(suffix):
        return s[: -len(suffix)].rstrip()
    return s


def append_match_suffix(description: str, phrase: str) -> str:
    base = strip_match_suffix(description)
    p = (phrase or "").strip()
    if not p:
        return base
    if not base:
        return p
    if p.lower() in base.lower():
        return base
    return f"{base} · {p}"


def phrase_from_tx(tx: Dict[str, Any]) -> str:
    return match_phrase(
        contact_name=tx.get("contact_name"),
        invoice_number=tx.get("related_invoice_number"),
        target_account_name=tx.get("target_account_name"),
        category=tx.get("category"),
    )


def description_needs_rewrite(tx: Dict[str, Any]) -> bool:
    """Eşleşmiş hareket: açıklamada kullanıcı eki var veya Eşleşti: yok."""
    if (tx.get("match_status") or "") != "matched":
        return False
    desc = str(tx.get("description") or "")
    actor = (tx.get("matched_by_name") or "").strip()
    if actor and actor.lower() not in ("sistem", "banka", "kullanıcı"):
        stripped = strip_trailing_actor(desc, actor)
        if stripped != strip_match_suffix(desc):
            return True
        if desc.rstrip().endswith(actor) and "eşleşti:" not in desc.lower():
            # «… · Ayşe» gibi
            if " · " in desc or " • " in desc:
                return True
    if _OLD_ACTOR_VERB_RE.search(desc):
        return True
    phrase = phrase_from_tx(tx)
    if phrase == MATCH_PREFIX:
        return False
    if phrase.lower() not in desc.lower():
        return True
    return False


def rewrite_matched_description(tx: Dict[str, Any]) -> Tuple[str, str]:
    """(eski, yeni) — yeni = orijinal banka metni + Eşleşti: hedef."""
    old = str(tx.get("description") or "")
    actor = (tx.get("matched_by_name") or "").strip()
    base = strip_trailing_actor(old, actor)
    phrase = phrase_from_tx(tx)
    new = append_match_suffix(base, phrase) if phrase != MATCH_PREFIX else base
    return old, new


AUTO_IMPORT_SOURCES = ("bank_sync", "card_statement", "bank_statement")


async def migrate_match_descriptions(db, company_id: str, *, dry_run: bool = True) -> Dict[str, Any]:
    """Şirket bazında eşleşme açıklamalarını düzelt + otomatik aktarım created_by temizle.

    dry_run varsayılan True.
    """
    cid = (company_id or "").strip()
    if not cid:
        return {
            "dry_run": dry_run, "scanned": 0, "would_update": 0, "updated": 0,
            "would_clear_created_by": 0, "cleared_created_by": 0, "samples": [],
        }
    q = {
        "company_id": cid,
        "match_status": "matched",
        "source": {"$in": list(AUTO_IMPORT_SOURCES)},
    }
    rows: List[Dict[str, Any]] = await db.bank_transactions.find(q).to_list(20000)
    samples: List[Dict[str, Any]] = []
    would = 0
    updated = 0
    for tx in rows:
        if not description_needs_rewrite(tx):
            continue
        old_desc, new_desc = rewrite_matched_description(tx)
        if old_desc == new_desc:
            continue
        would += 1
        if len(samples) < 20:
            samples.append({"id": tx.get("_id"), "before": old_desc, "after": new_desc})
        if not dry_run:
            await db.bank_transactions.update_one(
                {"_id": tx["_id"]},
                {"$set": {"description": new_desc}},
            )
            updated += 1

    # Otomatik içe aktarımda created_by oturum kullanıcısı kalmışsa temizle
    actor_q = {
        "company_id": cid,
        "source": {"$in": list(AUTO_IMPORT_SOURCES)},
        "$or": [
            {"created_by_name": {"$exists": True, "$nin": [None, ""]}},
            {"created_by_id": {"$exists": True, "$nin": [None, ""]}},
        ],
    }
    actor_rows: List[Dict[str, Any]] = await db.bank_transactions.find(actor_q).to_list(20000)
    would_clear = len(actor_rows)
    cleared = 0
    if not dry_run:
        for tx in actor_rows:
            await db.bank_transactions.update_one(
                {"_id": tx["_id"]},
                {"$unset": {"created_by_name": "", "created_by_id": ""}},
            )
            cleared += 1

    return {
        "dry_run": dry_run,
        "company_id": cid,
        "scanned": len(rows),
        "would_update": would,
        "updated": updated if not dry_run else 0,
        "would_clear_created_by": would_clear,
        "cleared_created_by": cleared if not dry_run else 0,
        "samples": samples,
        "message": (
            f"{would} açıklama, {would_clear} created_by temizlenecek (dry-run)."
            if dry_run
            else f"{updated} açıklama güncellendi, {cleared} created_by temizlendi."
        ),
    }
