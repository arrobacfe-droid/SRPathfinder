"""Backend testing script for Excel Maps API."""
import asyncio
import os
import sys
import uuid
import json
from urllib.parse import urlparse, parse_qs

import httpx
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv('/app/backend/.env')

BASE_URL = "https://dynamic-excel-maps.preview.emergentagent.com"
API = f"{BASE_URL}/api"
MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ['DB_NAME']
CLIENT_ID = os.environ['MS_CLIENT_ID']
REDIRECT_URI = os.environ['MS_REDIRECT_URI']

results = {"passed": [], "failed": []}

def rec(name, ok, detail=""):
    if ok:
        results["passed"].append(name)
        print(f"PASS: {name}")
    else:
        results["failed"].append({"name": name, "detail": detail})
        print(f"FAIL: {name} -- {detail}")

async def main():
    mongo = AsyncIOMotorClient(MONGO_URL)
    db = mongo[DB_NAME]

    fake_session_id = None
    created_map_id = None

    async with httpx.AsyncClient(timeout=30, follow_redirects=False) as c:
        # 1. Root
        r = await c.get(f"{API}/")
        rec("GET /api/ root", r.status_code == 200 and r.json().get("message") == "Excel Maps API",
            f"status={r.status_code} body={r.text[:200]}")

        # 2. MS Auth URL
        r = await c.get(f"{API}/auth/microsoft/url")
        ok = False
        detail = f"status={r.status_code}"
        state = None
        if r.status_code == 200:
            body = r.json()
            url = body.get("url", "")
            state = body.get("state")
            parsed = urlparse(url)
            qs = parse_qs(parsed.query)
            ok = (
                CLIENT_ID in url and
                qs.get("response_type", [""])[0] == "code" and
                qs.get("redirect_uri", [""])[0] == REDIRECT_URI and
                "scope" in qs and
                qs.get("state", [""])[0] == state and
                state is not None
            )
            detail = f"url_ok={ok} state={state}"
        rec("GET /api/auth/microsoft/url", ok, detail)

        # Check state persisted
        if state:
            doc = await db.oauth_states.find_one({"state": state})
            rec("oauth_states persistence", doc is not None, f"doc={doc is not None}")

        # 3. Callback missing code/state -> 400
        r = await c.post(f"{API}/auth/microsoft/callback", json={})
        rec("callback missing code/state -> 400", r.status_code == 400, f"status={r.status_code} body={r.text[:150]}")

        # 4. Callback invalid state -> 400
        r = await c.post(f"{API}/auth/microsoft/callback", json={"code": "abc", "state": "nonexistent-state-xyz"})
        rec("callback invalid state -> 400", r.status_code == 400, f"status={r.status_code} body={r.text[:150]}")

        # 5. /onedrive/files without session -> 401
        # (Header is required, so missing header -> 422; test empty header value)
        r = await c.get(f"{API}/onedrive/files", headers={"X-Session-Id": ""})
        rec("GET /onedrive/files w/o session -> 401", r.status_code == 401, f"status={r.status_code}")

        # 6. /maps without session -> 401
        r = await c.get(f"{API}/maps", headers={"X-Session-Id": ""})
        rec("GET /maps w/o session -> 401", r.status_code == 401, f"status={r.status_code}")

        # 7. /auth/me invalid session -> 401
        r = await c.get(f"{API}/auth/me", headers={"X-Session-Id": "invalid-xyz"})
        rec("GET /auth/me invalid -> 401", r.status_code == 401, f"status={r.status_code}")

        # Inject fake session
        fake_session_id = f"test-sess-{uuid.uuid4()}"
        fake_user_id = f"test-user-{uuid.uuid4()}"
        await db.sessions.insert_one({
            "session_id": fake_session_id,
            "user_id": fake_user_id,
            "display_name": "Test User",
            "email": "test@example.com",
            "access_token": "fake-token",
            "refresh_token": "fake-refresh",
            "created_at": "2025-01-01T00:00:00Z",
            "updated_at": "2025-01-01T00:00:00Z",
        })
        H = {"X-Session-Id": fake_session_id}

        # 8. /auth/me with valid session
        r = await c.get(f"{API}/auth/me", headers=H)
        rec("GET /auth/me valid session", r.status_code == 200 and r.json().get("email") == "test@example.com",
            f"status={r.status_code} body={r.text[:200]}")

        # 9. POST /maps
        payload = {
            "name": "Test Map",
            "file_id": "fake-file-id",
            "file_name": "test.xlsx",
            "sheet_name": "Sheet1",
            "visible_columns": ["A", "B"],
        }
        r = await c.post(f"{API}/maps", headers=H, json=payload)
        ok = r.status_code == 200 and r.json().get("name") == "Test Map"
        if ok:
            created_map_id = r.json().get("id")
        rec("POST /maps", ok, f"status={r.status_code} body={r.text[:200]}")

        # 10. GET /maps list
        r = await c.get(f"{API}/maps", headers=H)
        ok = r.status_code == 200 and any(m.get("id") == created_map_id for m in r.json().get("maps", []))
        rec("GET /maps list", ok, f"status={r.status_code}")

        # 11. GET /maps/{id}
        r = await c.get(f"{API}/maps/{created_map_id}", headers=H)
        rec("GET /maps/{id}", r.status_code == 200 and r.json().get("id") == created_map_id,
            f"status={r.status_code}")

        # 12. PATCH /maps/{id}
        r = await c.patch(f"{API}/maps/{created_map_id}", headers=H,
                          json={"name": "Updated Map", "visible_columns": ["X", "Y", "Z"]})
        body = r.json() if r.status_code == 200 else {}
        ok = r.status_code == 200 and body.get("name") == "Updated Map" and body.get("visible_columns") == ["X", "Y", "Z"]
        rec("PATCH /maps/{id}", ok, f"status={r.status_code} body={r.text[:200]}")

        # 13. PUT points override
        r = await c.put(f"{API}/maps/{created_map_id}/points/2", headers=H,
                        json={"overrides": {"colA": "newval", "colB": 42}})
        body = r.json() if r.status_code == 200 else {}
        ov = (body.get("point_overrides") or {}).get("2") or {}
        ok = r.status_code == 200 and ov.get("colA") == "newval" and ov.get("colB") == 42
        rec("PUT /maps/{id}/points/{row}", ok, f"status={r.status_code} overrides={ov}")

        # 14. DELETE points override
        r = await c.delete(f"{API}/maps/{created_map_id}/points/2", headers=H)
        body = r.json() if r.status_code == 200 else {}
        ov = (body.get("point_overrides") or {}).get("2")
        rec("DELETE /maps/{id}/points/{row}", r.status_code == 200 and ov is None,
            f"status={r.status_code} ov={ov}")

        # 15. DELETE map
        r = await c.delete(f"{API}/maps/{created_map_id}", headers=H)
        rec("DELETE /maps/{id}", r.status_code == 200, f"status={r.status_code}")
        created_map_id = None

        # 16. Logout
        r = await c.post(f"{API}/auth/logout", headers=H)
        rec("POST /auth/logout", r.status_code == 200, f"status={r.status_code}")

        # 17. After logout, /auth/me -> 401
        r = await c.get(f"{API}/auth/me", headers=H)
        rec("GET /auth/me after logout -> 401", r.status_code == 401, f"status={r.status_code}")

    # Cleanup
    await db.sessions.delete_many({"session_id": fake_session_id})
    if created_map_id:
        await db.maps.delete_many({"id": created_map_id})
    # Cleanup any oauth states created
    # (leaves states from other real flows untouched)

    print("\n=== SUMMARY ===")
    print(f"Passed: {len(results['passed'])}")
    print(f"Failed: {len(results['failed'])}")
    for f in results['failed']:
        print(f"  - {f}")

    with open('/app/test_reports/backend_results.json', 'w') as f:
        json.dump(results, f, indent=2)

    mongo.close()
    sys.exit(0 if not results['failed'] else 1)

if __name__ == "__main__":
    asyncio.run(main())
