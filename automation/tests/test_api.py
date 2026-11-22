"""REST API tests (no browser): status codes, schemas, validation, authentication, authorisation and persistence."""

import pytest

from api.api_client import ApiClient
from api.auth_api import AuthApi
from test_data import test_data_factory as factory
from utils.assertions import (
    ALERT_SCHEMA,
    APPLICATION_SCHEMA,
    AUDIT_SCHEMA,
    COMMAND_SCHEMA,
    DEPLOYMENT_SCHEMA,
    DEVICE_SCHEMA,
    FIRMWARE_SCHEMA,
    USER_SCHEMA,
    assert_required_fields,
    assert_schema,
    assert_status,
    page_schema,
)

pytestmark = [pytest.mark.api, pytest.mark.regression]


# ---------------------------------------------------------------- authentication
@pytest.mark.smoke
def test_login_returns_token_and_permissions(credentials):
    creds = credentials("admin")
    r = AuthApi().login_raw(creds.username, creds.password)
    assert_status(r, 200)
    body = r.json()
    assert_required_fields(body, ["access_token", "token_type", "expires_at", "user"])
    assert body["token_type"] == "bearer"
    assert "users:manage" in body["user"]["permissions"]


def test_login_with_email(credentials):
    creds = credentials("support")
    r = AuthApi().login_raw("support@bellstb.local", creds.password)
    assert_status(r, 200)
    assert r.json()["user"]["username"] == creds.username


@pytest.mark.parametrize("payload,status", [
    ({"username": factory.USERS["invalid_password_user"], "password": "wrong-password"}, 401),
    ({"username": "nobody-here", "password": "x"}, 401),
    ({"username": "", "password": "x"}, 422),
    ({"username": "admin"}, 422),
])
def test_login_invalid(payload, status):
    assert_status(ApiClient().post("/auth/login", json=payload), status)


def test_me_requires_authentication():
    assert_status(ApiClient().get("/auth/me"), 401)


def test_invalid_token_rejected():
    assert_status(ApiClient(token="not.a.jwt").get("/devices"), 401)


def test_me_returns_role(support_api):
    me = support_api.json("GET", "/auth/me")
    assert me["role"] == "SUPPORT_ENGINEER"
    assert "commands:execute" in me["permissions"] and "commands:factory_reset" not in me["permissions"]


def test_logout_is_audited(user_factory, admin):
    user = user_factory("READ_ONLY")
    client = AuthApi().login(user["username"], user["password"])
    assert_status(client.post("/auth/logout"), 200)
    assert admin.wait_for_audit(username=user["username"], action="LOGOUT")["total"] == 1


# ---------------------------------------------------------------- devices
def test_device_inventory_schema(readonly_api):
    body = readonly_api.json("GET", "/devices", params={"page_size": 10})
    assert_schema(body, page_schema(DEVICE_SCHEMA))
    assert body["total"] >= 500 and len(body["items"]) == 10


@pytest.mark.parametrize("params", [{"status": "ONLINE"}, {"status": "OFFLINE"}, {"region": "Quebec"}, {"health": "WARNING"}])
def test_device_filters(readonly_api, params):
    items = readonly_api.json("GET", "/devices", params={**params, "page_size": 100})["items"]
    key, value = next(iter(params.items()))
    field = {"status": "connection_status", "health": "health_status"}.get(key, key)
    assert all(d[field] == value for d in items)


def test_device_sorting(readonly_api):
    items = readonly_api.json("GET", "/devices", params={"sort_by": "serial_number", "sort_dir": "desc", "page_size": 50})["items"]
    serials = [d["serial_number"] for d in items]
    assert serials == sorted(serials, reverse=True)


@pytest.mark.parametrize("params", [{"sort_by": "password"}, {"page": 0}, {"page_size": 1000}, {"status": "BROKEN"}])
def test_device_list_invalid_params(readonly_api, params):
    assert_status(readonly_api.get("/devices", params=params), 422)


def test_device_details_and_404(readonly_api, online_device):
    d = readonly_api.json("GET", f"/devices/{online_device['device_id']}")
    assert_schema(d, DEVICE_SCHEMA)
    assert_required_fields(d, ["cpu_usage", "memory_usage", "storage_usage", "uptime_seconds", "network_type"])
    assert_status(readonly_api.get("/devices/STB-00000000X"), 404)


def test_device_subresources(readonly_api, online_device):
    did = online_device["device_id"]
    for sub in ("network", "software", "applications", "telemetry", "events", "logs", "commands", "alerts"):
        assert_status(readonly_api.get(f"/devices/{did}/{sub}"), 200)


def test_device_telemetry_history(readonly_api, devices):
    device = devices.first(status="ONLINE", sort_by="registered_at")
    raw = readonly_api.json("GET", f"/devices/{device['device_id']}/telemetry", params={"hours": 2})
    weekly = readonly_api.json("GET", f"/devices/{device['device_id']}/telemetry", params={"hours": 168})
    assert weekly["resolution"] == "hourly" and len(weekly["points"]) > 24
    assert raw["resolution"] in ("raw", "hourly")
    assert all(0 <= p["cpu_usage"] <= 100 for p in weekly["points"])
    assert_status(readonly_api.get(f"/devices/{device['device_id']}/telemetry", params={"hours": 0}), 422)


def test_device_creation_persists(devices, online_device):
    stored = devices.get(online_device["device_id"])
    assert stored["serial_number"] == online_device["serial_number"]
    assert stored["simulation_profile"] == "STABLE_ONLINE"
    assert devices.list(search=online_device["serial_number"])["total"] == 1


@pytest.mark.parametrize("override,status", [
    ({"mac_address": "ZZ:ZZ"}, 422),
    ({"serial_number": "bad serial"}, 422),
    ({"ip_address": "999.1.1.1"}, 422),
    ({"model": "Unknown Model X"}, 422),
])
def test_device_creation_validation(admin_api, override, status):
    assert_status(admin_api.post("/devices", json={**factory.device_payload(), **override}), status)


def test_device_duplicate_rejected(admin_api, online_device):
    payload = factory.device_payload()
    payload["serial_number"] = online_device["serial_number"]
    assert_status(admin_api.post("/devices", json=payload), 409)


def test_device_creation_requires_admin(support_api, readonly_api):
    for client in (support_api, readonly_api):
        assert_status(client.post("/devices", json=factory.device_payload()), 403)


def test_device_export_csv(readonly_api):
    r = readonly_api.get("/devices/export", params={"region": "Manitoba"})
    assert_status(r, 200)
    assert r.headers["content-type"].startswith("text/csv")
    assert r.text.splitlines()[0].startswith("Device ID,Serial Number")


# ---------------------------------------------------------------- commands
def test_command_lifecycle_api(devices, online_device):
    r = devices.send_command(online_device["device_id"], "REFRESH_INFO")
    assert_status(r, 201)
    assert_schema(r.json(), COMMAND_SCHEMA)
    assert r.json()["status"] == "PENDING"
    final = devices.wait_for_command(r.json()["command_code"])
    assert final["status"] == "SUCCESSFUL"
    assert [h["status"] for h in final["history"]][-1] == "SUCCESSFUL"


@pytest.mark.parametrize("body", [
    {"command_type": "REBOOT"},
    {"device_id": "STB-1", "command_type": "SELF_DESTRUCT"},
    {"device_id": "STB-1", "command_type": "REBOOT", "timeout_seconds": 1},
])
def test_command_invalid_requests(admin_api, body):
    assert_status(admin_api.post("/commands", json=body), 422)


def test_command_unknown_device(admin_api):
    assert_status(admin_api.post("/commands", json={"device_id": "STB-NOPE0000", "command_type": "REBOOT"}), 404)


def test_app_command_requires_installed_app(devices, online_device):
    r = devices.send_command(online_device["device_id"], "RESTART_APP", parameters={"package_id": "com.example.missing"})
    assert_status(r, 422)


def test_command_list_filters(readonly_api):
    items = readonly_api.json("GET", "/commands", params={"status": "SUCCESSFUL", "page_size": 50})["items"]
    assert items and all(c["status"] == "SUCCESSFUL" for c in items)


# ---------------------------------------------------------------- firmware & applications
def test_firmware_schema(readonly_api):
    items = readonly_api.json("GET", "/firmware")
    for fw in items:
        assert_schema(fw, FIRMWARE_SCHEMA)
    latest_models = [f["model"] for f in items if f["is_latest"]]
    assert len(latest_models) == len(set(latest_models)), "exactly one latest firmware per model"


def test_deployments_schema(readonly_api):
    body = readonly_api.json("GET", "/firmware/deployments", params={"page_size": 5})
    assert_schema(body, page_schema(DEPLOYMENT_SCHEMA))
    for d in body["items"]:
        assert d["successful_count"] + d["failed_count"] + d["pending_count"] + d["in_progress_count"] == d["target_count"]


def test_deployment_requires_targets(admin_api):
    fw = admin_api.json("GET", "/firmware")[0]
    assert_status(admin_api.post("/firmware/deployments", json={"name": "x" * 5, "firmware_version_id": fw["id"],
                                                                 "device_ids": []}), 422)


def test_applications_schema_and_detail(readonly_api):
    apps = readonly_api.json("GET", "/applications")
    for a in apps:
        assert_schema(a, APPLICATION_SCHEMA)
        assert a["latest_count"] + a["update_available_count"] == a["device_count"]
    detail = readonly_api.json("GET", f"/applications/{apps[0]['id']}")
    assert sum(v["device_count"] for v in detail["versions"]) == detail["device_count"]
    assert_status(readonly_api.get("/applications/999999"), 404)


# ---------------------------------------------------------------- monitoring, alerts, analytics
def test_monitoring_overview(readonly_api):
    o = readonly_api.json("GET", "/monitoring/overview")
    assert_required_fields(o, ["avg_cpu_usage", "avg_memory_usage", "avg_storage_usage", "avg_uptime_seconds",
                               "connectivity_pct", "network", "app_crashes_24h", "device_errors_24h"])
    assert 0 <= o["avg_cpu_usage"] <= 100


def test_monitoring_logs_filters(readonly_api):
    body = readonly_api.json("GET", "/monitoring/logs", params={"severity": "ERROR,CRITICAL", "page_size": 50})
    assert all(l["severity"] in ("ERROR", "CRITICAL") for l in body["items"])


def test_alerts_schema_and_summary(readonly_api):
    body = readonly_api.json("GET", "/alerts", params={"page_size": 20, "status": "OPEN"})
    assert_schema(body, page_schema(ALERT_SCHEMA))
    summary = readonly_api.json("GET", "/alerts/summary")
    # The simulator keeps raising/auto-resolving alerts, so allow a small drift between the two reads.
    assert abs(summary["open"] - body["total"]) <= 5


def test_alert_lifecycle_api(support_api, device_alert):
    code = device_alert["alert_code"]
    assert_status(support_api.post(f"/alerts/{code}/acknowledge"), 200)
    assert_status(support_api.post(f"/alerts/{code}/acknowledge"), 409)
    resolved = support_api.json("POST", f"/alerts/{code}/resolve", json={"note": "api test"})
    assert resolved["status"] == "RESOLVED" and resolved["resolved_by"] == "support"
    assert_status(support_api.post(f"/alerts/{code}/resolve", json={}), 409)


def test_analytics_report(readonly_api):
    r = readonly_api.json("GET", "/analytics/report", params={"date_from": "2026-01-01T00:00:00Z"})
    assert_required_fields(r, ["summary", "availability", "registrations", "firmware", "models", "uptime", "failures",
                               "applications", "activity"])
    assert_status(readonly_api.get("/analytics/report", params={"date_from": "2026-05-01T00:00:00Z",
                                                                 "date_to": "2026-04-01T00:00:00Z"}), 422)
    assert_status(readonly_api.get("/analytics/export", params={"report": "secrets"}), 422)


# ---------------------------------------------------------------- users & audit
def test_user_crud_and_persistence(admin_api, admin):
    payload = factory.user_payload("READ_ONLY")
    r = admin_api.post("/users", json=payload)
    assert_status(r, 201)
    user = r.json()
    assert_schema(user, USER_SCHEMA)
    try:
        updated = admin_api.json("PATCH", f"/users/{user['id']}", json={"role": "SUPPORT_ENGINEER"})
        assert updated["role"] == "SUPPORT_ENGINEER"
        assert admin_api.json("GET", f"/users/{user['id']}")["role"] == "SUPPORT_ENGINEER"
        assert admin.wait_for_audit(action="USER_ROLE_CHANGED", target=payload["username"])["total"] == 1
    finally:
        admin.deactivate_user(user["id"])


@pytest.mark.parametrize("override", [{"password": p} for p in factory.USERS["weak_passwords"]] +
                         [{"email": "bad"}, {"username": "a b"}, {"role": "SUPERUSER"}])
def test_user_validation(admin_api, override):
    assert_status(admin_api.post("/users", json={**factory.user_payload(), **override}), 422)


def test_users_require_admin(support_api, readonly_api):
    for client in (support_api, readonly_api):
        assert_status(client.get("/users"), 403)


def test_audit_logs_schema_and_immutability(admin_api, readonly_api):
    body = admin_api.json("GET", "/audit-logs", params={"page_size": 10})
    assert_schema(body, page_schema(AUDIT_SCHEMA))
    event_id = body["items"][0]["id"]
    assert_status(admin_api.delete(f"/audit-logs/{event_id}"), 405)
    assert_status(readonly_api.get("/audit-logs"), 403)


def test_settings_require_admin(support_api, admin_api):
    assert_status(support_api.put("/settings", json={"values": {"cpu_alert_threshold": "95"}}), 403)
    assert_status(admin_api.put("/settings", json={"values": {"cpu_alert_threshold": "5"}}), 422)
    assert_status(admin_api.put("/settings", json={"values": {"unknown": "1"}}), 422)


def test_health_and_openapi():
    client = ApiClient()
    assert client.json("GET", "/health")["status"] == "ok"
    spec = client.json("GET", "/openapi.json")
    assert "/api/devices" in spec["paths"] and "/api/commands" in spec["paths"]
