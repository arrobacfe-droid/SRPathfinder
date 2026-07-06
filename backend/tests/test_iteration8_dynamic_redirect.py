"""Iteration 8: dynamic OAuth redirect_uri validation and callback state persistence."""
import os
import urllib.parse as up
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/') if os.environ.get('REACT_APP_BACKEND_URL') else None
if not BASE_URL:
    # fallback for local
    BASE_URL = "https://dynamic-excel-maps.preview.emergentagent.com"

ENV_REDIRECT = "https://dynamic-excel-maps.preview.emergentagent.com/auth/callback"
PROD_REDIRECT = "https://dynamic-excel-maps.emergent.host/auth/callback"

MONGO_URL = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
DB_NAME = os.environ.get('DB_NAME', 'test_database')


def _get_url(params=None):
    return requests.get(f"{BASE_URL}/api/auth/microsoft/url", params=params or {}, timeout=15)


def _extract_qp(url, key):
    q = up.urlparse(url).query
    return up.parse_qs(q).get(key, [None])[0]


# ---- Validation cases ----

def test_production_redirect_accepted():
    r = _get_url({"redirect_uri": PROD_REDIRECT})
    assert r.status_code == 200
    data = r.json()
    assert data["redirect_uri"] == PROD_REDIRECT
    assert _extract_qp(data["url"], "redirect_uri") == PROD_REDIRECT


def test_preview_redirect_accepted():
    r = _get_url({"redirect_uri": ENV_REDIRECT})
    assert r.status_code == 200
    data = r.json()
    assert data["redirect_uri"] == ENV_REDIRECT


def test_no_redirect_uses_env_fallback():
    r = _get_url()
    assert r.status_code == 200
    assert r.json()["redirect_uri"] == ENV_REDIRECT


def test_malicious_redirect_rejected():
    r = _get_url({"redirect_uri": "https://malicious.com/auth/callback"})
    assert r.status_code == 200
    data = r.json()
    assert data["redirect_uri"] == ENV_REDIRECT  # fallback
    assert "malicious.com" not in data["url"]


def test_wrong_path_rejected():
    r = _get_url({"redirect_uri": "https://dynamic-excel-maps.emergent.host/other/path"})
    assert r.status_code == 200
    assert r.json()["redirect_uri"] == ENV_REDIRECT


def test_localhost_accepted():
    r = _get_url({"redirect_uri": "http://localhost:3000/auth/callback"})
    assert r.status_code == 200
    assert r.json()["redirect_uri"] == "http://localhost:3000/auth/callback"


def test_not_a_url_rejected():
    r = _get_url({"redirect_uri": "not_a_url"})
    assert r.status_code == 200
    assert r.json()["redirect_uri"] == ENV_REDIRECT


def test_emergent_host_subdomain_accepted():
    r = _get_url({"redirect_uri": "https://foo.emergent.host/auth/callback"})
    assert r.status_code == 200
    assert r.json()["redirect_uri"] == "https://foo.emergent.host/auth/callback"


def test_lookalike_host_rejected():
    r = _get_url({"redirect_uri": "https://foo.emergent.host.evil.com/auth/callback"})
    assert r.status_code == 200
    data = r.json()
    assert data["redirect_uri"] == ENV_REDIRECT
    assert "evil.com" not in data["url"]


# ---- Mongo persistence ----

def test_state_persisted_with_custom_redirect():
    r = _get_url({"redirect_uri": PROD_REDIRECT})
    assert r.status_code == 200
    state = r.json()["state"]

    client = MongoClient(MONGO_URL)
    try:
        db = client[DB_NAME]
        doc = db.oauth_states.find_one({"state": state})
        assert doc is not None
        assert doc["redirect_uri"] == PROD_REDIRECT
        db.oauth_states.delete_one({"state": state})
    finally:
        client.close()


def test_state_persisted_with_env_fallback():
    r = _get_url()
    state = r.json()["state"]

    client = MongoClient(MONGO_URL)
    try:
        db = client[DB_NAME]
        doc = db.oauth_states.find_one({"state": state})
        assert doc is not None
        assert doc["redirect_uri"] == ENV_REDIRECT
        db.oauth_states.delete_one({"state": state})
    finally:
        client.close()


# ---- Callback ----

def test_callback_invalid_state():
    r = requests.post(
        f"{BASE_URL}/api/auth/microsoft/callback",
        json={"code": "fake_code", "state": "nonexistent_state_xyz"},
        timeout=15,
    )
    assert r.status_code == 400
    assert "Invalid state" in r.text


def test_callback_missing_fields():
    r = requests.post(f"{BASE_URL}/api/auth/microsoft/callback", json={}, timeout=15)
    assert r.status_code == 400


def test_callback_uses_stored_redirect_not_client_error():
    """With a valid state but fake code, MS returns invalid_grant (not AADSTS7000215).
    This proves the server sends the stored redirect_uri (matching what we asked)."""
    r = _get_url({"redirect_uri": PROD_REDIRECT})
    state = r.json()["state"]

    cb = requests.post(
        f"{BASE_URL}/api/auth/microsoft/callback",
        json={"code": "invalid_fake_code_for_test", "state": state},
        timeout=30,
    )
    # Expect 400 token exchange failure — but NOT AADSTS7000215 (redirect_uri mismatch)
    assert cb.status_code == 400
    body = cb.text
    assert "AADSTS7000215" not in body, f"Client-side redirect mismatch detected: {body}"
    # It should be invalid_grant / invalid_client / similar
    assert "Token exchange failed" in body or "invalid" in body.lower()
