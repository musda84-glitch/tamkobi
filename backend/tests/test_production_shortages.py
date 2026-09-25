from production_shortages import merge_shortage_children, shortage_produce_lines


def test_shortage_produce_lines_basic():
    lines, skipped = shortage_produce_lines(
        [
            {"product_id": "p1", "product_name": "Levha", "shortage": 3},
            {"product_id": None, "product_name": "İsimsiz", "shortage": 1},
            {"product_id": "p2", "product_name": "Vida", "shortage": 0},
        ],
        parent_code="URT-1",
    )
    assert len(lines) == 1
    assert lines[0]["product_id"] == "p1"
    assert lines[0]["planned_quantity"] == 3
    assert "URT-1" in lines[0]["notes"]
    assert any(s["reason"] == "stok kartı yok" for s in skipped)


def test_shortage_produce_skips_already():
    lines, skipped = shortage_produce_lines(
        [{"product_id": "p1", "product_name": "A", "shortage": 2}],
        already_pids={"p1"},
        parent_code="URT-9",
    )
    assert lines == []
    assert skipped[0]["reason"] == "zaten üretime alındı"


def test_merge_shortage_children():
    merged = merge_shortage_children(
        [{"product_id": "p1", "order_code": "URT-A"}],
        [{"product_id": "p1", "order_code": "dup"}, {"product_id": "p2", "order_code": "URT-B"}],
    )
    assert [c["product_id"] for c in merged] == ["p1", "p2"]
