from bank_auto_match import contact_matches_text, match_pattern, pick_auto_match_source


def test_match_pattern_strips_noise():
    assert match_pattern("EFT 21.09.2026 ERSAY HOME TEDARIK 1.259,97 TL") == "ersay home tedarik"


def test_contact_matches_bank_description():
    assert contact_matches_text(
        "ERSAY HOME ÜRETİM TEDARİK İÇ VE DIŞ TİCARET LİMİTED ŞTİ.",
        "",
        "ERSAY HOME ÜRETİM TEDARİK HAVALE",
    )
    assert contact_matches_text("Acme Mobilya", "ACME MOBILYA", "gelen eft")
    assert not contact_matches_text("Acme Mobilya", "", "rastgele havale 100 tl")


def test_pick_prefers_rule_then_history_then_cari():
    rule = {"contact_id": "c-rule"}
    prior = {"contact_id": "c-old"}
    sug = {"_id": "c-sug", "name": "Cari"}
    assert pick_auto_match_source(rule, prior, sug) == ("rule", rule)
    assert pick_auto_match_source(None, prior, sug) == ("history", prior)
    assert pick_auto_match_source(None, None, sug) == ("cari", sug)
    assert pick_auto_match_source(None, None, None) == (None, None)
