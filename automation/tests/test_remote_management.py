import pytest
from playwright.sync_api import expect

from config.config import COMMAND_STAGE_ORDER
from pages.device_details_page import DeviceDetailsPage
from pages.remote_management_page import RemoteManagementPage
from test_data.test_data_factory import DEVICES
from utils.assertions import assert_status

pytestmark = [pytest.mark.remote_operations, pytest.mark.regression]


@pytest.fixture
def remote(admin_page, online_device) -> RemoteManagementPage:
    return RemoteManagementPage(admin_page).open_for_device(online_device["device_id"])


def _statuses(command: dict) -> list[str]:
    return [h["status"] for h in command["history"]]


@pytest.mark.smoke
def test_open_remote_management(admin_page):
    page = RemoteManagementPage(admin_page).open_for_device()
    assert page.page_title() == "Remote Device Management"
    expect(page.by_id("command-history-table")).to_be_visible()


def test_select_stb(admin_page, online_device):
    page = RemoteManagementPage(admin_page).open_for_device()
    page.select_device(online_device["serial_number"], online_device["device_id"])
    assert page.selected_status() == "ONLINE"
    expect(page.command_button("REBOOT")).to_be_enabled()


def test_trigger_reboot_opens_confirmation(remote, online_device):
    remote.start_command("REBOOT")
    dialog = remote.by_id("command-confirm")
    expect(dialog).to_contain_text("Reboot Device?")
    expect(dialog).to_contain_text(online_device["device_id"])
    remote.cancel()


@pytest.mark.smoke
def test_confirm_reboot_creates_command(remote, online_device, devices):
    code = remote.run_command("REBOOT")
    assert code.startswith("CMD-")
    command = devices.command(code)
    assert command["device_id"] == online_device["device_id"]
    assert command["command_type"] == "REBOOT"
    assert command["requested_by"] == "admin"
    remote.expect_toast(code)


def test_cancel_reboot_creates_nothing(remote, online_device, devices):
    before = devices.commands(device_id=online_device["device_id"])["total"]
    remote.start_command("REBOOT")
    remote.cancel()
    assert devices.commands(device_id=online_device["device_id"])["total"] == before


def test_command_is_not_immediately_successful(remote, devices):
    code = remote.run_command("SYNC_CONFIG")
    created = devices.command(code)
    assert created["status"] in {"PENDING", "QUEUED", "SENT"}, "command must not be marked successful on creation"
    assert created["completed_at"] is None


def test_command_status_progression(remote, devices):
    code = remote.run_command("REBOOT")
    final = devices.wait_for_command(code)
    assert final["status"] == "SUCCESSFUL", final
    assert _statuses(final) == COMMAND_STAGE_ORDER
    stamps = [final[k] for k in ("created_at", "queued_at", "sent_at", "acknowledged_at", "started_at", "completed_at")]
    assert stamps == sorted(stamps), "lifecycle timestamps must be monotonic"


def test_command_execution_result_in_ui(remote, devices):
    code = remote.run_command("REFRESH_INFO")
    assert remote.wait_tracker_status("SUCCESSFUL") == "SUCCESSFUL"
    assert remote.tracker_result() == devices.command(code)["result_message"]


def test_configuration_synchronization(remote, devices, online_device):
    code = remote.run_command("SYNC_CONFIG")
    final = devices.wait_for_command(code)
    assert final["status"] == "SUCCESSFUL"
    assert "synchronised" in final["result_message"].lower()
    events = devices.events(online_device["device_id"], event_type="CONFIG_SYNC")
    assert events["total"] >= 1


def test_restart_application_requires_app_selection(remote, devices):
    remote.start_command("RESTART_APP")
    expect(remote.confirm_button()).to_be_disabled()
    remote.choose_application(DEVICES["default_app_package"])
    expect(remote.confirm_button()).to_be_enabled()
    code = remote.confirm()
    assert devices.command(code)["parameters"]["package_id"] == DEVICES["default_app_package"]


def test_offline_device_command_handling(admin_page, offline_device, devices):
    page = RemoteManagementPage(admin_page).open_for_device(offline_device["device_id"])
    expect(page.by_id("device-offline-warning")).to_be_visible()
    code = page.run_command("REBOOT")
    queued = devices.wait_for_command(code, {"QUEUED"}, timeout=15)
    assert queued["sent_at"] is None, "offline devices must not receive the command"
    assert "OFFLINE" in queued["history"][0]["message"]


def test_command_timeout(devices, offline_device):
    r = devices.send_command(offline_device["device_id"], "SYNC_CONFIG", timeout_seconds=10)
    assert_status(r, 201)
    final = devices.wait_for_command(r.json()["command_code"], timeout=40)
    assert final["status"] == "TIMED_OUT"
    assert "No response" in final["result_message"]


def test_command_timeout_after_delivery(devices, online_device):
    r = devices.send_command(online_device["device_id"], "REFRESH_INFO", timeout_seconds=12,
                             parameters={"simulate_outcome": "NO_RESPONSE"})
    final = devices.wait_for_command(r.json()["command_code"], timeout=45)
    assert final["status"] == "TIMED_OUT"
    assert "SENT" in _statuses(final)


def test_command_failure_is_reported(devices, online_device):
    r = devices.send_command(online_device["device_id"], "SYNC_CONFIG", parameters={"simulate_outcome": "FAILURE"})
    final = devices.wait_for_command(r.json()["command_code"])
    assert final["status"] == "FAILED"
    assert final["result_message"]


def test_command_history(remote, online_device, devices):
    code = remote.run_command("REFRESH_INFO")
    devices.wait_for_command(code)
    remote.filter_history_device(online_device["device_id"])
    row = remote.history_row(code)
    expect(row).to_be_visible()
    expect(row.get_by_test_id("cell-command-status")).to_contain_text("Successful")
    details = DeviceDetailsPage(remote.page).open_device(online_device["device_id"], tab="activity")
    expect(details.command_rows().filter(has_text=code)).to_have_count(1)


def test_factory_reset_requires_serial_confirmation(remote, online_device, devices):
    remote.start_command("FACTORY_RESET")
    expect(remote.confirm_button()).to_be_disabled()
    remote.by_id("command-confirm-input").fill("WRONG-SERIAL")
    expect(remote.confirm_button()).to_be_disabled()
    remote.by_id("command-confirm-input").fill(online_device["serial_number"])
    expect(remote.confirm_button()).to_be_enabled()
    code = remote.confirm()
    assert devices.command(code)["command_type"] == "FACTORY_RESET"


def test_factory_reset_api_rejects_missing_confirmation(devices, online_device):
    r = devices.send_command(online_device["device_id"], "FACTORY_RESET")
    assert_status(r, 422)


def test_readonly_cannot_execute_commands(readonly_page, readonly_api, online_device):
    page = RemoteManagementPage(readonly_page).open_for_device(online_device["device_id"])
    expect(page.by_id("commands-readonly-notice")).to_be_visible()
    for command_type in ("REBOOT", "SYNC_CONFIG", "FACTORY_RESET"):
        expect(page.command_button(command_type)).to_be_disabled()
    r = readonly_api.post("/commands", json={"device_id": online_device["device_id"], "command_type": "REBOOT"})
    assert_status(r, 403)


def test_support_cannot_factory_reset(support_page, support_api, online_device):
    page = RemoteManagementPage(support_page).open_for_device(online_device["device_id"])
    expect(page.command_button("REBOOT")).to_be_enabled()
    expect(page.command_button("FACTORY_RESET")).to_be_disabled()
    r = support_api.post("/commands", json={"device_id": online_device["device_id"], "command_type": "FACTORY_RESET",
                                            "confirmation": online_device["serial_number"]})
    assert_status(r, 403)


def test_duplicate_active_command_rejected(devices, offline_device):
    first = devices.send_command(offline_device["device_id"], "REBOOT")
    assert_status(first, 201)
    second = devices.send_command(offline_device["device_id"], "REBOOT")
    assert_status(second, 409)
