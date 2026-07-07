"""Unit tests for _resolve_email introduced in iteration 11."""
import os
import sys

# Ensure backend module is importable
sys.path.insert(0, "/app/backend")

from server import _resolve_email  # noqa: E402


def test_prefers_mail_field():
    assert _resolve_email({"mail": "user@gmail.com"}) == "user@gmail.com"


def test_falls_back_to_other_mails():
    result = _resolve_email({
        "mail": "",
        "otherMails": ["x@y.com"],
        "userPrincipalName": "ugly#EXT#@tenant.onmicrosoft.com",
    })
    assert result == "x@y.com"


def test_decodes_guest_upn():
    result = _resolve_email({
        "mail": None,
        "otherMails": [],
        "userPrincipalName": "sayanwarrior9_gmail.com#EXT#@sayanwarrior9gmail.onmicrosoft.com",
    })
    assert result == "sayanwarrior9@gmail.com"


def test_upn_without_ext():
    assert _resolve_email({"userPrincipalName": "work@company.com"}) == "work@company.com"


def test_empty_dict_returns_none():
    assert _resolve_email({}) is None


def test_ext_without_underscore_returns_local():
    result = _resolve_email({
        "userPrincipalName": "noatsymbol#EXT#@tenant.onmicrosoft.com"
    })
    assert result == "noatsymbol"


def test_mail_is_stripped():
    assert _resolve_email({"mail": "  spaced@x.com  "}) == "spaced@x.com"
