import pytest
from playwright.sync_api import expect

from pages.alerts_page import AlertsPage
from utils.assertions import assert_status

pytestmark = [pytest.mark.alerts, pytest.mark.regression]


@pytest.fixture
def alerts(admin_page) -> AlertsPage:
    return AlertsPage(admin_page).open()


@pytest.mark.smoke
def test_view_all_alerts(alerts, admin_api):
    alerts.filter_status("All statuses")
    total = admin_api.json("GET", "/alerts", params={"page_size": 1})["total"]
    shown = int(alerts.get_text("alerts-total").split()[0])
    # The simulator raises new alerts continuously; allow a small drift between UI and API reads.
    assert abs(shown - total) <= 5
    assert alerts.rows().count() == min(25, shown)


def test_filter_critical_alerts(alerts):
    alerts.filter_status("All statuses")
    alerts.filter_severity("Critical")
    severities = alerts.attr("data-severity")
    assert severities and set(severities) == {"CRITICAL"}


def test_filter_warning_alerts(alerts):
    alerts.filter_severity("Warning")
    assert set(alerts.attr("data-severity")) == {"WARNING"}
    assert set(alerts.attr("data-status")) <= {"OPEN", "ACKNOWLEDGED"}


def test_search_by_device(alerts, device_alert):
    alerts.search(device_alert["device_id"])
    expect(alerts.row(device_alert["alert_code"])).to_be_visible()
    assert set(r for r in alerts.rows().get_by_test_id("alert-device").all_inner_texts()) == {device_alert["device_id"]}


def test_acknowledge_alert(alerts, device_alert, devices):
    alerts.search(device_alert["device_id"])
    alerts.acknowledge(device_alert["alert_code"])
    expect(alerts.row(device_alert["alert_code"])).to_have_attribute("data-status", "ACKNOWLEDGED")
    api = devices.c.json("GET", f"/alerts/{device_alert['alert_code']}")
    assert api["status"] == "ACKNOWLEDGED" and api["acknowledged_by"] == "admin"


def test_resolve_alert(alerts, device_alert, devices):
    alerts.search(device_alert["device_id"])
    alerts.resolve(device_alert["alert_code"], note="Resolved by automation")
    alerts.expect_toast(f"Alert {device_alert['alert_code']} resolved")
    api = devices.c.json("GET", f"/alerts/{device_alert['alert_code']}")
    assert api["status"] == "RESOLVED" and api["resolution_note"] == "Resolved by automation"


def test_alert_status_changes(alerts, device_alert):
    code = device_alert["alert_code"]
    alerts.search(device_alert["device_id"])
    assert alerts.row_status(code) == "OPEN"
    alerts.acknowledge(code)
    expect(alerts.row(code)).to_have_attribute("data-status", "ACKNOWLEDGED")
    expect(alerts.row(code).get_by_test_id("alert-acknowledge")).to_have_count(0)
    alerts.resolve(code)
    # Resolved alerts leave the default "active" view; check them in history.
    alerts.filter_status("Resolved")
    expect(alerts.row(code)).to_have_attribute("data-status", "RESOLVED")
    expect(alerts.row(code).get_by_test_id("alert-resolve")).to_have_count(0)


def test_alert_history(alerts, device_alert):
    code = device_alert["alert_code"]
    alerts.search(device_alert["device_id"])
    alerts.acknowledge(code)
    alerts.resolve(code, note="history check")
    alerts.filter_status("All statuses")
    alerts.open_detail(code)
    expect(alerts.by_id("alert-history-ack")).to_contain_text("by admin")
    expect(alerts.by_id("alert-history-resolved")).to_contain_text("by admin")


def test_unauthorized_alert_operations(readonly_page, readonly_api, device_alert):
    page = AlertsPage(readonly_page).open()
    page.search(device_alert["device_id"])
    row = page.row(device_alert["alert_code"])
    expect(row).to_be_visible()
    expect(row.get_by_test_id("alert-acknowledge")).to_have_count(0)
    expect(row.get_by_test_id("alert-resolve")).to_have_count(0)
    assert_status(readonly_api.post(f"/alerts/{device_alert['alert_code']}/acknowledge"), 403)
    assert_status(readonly_api.post(f"/alerts/{device_alert['alert_code']}/resolve", json={}), 403)


def test_support_engineer_can_acknowledge(support_api, device_alert):
    r = support_api.post(f"/alerts/{device_alert['alert_code']}/acknowledge")
    assert_status(r, 200)
    assert r.json()["acknowledged_by"] == "support"
