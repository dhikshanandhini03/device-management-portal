"""E2E: fleet monitoring from the dashboard down to a single device's diagnostics."""

import pytest
from playwright.sync_api import expect

from pages.dashboard_page import CHARTS
from pages.devices_page import DeviceDetailsPage, DeviceInventoryPage
from pages.ops_pages import MonitoringPage
from utils import demo_data
from utils.waits import read_csv

pytestmark = [pytest.mark.end_to_end, pytest.mark.devices]


def test_admin_monitors_fleet_and_inspects_device(login, page):
    dashboard = login("admin")
    total, online, offline = dashboard.stat("total"), dashboard.stat("online"), dashboard.stat("offline")
    assert total > 0 and online > 0 and online + offline <= total, (total, online, offline)
    for chart in CHARTS:
        dashboard.expect_chart(chart)

    device = demo_data.stable_online_device(page)
    dashboard.navigate("device-inventory")
    inventory = DeviceInventoryPage(page).expect_loaded()
    inventory.search(device["serial_number"])
    expect(inventory.rows).to_have_count(1)
    assert inventory.column("cell-device-id") == [device["device_id"]]
    inventory.open_device(device["device_id"])

    details = DeviceDetailsPage(page)
    details.expect_status("ONLINE")
    assert details.field("detail-firmware") == device["firmware_version"]
    details.select_tab("network")
    expect(details.by_id("network-ip")).not_to_be_empty()
    details.select_tab("hardware")
    expect(details.by_id("hw-cpu-value")).to_contain_text("%")
    details.select_tab("logs")
    expect(details.by_id("device-logs")).to_be_visible()

    diagnostics = MonitoringPage(page).open_diagnostics(device["device_id"])
    results = diagnostics.diagnostic_results()
    assert len(results) == 8 and set(results) <= {"PASS", "WARN", "FAIL"}, results
    assert results[0] == "PASS", "connectivity check must pass for an online device"
    diagnostics.logout()


def test_inventory_filter_and_csv_export_match(login, page):
    login("readonly")
    inventory = DeviceInventoryPage(page).open()
    inventory.filter_model("VIP4302")
    total = inventory.total()
    assert total == demo_data.model_device_count(page, "VIP4302")
    assert set(inventory.column("cell-model")) == {"VIP4302"}

    rows = read_csv(inventory.download("export-csv"))
    assert rows[0][:2] == ["Device ID", "Serial Number"]
    assert len(rows) - 1 == total
    assert {r[3] for r in rows[1:]} == {"VIP4302"}
