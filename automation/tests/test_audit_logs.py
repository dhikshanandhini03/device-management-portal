from datetime import date, datetime, timedelta, timezone

import pytest
from playwright.sync_api import expect

from api.auth_api import AuthApi
from pages.audit_logs_page import AuditLogsPage
from pages.login_page import LoginPage
from test_data.test_data_factory import deployment_name
from utils.assertions import assert_status

pytestmark = [pytest.mark.audit, pytest.mark.regression]


@pytest.fixture
def audit_page(admin_page) -> AuditLogsPage:
    page = AuditLogsPage(admin_page).open()
    page.expect_loaded()
    return page


@pytest.mark.smoke
def test_open_audit_logs(audit_page, admin):
    total = admin.audit(page_size=1)["total"]
    headers = [h.strip() for h in audit_page.by_id("audit-table").locator("thead th").all_inner_texts()]
    assert headers == ["Event ID", "Timestamp", "Username", "Action", "Target resource", "Result", "IP address"]
    assert total > 0


def test_verify_login_records(audit_page, user_factory, admin):
    user = user_factory("READ_ONLY")
    AuthApi().login(user["username"], user["password"])
    audit_page.apply_filters(username=user["username"], action="LOGIN")
    expect(audit_page.rows()).to_have_count(1)
    assert audit_page.attr("data-action") == ["LOGIN"]
    assert audit_page.attr("data-result") == ["SUCCESS"]


def test_verify_logout_records(audit_page, user_factory, browser):
    user = user_factory("READ_ONLY")
    context = browser.new_context(base_url=audit_page.base_url)
    other = context.new_page()
    login = LoginPage(other).open()
    login.login(user["username"], user["password"])
    login.logout()
    context.close()
    audit_page.apply_filters(username=user["username"], action="LOGOUT")
    expect(audit_page.rows()).to_have_count(1)


def test_verify_remote_command_records(audit_page, devices, online_device):
    r = devices.send_command(online_device["device_id"], "SYNC_CONFIG")
    code = r.json()["command_code"]
    audit_page.apply_filters(action="COMMAND_SYNC_CONFIG", target=online_device["device_id"])
    expect(audit_page.rows()).to_have_count(1)
    audit_page.open_first_detail()
    expect(audit_page.by_id("audit-detail-json")).to_contain_text(code)


def test_verify_firmware_deployment_records(audit_page, devices, online_device):
    fw = devices.deployable_firmware(online_device["model"], online_device["firmware_version"])
    r = devices.create_deployment({"name": deployment_name(), "firmware_version_id": fw["id"],
                                   "device_ids": [online_device["device_id"]]})
    code = r.json()["deployment_code"]
    audit_page.apply_filters(action="FIRMWARE_DEPLOYMENT_CREATED", target=code)
    expect(audit_page.rows()).to_have_count(1)
    assert audit_page.attr("data-username") == ["admin"]
    devices.c.post(f"/firmware/deployments/{code}/cancel")


def test_filter_by_username(audit_page):
    audit_page.apply_filters(username="support")
    usernames = audit_page.attr("data-username")
    assert usernames and all("support" in u for u in usernames)


def test_filter_by_action(audit_page):
    audit_page.apply_filters(action="LOGIN_FAILED")
    assert set(audit_page.attr("data-action")) == {"LOGIN_FAILED"}
    assert set(audit_page.attr("data-result")) <= {"FAILURE", "DENIED"}


def test_filter_by_date(audit_page):
    day = date.today() - timedelta(days=3)
    audit_page.apply_filters(date_from=day.isoformat(), date_to=day.isoformat())
    stamps = audit_page.attr("data-timestamp")
    assert stamps
    for s in stamps:
        ts = datetime.fromisoformat(s.replace("Z", "+00:00"))
        assert abs((ts.astimezone(timezone.utc).date() - day).days) <= 1


def test_audit_records_cannot_be_modified(audit_page, admin_api, support_api):
    event_id = admin_api.json("GET", "/audit-logs", params={"page_size": 1})["items"][0]["id"]
    for method in ("PUT", "PATCH", "DELETE"):
        r = admin_api.request(method, f"/audit-logs/{event_id}", json={"action": "TAMPERED"})
        assert_status(r, 405)
    assert_status(support_api.get("/audit-logs"), 403)
    assert admin_api.json("GET", f"/audit-logs/{event_id}")["action"] != "TAMPERED"
    audit_page.open_first_detail()
    dialog = audit_page.by_id("audit-detail-dialog")
    expect(dialog.get_by_role("button")).to_have_count(1)  # only "Close"; no edit/delete controls


def test_denied_access_is_audited(support_api, admin):
    assert_status(support_api.get("/users"), 403)
    result = admin.wait_for_audit(username="support", action="ACCESS_DENIED", result="DENIED")
    assert result["items"][0]["target_id"].endswith("/api/users")
