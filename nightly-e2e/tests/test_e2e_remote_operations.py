"""E2E: remote device operations with role enforcement and audit trail."""

import pytest
from playwright.sync_api import expect

from pages.audit_logs_page import AuditLogsPage
from pages.devices_page import COMMAND_BUTTONS, DeviceDetailsPage
from utils import demo_data

pytestmark = [pytest.mark.end_to_end, pytest.mark.remote_operations]


def test_support_reboots_device_and_admin_sees_audit(login, page):
    dashboard = login("support")
    device = demo_data.stable_online_device(page)
    details = DeviceDetailsPage(page).open_device(device["device_id"])
    details.open_remote_actions()
    expect(details.command_button("FACTORY_RESET")).to_be_disabled()

    code = details.run_command("REBOOT")
    assert details.wait_command(["SUCCESSFUL", "FAILED", "TIMED_OUT"]) == "SUCCESSFUL"
    expect(details.by_id("command-result")).to_contain_text("rebooted")
    details.expect_status("ONLINE")

    details.select_tab("activity")
    expect(details.command_row(code)).to_be_visible()
    expect(page.locator("[data-testid='event-row'][data-event-type='REBOOT']").first).to_be_visible()
    dashboard.logout()

    login("admin")
    AuditLogsPage(page).open().expect_event("COMMAND_REBOOT", username="support", target=device["device_id"])


def test_admin_syncs_configuration_and_device_reports_it(login, page):
    login("admin")
    device = demo_data.stable_online_device(page)
    details = DeviceDetailsPage(page).open_device(device["device_id"])
    details.open_remote_actions()
    details.run_command("SYNC_CONFIG")
    assert details.wait_command(["SUCCESSFUL", "FAILED", "TIMED_OUT"]) == "SUCCESSFUL"
    details.select_tab("activity")
    expect(page.locator("[data-testid='event-row'][data-event-type='CONFIG_SYNC']").first).to_contain_text("remote request")


def test_read_only_user_cannot_execute_commands(login, page):
    login("readonly")
    device = demo_data.stable_online_device(page)
    details = DeviceDetailsPage(page).open_device(device["device_id"], tab="remote")
    expect(details.by_id("commands-readonly-notice")).to_be_visible()
    for command in COMMAND_BUTTONS:
        expect(details.command_button(command)).to_be_disabled()


def test_offline_device_shows_delivery_warning(login, page):
    login("support")
    device = demo_data.stable_offline_device(page)
    details = DeviceDetailsPage(page).open_device(device["device_id"], tab="remote")
    details.expect_status("OFFLINE")
    expect(details.by_id("device-offline-warning")).to_be_visible()
