from decimal import Decimal

import pytest

from app.numbers import detect_style, parse_number


@pytest.mark.parametrize("raw,want", [
    ("1,366,824.38", "1366824.38"), ("1.366.824,38", "1366824.38"), ("1 366 824,38", "1366824.38"), ("1'366'824.38", "1366824.38"),
    ("13,66,824.38", "1366824.38"), ("(1,234.50)", "-1234.50"), ("1,234.50-", "-1234.50"), ("-1.234,50", "-1234.50"),
    ("USD 12,00", "12.00"), ("1.234.567", "1234567"), ("0.5", "0.5"), ("1,5", "1.5"), ("00123", "123"),
])
def test_unambiguous(raw, want):
    p = parse_number(raw)
    assert p.value == Decimal(want) and not p.ambiguous


def test_ambiguous_is_flagged_not_guessed():
    for raw in ("1.366", "1,366"):
        assert parse_number(raw).ambiguous
    assert parse_number("1.366", "comma").value == Decimal("1366") and not parse_number("1.366", "comma").ambiguous
    assert parse_number("1,366", "comma").value == Decimal("1.366")
    assert parse_number("1.366", "dot").value == Decimal("1.366")
    assert parse_number("1,366", "dot").value == Decimal("1366")


def test_bad_grouping_is_rejected():
    assert parse_number("1,23,4567.8").value is None or parse_number("1,23,4567.8").ambiguous


def test_style_detection():
    assert detect_style("Total 1,366,824.38 and 2,500.00") == "dot"
    assert detect_style("Total 1.366.824,38 and 2.500,00") == "comma"
    assert detect_style("nothing here") is None
