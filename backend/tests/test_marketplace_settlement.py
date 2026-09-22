import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from marketplace_settlement import marketplace_contact_name


def test_marketplace_contact_name():
    assert marketplace_contact_name("trendyol") == "Trendyol"
    assert marketplace_contact_name("TRENDYOL") == "Trendyol"
    assert marketplace_contact_name("hepsiburada") == "Hepsiburada"
    assert marketplace_contact_name("") == "Pazaryeri"
    assert marketplace_contact_name("ozelkanal") == "Ozelkanal"
