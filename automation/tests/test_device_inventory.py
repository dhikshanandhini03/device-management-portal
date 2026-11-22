import re

import pytest
from playwright.sync_api import expect

from config.config import DOWNLOADS_DIR
from pages.device_inventory_page import DeviceInventoryPage
from test_data.test_data_factory import DEVICES
from utils.assertions import assert_sorted
from utils.helpers import read_csv_file

pytestmark = [pytest.mark.device_management, pytest.mark.regression]


@pytest.fixture
def inventory(admin_page) -> DeviceInventoryPage:
    return DeviceInventoryPage(admin_page).open()


@pytest.mark.smoke
def test_open_device_inventory(inventory):
    assert inventory.page_title() == "Device Inventory"
    expect(inventory.table).to_be_visible()


def test_device_table_columns_and_rows(inventory, devices):
    headers = [h.strip() for h in inventory.table.locator("thead th").all_inner_texts()]
    for col in ["Device ID", "Serial Number", "MAC Address", "Model", "HW", "Firmware", "IP Address", "Status",
                "Last Seen", "Account", "Region", "Actions"]:
        assert col in headers, f"Missing column {col}: {headers}"
    assert inventory.row_count() == 25
    api_first = devices.list(page_size=25, sort_by="device_id")["items"]
    assert inventory.device_ids() == [d["device_id"] for d in api_first]


def test_search_by_serial_number(inventory, online_device):
    inventory.search(online_device["serial_number"])
    assert inventory.device_ids() == [online_device["device_id"]]
    assert inventory.column("cell-serial") == [online_device["serial_number"]]


def test_search_by_mac_address(inventory, online_device):
    inventory.search(online_device["mac_address"])
    assert inventory.column("cell-mac") == [online_device["mac_address"]]


def test_search_by_device_id(inventory, online_device):
    inventory.search(online_device["device_id"])
    assert inventory.device_ids() == [online_device["device_id"]]


def test_search_nonexistent_device(inventory):
    inventory.search(DEVICES["nonexistent_search"])
    assert inventory.empty_state_visible()
    expect(inventory.rows).to_have_count(0)


def test_filter_online_devices(inventory):
    inventory.filter_status("Online")
    statuses = inventory.statuses()
    assert statuses and set(statuses) == {"ONLINE"}
    expect(inventory.page).to_have_url(re.compile("status=ONLINE"))


def test_filter_offline_devices(inventory, devices):
    inventory.filter_status("Offline")
    statuses = inventory.statuses()
    assert statuses and set(statuses) == {"OFFLINE"}
    assert devices.list(status="OFFLINE", page_size=1)["total"] > 0


def test_filter_by_device_model(inventory):
    model = DEVICES["default_test_model"]
    inventory.filter_model(model)
    models = inventory.column("cell-model")
    assert models and set(models) == {model}


def test_filter_by_firmware_version(inventory, devices):
    version = devices.filters()["firmware_versions"][0]
    inventory.filter_firmware(version)
    firmware = [f.split("\n")[0].strip() for f in inventory.column("cell-firmware")]
    assert firmware and set(firmware) == {version}


def test_filter_by_region(inventory):
    inventory.filter_region("Quebec")
    regions = inventory.column("cell-region")
    assert regions and set(regions) == {"Quebec"}


def test_sort_device_records(inventory):
    inventory.sort_by("serial_number")
    asc = inventory.column("cell-serial")
    assert_sorted(asc, label="serial ascending")
    inventory.sort_by("serial_number")
    desc = inventory.column("cell-serial")
    assert_sorted(desc, descending=True, label="serial descending")
    assert asc[0] != desc[0]


def test_navigate_pagination(inventory):
    first_page = inventory.device_ids()
    assert inventory.pagination_text().startswith("1–25")
    inventory.next_page()
    second_page = inventory.device_ids()
    assert inventory.pagination_text().startswith("26–50")
    assert not set(first_page) & set(second_page)
    inventory.previous_page()
    assert inventory.device_ids() == first_page


def test_change_page_size(inventory):
    inventory.set_page_size(50)
    assert inventory.row_count() == 50
    expect(inventory.page).to_have_url(re.compile("page_size=50"))
    inventory.set_page_size(10)
    assert inventory.row_count() == 10


def test_clear_filters(inventory):
    inventory.filter_status("Offline")
    inventory.filter_region("Ontario")
    filtered_total = inventory.pagination_text()
    inventory.clear_filters()
    assert "status=" not in inventory.page.url and "region=" not in inventory.page.url
    assert inventory.pagination_text() != filtered_total
    expect(inventory.by_id("clear-filters")).to_be_disabled()


def test_export_csv(inventory):
    inventory.filter_region("Atlantic")
    download = inventory.export_csv()
    assert download.suggested_filename.startswith("bell-stb-devices") and download.suggested_filename.endswith(".csv")
    path = DOWNLOADS_DIR / download.suggested_filename
    download.save_as(path)
    assert path.stat().st_size > 0
    inventory.expect_toast("Device inventory exported")


def test_csv_contents_match_api(inventory, devices):
    model = DEVICES["default_test_model"]
    inventory.filter_model(model)
    inventory.filter_region("Atlantic")
    download = inventory.export_csv()
    path = DOWNLOADS_DIR / f"verify-{download.suggested_filename}"
    download.save_as(path)
    headers, rows = read_csv_file(path)
    assert headers == DEVICES["csv_headers"]
    api = devices.list(model=model, region="Atlantic", page_size=500)
    assert len(rows) == api["total"]
    assert {r["Device ID"] for r in rows} == {d["device_id"] for d in api["items"]}
    assert all(r["Model"] == model and r["Region"] == "Atlantic" and r["Data Source"] == "SIMULATED" for r in rows)


@pytest.mark.smoke
def test_open_individual_device_details(inventory):
    device_id = inventory.open_first_device()
    expect(inventory.by_id("device-title")).to_have_text(device_id)
