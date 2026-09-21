from order_edit import order_edit_block_reason


def test_approved_with_draft_invoice_stays_editable():
    order = {"order_status": "approved", "is_invoiced": False, "invoice_id": "inv_draft"}
    invoice = {"status": "draft", "e_type": "e_archive", "gib_status": "Taslak"}
    assert order_edit_block_reason(order, invoice) is None


def test_pending_without_invoice_stays_editable():
    assert order_edit_block_reason({"order_status": "pending"}) is None


def test_issued_earchive_blocks_edit():
    order = {"order_status": "approved", "is_invoiced": True, "invoice_id": "inv_1"}
    invoice = {"status": "approved", "e_type": "e_archive", "gib_status": "GİB'e Gönderildi"}
    assert order_edit_block_reason(order, invoice) == "E-belge kesilmiş sipariş düzenlenemez."


def test_paper_invoice_does_not_block_edit():
    order = {"order_status": "approved", "is_invoiced": True, "invoice_id": "inv_p"}
    invoice = {"status": "approved", "e_type": "paper"}
    assert order_edit_block_reason(order, invoice) is None


def test_draft_dispatch_does_not_block_edit():
    order = {"order_status": "approved", "dispatch_id": "d1"}
    dispatch = {"status": "draft", "e_type": "e_dispatch", "gib_status": "Taslak (e-İrsaliye)"}
    assert order_edit_block_reason(order, None, dispatch) is None


def test_issued_dispatch_blocks_edit():
    order = {"order_status": "shipped", "dispatch_id": "d1"}
    dispatch = {"status": "approved", "e_type": "e_dispatch"}
    assert "E-belge" in (order_edit_block_reason(order, None, dispatch) or "")


def test_cancelled_still_blocked():
    assert order_edit_block_reason({"order_status": "cancelled"}) == "Bu sipariş düzenlenemez."


def test_invoiced_without_invoice_row_blocks():
    assert order_edit_block_reason({"order_status": "approved", "is_invoiced": True})
