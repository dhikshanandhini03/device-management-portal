import re

import pytest
from playwright.sync_api import expect

from pages.dashboard_page import CHARTS, DashboardPage
from utils.assertions import assert_close

pytestmark = [pytest.mark.dashboard, pytest.mark.regression]

# Online/offline counts move while the simulator runs; allow a small drift between UI and API reads.
DRIFT = 15


@pytest.fixture
def dashboard(admin_page) -> DashboardPage:
    return DashboardPage(admin_page).open()


@pytest.mark.smoke
def test_dashboard_loads(dashboard):
    expect(dashboard.by_id("dashboard-page")).to_be_visible()
    assert dashboard.page_title() == "Fleet Dashboard"
    for card in ("total", "online", "offline", "warning", "critical", "firmware"):
        expect(dashboard.by_id(f"stat-{'firmware-updates' if card == 'firmware' else card + '-devices'}")).to_be_visible()


def test_total_registered_devices(dashboard, admin_api):
    api_total = admin_api.json("GET", "/dashboard/summary")["total_devices"]
    assert_close(dashboard.stat("total"), api_total, 2, "total devices")
    assert dashboard.stat("total") >= 500


def test_online_device_count(dashboard, admin_api):
    assert_close(dashboard.stat("online"), admin_api.json("GET", "/dashboard/summary")["online_devices"], DRIFT, "online")


def test_offline_device_count(dashboard, admin_api):
    assert_close(dashboard.stat("offline"), admin_api.json("GET", "/dashboard/summary")["offline_devices"], DRIFT, "offline")


def test_online_plus_offline_matches_total(dashboard, admin_api):
    s = admin_api.json("GET", "/dashboard/summary")
    assert s["online_devices"] + s["offline_devices"] + s["rebooting_devices"] == s["total_devices"]


def test_warning_device_count(dashboard, admin_api):
    assert_close(dashboard.stat("warning"), admin_api.json("GET", "/dashboard/summary")["warning_devices"], DRIFT, "warning")


def test_critical_device_count(dashboard, admin_api):
    assert_close(dashboard.stat("critical"), admin_api.json("GET", "/dashboard/summary")["critical_devices"], DRIFT, "critical")


def test_firmware_update_available_count(dashboard, admin_api):
    assert_close(dashboard.stat("firmware"), admin_api.json("GET", "/dashboard/summary")["firmware_update_available"], 3,
                 "firmware updates")


@pytest.mark.parametrize("chart", CHARTS)
def test_dashboard_charts_render(dashboard, chart):
    expect(dashboard.chart(chart)).to_be_visible()
    assert dashboard.chart_has_svg(chart)


def test_recent_alerts(dashboard, admin_api):
    activity = admin_api.json("GET", "/dashboard/activity")
    if not activity["recent_alerts"]:
        expect(dashboard.by_id("recent-alerts").get_by_test_id("empty-state")).to_be_visible()
        return
    expect(dashboard.recent_alert_rows().first).to_be_visible()
    assert dashboard.recent_alert_rows().count() == len(activity["recent_alerts"])


def test_recent_device_activity(dashboard):
    expect(dashboard.recent_event_rows().first).to_be_visible()
    assert dashboard.recent_event_rows().count() <= 10
    expect(dashboard.by_id("recently-connected")).to_be_visible()
    expect(dashboard.by_id("recently-disconnected")).to_be_visible()
    expect(dashboard.by_id("recent-admin-activity")).to_be_visible()


def test_dashboard_matches_backend_api(dashboard, admin_api):
    ui = dashboard.all_stats()
    api = admin_api.json("GET", "/dashboard/summary")
    mapping = {"total": "total_devices", "online": "online_devices", "offline": "offline_devices",
               "warning": "warning_devices", "critical": "critical_devices", "firmware": "firmware_update_available"}
    for key, api_key in mapping.items():
        assert_close(ui[key], api[api_key], 2 if key in ("total", "firmware") else DRIFT, key)


def test_stat_card_navigates_to_filtered_inventory(dashboard):
    dashboard.click_stat("offline")
    expect(dashboard.page).to_have_url(re.compile("status=OFFLINE"))
    expect(dashboard.page.get_by_test_id("device-inventory-page")).to_be_visible()
