from comm_service import approval_dispatch_summary, normalize_phone, sms_channel_result


def test_normalize_phone_tr_formats():
    assert normalize_phone("0532 111 22 33") == "5321112233"
    assert normalize_phone("+90 532 111 22 33") == "5321112233"
    assert normalize_phone("00905321112233") == "5321112233"
    assert normalize_phone("123") is None


def test_sms_channel_result_does_not_mark_failed_as_sent():
    assert sms_channel_result({"status": "failed", "sent": 0, "failed": 1, "error": "Geçersiz GSM numarası", "simulated": False}) == {
        "status": "failed",
        "detail": "Geçersiz GSM numarası",
    }
    assert sms_channel_result({"status": "success", "sent": 1, "failed": 0, "simulated": True, "message": "sim"})["status"] == "simulated"
    assert sms_channel_result({"status": "success", "sent": 1, "failed": 0, "simulated": False, "message": "1 SMS gönderildi."})["status"] == "sent"


def test_approval_dispatch_summary_sms_failed():
    assert approval_dispatch_summary({"sms": {"status": "failed", "detail": "Geçersiz GSM numarası"}}) == {
        "status": "failed",
        "message": "Geçersiz GSM numarası",
    }
    mixed = approval_dispatch_summary({
        "sms": {"status": "failed", "detail": "Netgsm 40"},
        "whatsapp": {"status": "sent"},
    })
    assert mixed["status"] == "success"
    assert "SMS başarısız" in mixed["message"]
