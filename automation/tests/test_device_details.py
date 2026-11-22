import pytest
from playwright.sync_api import expect

from pages.device_details_page import TABS, DeviceDetailsPage

pytestmark = [pytest.mark.device_management, pytest.mark.regression]


@pytest.fixture
def details(admin_page, online_device) -> DeviceDetailsPage:
    return DeviceDetailsPage(admin_page).open_device(online_device["device_id"])


@pytest.fixture
def seeded_device(devices) -> dict:
    """A seeded, permanently online lab device with rich history (logs, events, telemetry)."""
    items = devices.list(status="ONLINE", page_size=500)["items"]
    return next(d for d in items if d["simulation_profile"] == "STABLE_ONLINE" and not d["customer_ref"].startswith("QA-"))


@pytest.mark.smoke
def test_open_device_details(details, online_device):
    expect(details.by_id("device-details-page")).to_be_visible()
    assert details.active_tab() == "Overview"
    assert details.header_status() == online_device["connection_status"]


def test_verify_serial_number(details, online_device):
    assert details.field("detail-serial") == online_device["serial_number"]


def test_verify_mac_address(details, online_device):
    assert details.field("detail-mac") == online_device["mac_address"]


def test_verify_device_model(details, online_device):
    assert details.field("detail-model") == online_device["model"]


def test_verify_firmware_version(details, online_device):
    assert details.field("detail-firmware") == online_device["firmware_version"]


def test_verify_hardware_information(details, online_device):
    assert details.field("detail-hardware") == online_device["hardware_version"]
    details.select_tab("hardware")
    for gauge in ("cpu", "memory", "storage", "temperature"):
        expect(details.by_id(f"hw-{gauge}")).to_be_visible()


def test_verify_operating_system_version(details, online_device):
    assert details.field("detail-os") == online_device["os_version"]
    details.select_tab("software")
    assert details.field("software-os") == online_device["os_version"]


def test_verify_network_details(details, online_device, devices):
    details.select_tab("network")
    network = devices.network(online_device["device_id"])
    assert details.field("network-ip") == online_device["ip_address"]
    assert details.field("network-mac") == online_device["mac_address"]
    assert details.field("network-type") == ("Wi-Fi" if network["network_type"] == "WIFI" else "Ethernet")
    expect(details.by_id("connection-history")).to_be_visible()


def test_verify_installed_applications(details, online_device, devices):
    details.select_tab("software")
    api_apps = devices.software(online_device["device_id"])["applications"]
    assert sorted(details.app_packages()) == sorted(a["package_id"] for a in api_apps)
    for app in api_apps:
        assert details.app_version(app["package_id"]) == app["version"]


def test_verify_cpu_and_memory(admin_page, seeded_device, devices):
    details = DeviceDetailsPage(admin_page).open_device(seeded_device["device_id"], tab="hardware")
    api = devices.get(seeded_device["device_id"])
    cpu = float(details.gauge_value("cpu").rstrip("%"))
    memory = float(details.gauge_value("memory").rstrip("%"))
    assert 0 <= cpu <= 100 and 0 <= memory <= 100
    assert abs(cpu - api["cpu_usage"]) <= 40 and abs(memory - api["memory_usage"]) <= 25
    expect(details.by_id("hw-telemetry-chart-body").locator("svg.recharts-surface").first).to_be_visible()


def test_verify_device_activity_history(admin_page, seeded_device, devices):
    details = DeviceDetailsPage(admin_page).open_device(seeded_device["device_id"], tab="activity")
    api_total = devices.events(seeded_device["device_id"], page_size=1)["total"]
    assert api_total > 0
    expect(details.event_rows().first).to_be_visible()
    details.filter_events("connection")
    types = details.event_rows().evaluate_all("els => els.map(e => e.getAttribute('data-event-type'))")
    assert set(types) <= {"CONNECTED", "DISCONNECTED", "NETWORK_CHANGE", "NETWORK_LOSS"}
    expect(details.by_id("device-command-history")).to_be_visible()


def test_verify_device_logs(admin_page, seeded_device, devices):
    details = DeviceDetailsPage(admin_page).open_device(seeded_device["device_id"], tab="logs")
    expect(details.log_rows().first).to_be_visible()
    api_logs = devices.logs(seeded_device["device_id"], page_size=25)["items"]
    first_message = details.log_rows().first.get_by_test_id("log-message").inner_text()
    assert first_message == api_logs[0]["message"]
    details.filter_logs("WARNING")
    severities = details.log_severities()
    assert severities == [] or set(severities) == {"WARNING"}


def test_navigate_between_tabs(details):
    for tab in TABS:
        details.select_tab(tab)
        expect(details.by_id(f"tabpanel-{tab}")).to_be_visible()
    details.page.go_back()
    expect(details.by_id("tabpanel-logs")).to_be_visible()


def test_unknown_device_shows_error(admin_page):
    page = DeviceDetailsPage(admin_page)
    page.open("/devices/STB-DOESNOTEXIST")
    expect(page.by_id("error-state")).to_contain_text("not found")
