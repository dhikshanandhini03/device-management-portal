"""E2E: reporting, diagnostics and configuration flows."""

import pytest
from playwright.sync_api import expect

from pages.audit_logs_page import AuditLogsPage
from pages.ops_pages import ANALYTICS_CHARTS, AnalyticsPage, MonitoringPage, SettingsPage
from utils.waits import read_csv

pytestmark = [pytest.mark.end_to_end, pytest.mark.reports]


def test_analytics_report_renders_and_exports(login, page):
    login("readonly")
    analytics = AnalyticsPage(page).open()
    for chart in ANALYTICS_CHARTS:
        analytics.expect_chart(chart)
    assert analytics.summary("total").replace(",", "").isdigit()
    rows = read_csv(analytics.export("Device availability"))
    assert rows[0][0] == "date" and "availability_pct" in rows[0]
    assert len(rows) > 20, "30-day availability export should have a row per day"


def test_diagnostic_logs_filter_by_severity(login, page):
    login("support")
    monitoring = MonitoringPage(page).open()
    monitoring.filter_logs(severity="ERROR")
    expect(monitoring.log_rows().first).to_be_visible()
    assert set(monitoring.log_attr("data-severity")) == {"ERROR"}


@pytest.mark.settings
def test_admin_changes_alert_threshold_and_it_is_audited(login, page):
    login("admin")
    settings = SettingsPage(page).open()
    settings.set_number("cpu_alert_threshold", 88)
    SettingsPage(page).open()
    expect(settings.setting_input("cpu_alert_threshold")).to_have_value("88")
    AuditLogsPage(page).open().expect_event("CONFIGURATION_CHANGED", username="admin")


@pytest.mark.settings
def test_read_only_user_cannot_change_settings(login, page):
    login("readonly")
    settings = SettingsPage(page).open()
    expect(settings.setting_input("cpu_alert_threshold")).to_be_disabled()
    expect(settings.by_id("save-settings")).to_have_count(0)
