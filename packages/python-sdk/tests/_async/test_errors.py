from upstash_box import BoxError


def test_box_error_message_and_status():
    err = BoxError("boom", 500)
    assert str(err) == "boom"
    assert err.message == "boom"
    assert err.status_code == 500


def test_box_error_default_status_none():
    err = BoxError("oops")
    assert err.status_code is None


def test_box_error_is_exception():
    assert isinstance(BoxError("x"), Exception)
