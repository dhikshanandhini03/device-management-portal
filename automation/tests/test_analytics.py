from datetime import date, timedelta

import pytest
from playwright.sync_api import expect

from config.config import DOWNLOADS_DIR
from pages.analytics_page import CHARTS, AnalyticsPage
from utils.helpers import read_csv_file

pytestmark = [pytest.mark.analytics, pytest.mark.regression]


@pytest.fixture
def analytics(admin_page) -> AnalyticsPage:
    return AnalyticsPage(admin_page).open()


@pytest.mark.smoke
def test_open_analytics_page(analytics):
    assert analytics.page_title() == "Analytics & Reports"
    expect(analytics.by_id("an-total-value")).not_to_have_text("—")


def test_device_distribution_charts(analytics):
    for chart in ("chart-an-models", "chart-an-uptime", "chart-an-applications"):
        assert analytics.chart_rendered(chart)


def test_firmware_distribution(analytics, admin_api):
    assert analytics.chart_rendered("chart-an-firmware")
    report = admin_api.json("GET", "/analytics/report")
    assert sum(f["devices"] for f in report["firmware"]) == report["summary"]["total_devices"]


def test_device_availability_trends(analytics):
    assert analytics.chart_rendered("chart-availability")
    assert analytics.chart_rendered("chart-availability-pct")
    pct = float(analytics.summary("availability").rstrip("%"))
    assert 50 <= pct <= 100


def test_change_date_range(analytics):
    analytics.preset(7)
    regs_7 = analytics.summary("registrations")
    analytics.preset(90)
    regs_90 = analytics.summary("registrations")
    assert int(regs_90.replace(",", "")) >= int(regs_7.replace(",", ""))
    start = (date.today() - timedelta(days=14)).isoformat()
    analytics.set_range(start, date.today().isoformat())
    assert analytics.chart_rendered("chart-availability")


def test_invalid_date_range_is_rejected(analytics):
    analytics.by_id("analytics-from").fill(date.today().isoformat())
    analytics.by_id("analytics-to").fill((date.today() - timedelta(days=5)).isoformat())
    expect(analytics.page.get_by_text("From must be before To")).to_be_visible()
    expect(analytics.by_id("export-report")).to_be_disabled()


@pytest.mark.parametrize("chart", CHARTS)
def test_analytics_charts_render(analytics, chart):
    assert analytics.chart_rendered(chart)


def test_analytics_data_matches_api(analytics, admin_api):
    report = admin_api.json("GET", "/analytics/report")
    assert int(analytics.summary("total").replace(",", "")) == report["summary"]["total_devices"]
    assert analytics.summary("command-success") == f"{report['summary']['command_success_pct']}%"


def test_export_report(analytics):
    download = analytics.export("Device models")
    assert download.suggested_filename == "bell-stb-models-report.csv"
    analytics.expect_toast("Report exported")


def test_exported_report_data(analytics, admin_api):
    download = analytics.export("Device availability")
    path = DOWNLOADS_DIR / f"{analytics.page.context.browser.browser_type.name}-{download.suggested_filename}"
    download.save_as(path)
    headers, rows = read_csv_file(path)
    assert headers[0] == "date" and "availability_pct" in headers and "online" in headers
    report = admin_api.json("GET", "/analytics/report")
    assert abs(len(rows) - len(report["availability"])) <= 1
    assert all(0 <= float(r["availability_pct"]) <= 100 for r in rows)
