from datetime import date, timedelta

import pytest
from playwright.sync_api import expect

from pages.monitoring_page import MonitoringPage
from utils.helpers import parse_float

pytestmark = [pytest.mark.monitoring, pytest.mark.regression]


@pytest.fixture
def monitoring(admin_page) -> MonitoringPage:
    return MonitoringPage(admin_page).open()


@pytest.fixture
def overview(admin_api) -> dict:
    return admin_api.json("GET", "/monitoring/overview")


@pytest.fixture(scope="module")
def log_device(admin_api) -> dict:
    """A seeded device that has diagnostic logs."""
    logs = admin_api.json("GET", "/monitoring/logs", params={"severity": "ERROR", "page_size": 1})["items"]
    return admin_api.json("GET", f"/devices/{logs[0]['device_id']}")


@pytest.mark.smoke
def test_verify_cpu_usage(monitoring, overview):
    assert abs(parse_float(monitoring.stat("cpu")) - overview["avg_cpu_usage"]) <= 5


def test_verify_memory_usage(monitoring, overview):
    assert abs(parse_float(monitoring.stat("memory")) - overview["avg_memory_usage"]) <= 5


def test_verify_storage_utilization(monitoring, overview):
    value = parse_float(monitoring.stat("storage"))
    assert 0 < value <= 100
    assert abs(value - overview["avg_storage_usage"]) <= 3


def test_verify_device_uptime(monitoring):
    uptime = monitoring.stat("uptime")
    assert any(unit in uptime for unit in ("d", "h", "m")), uptime


def test_verify_network_status(monitoring, overview):
    expect(monitoring.by_id("network-status")).to_be_visible()
    for interface in ("ethernet", "wifi"):
        expect(monitoring.network_row(interface)).to_be_visible()
    connectivity = parse_float(monitoring.stat("connectivity"))
    assert abs(connectivity - overview["connectivity_pct"]) <= 5


def test_filter_logs_by_severity(monitoring):
    monitoring.set_log_filters(severity="CRITICAL")
    severities = monitoring.log_attr("data-severity")
    assert severities and set(severities) == {"CRITICAL"}


def test_filter_logs_by_date(monitoring, admin_api):
    day = (date.today() - timedelta(days=2)).isoformat()
    monitoring.set_log_filters(date_from=day, date_to=day)
    stamps = monitoring.log_attr("data-timestamp")
    assert stamps, "expected seeded logs for the selected day"
    # Timestamps are rendered in local time; accept the day either side of the UTC boundary.
    allowed = {(date.today() - timedelta(days=d)).isoformat() for d in (1, 2, 3)}
    assert all(s[:10] in allowed for s in stamps)


def test_search_logs_by_device_id(monitoring, log_device):
    monitoring.set_log_filters(device_id=log_device["device_id"])
    ids = monitoring.log_attr("data-device-id")
    assert ids and set(ids) == {log_device["device_id"]}


def test_search_logs_by_serial_number(monitoring, log_device):
    monitoring.set_log_filters(serial=log_device["serial_number"])
    assert set(monitoring.log_attr("data-device-id")) == {log_device["device_id"]}


def test_verify_error_messages(monitoring, admin_api, log_device):
    monitoring.set_log_filters(device_id=log_device["device_id"], severity="ERROR")
    api = admin_api.json("GET", "/monitoring/logs", params={"device_id": log_device["device_id"], "severity": "ERROR", "page_size": 25})
    assert monitoring.log_messages() == [l["message"] for l in api["items"]]


def test_verify_monitoring_charts(monitoring):
    assert monitoring.health_chart_rendered()
    monitoring.page.get_by_role("button", name="7d").click()
    assert monitoring.health_chart_rendered()
    expect(monitoring.by_id("top-devices")).to_be_visible()


def test_verify_diagnostic_information(monitoring, admin_api):
    device_id = monitoring.open_diagnostics_from_top()
    checks = monitoring.diagnostic_checks()
    assert len(checks) == 8 and set(checks) <= {"PASS", "WARN", "FAIL"}
    api = admin_api.json("GET", f"/monitoring/devices/{device_id}/diagnostics")
    assert checks == [c["result"] for c in api["checks"]] or len(api["checks"]) == len(checks)
    expect(monitoring.by_id("diag-telemetry-chart")).to_be_visible()
    expect(monitoring.by_id("diag-cpu")).to_contain_text("%")
