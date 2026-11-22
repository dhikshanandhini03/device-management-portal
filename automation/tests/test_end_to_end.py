"""Business workflows spanning several modules, executed through the UI and verified against the backend."""

import re

import pytest
from playwright.sync_api import expect

from config.config import COMMAND_STAGE_ORDER
from pages.audit_logs_page import AuditLogsPage
from pages.dashboard_page import DashboardPage
from pages.device_details_page import DeviceDetailsPage
from pages.device_inventory_page import DeviceInventoryPage
from pages.firmware_page import DeploymentDetailsPage, FirmwarePage
from pages.login_page import LoginPage
from pages.remote_management_page import RemoteManagementPage
from pages.user_management_page import UserManagementPage
from test_data import test_data_factory as factory
from utils.assertions import assert_status
from utils.screenshot_helper import capture

pytestmark = [pytest.mark.end_to_end, pytest.mark.regression]


@pytest.mark.smoke
def test_workflow_device_monitoring(page, credentials, online_device, devices):
    """WORKFLOW 1: admin checks fleet health and inspects a single STB."""
    creds = credentials("admin")
    LoginPage(page).open().login(creds.username, creds.password)

    dashboard = DashboardPage(page)
    dashboard.wait_for_stats()
    online, offline, total = dashboard.stat("online"), dashboard.stat("offline"), dashboard.stat("total")
    assert online > 0 and offline >= 0 and online + offline <= total

    dashboard.navigate_via_sidebar("device-inventory")
    inventory = DeviceInventoryPage(page)
    inventory.search(online_device["serial_number"])
    inventory.open_device(online_device["device_id"])

    details = DeviceDetailsPage(page)
    assert details.field("detail-firmware") == online_device["firmware_version"]
    assert details.header_status() == "ONLINE"
    details.select_tab("hardware")
    expect(details.by_id("hw-cpu-value")).to_contain_text("%")
    details.select_tab("logs")
    expect(details.by_id("device-logs")).to_be_visible()
    capture(page, "workflow1_device_monitoring")

    details.logout()
    expect(page.get_by_test_id("login-title")).to_be_visible()


def test_workflow_remote_reboot(page, credentials, online_device, devices, admin):
    """WORKFLOW 2: support engineer reboots an STB and verifies execution, reconnection and audit."""
    creds = credentials("support")
    LoginPage(page).open().login(creds.username, creds.password)

    DashboardPage(page).navigate_via_sidebar("device-inventory")
    inventory = DeviceInventoryPage(page)
    inventory.search(online_device["device_id"])
    inventory.open_device(online_device["device_id"])

    details = DeviceDetailsPage(page)
    details.by_id("open-remote-actions").click()
    remote = RemoteManagementPage(page)
    code = remote.run_command("REBOOT")
    assert code

    assert remote.wait_tracker_status("SUCCESSFUL") == "SUCCESSFUL"
    command = devices.command(code)
    assert [h["status"] for h in command["history"]] == COMMAND_STAGE_ORDER
    assert command["requested_by"] == creds.username

    # The simulated device went through a reboot and reconnected.
    device = devices.wait_for_status(online_device["device_id"], "ONLINE")
    reboot_events = devices.events(online_device["device_id"], event_type="REBOOT")["total"]
    reconnects = devices.events(online_device["device_id"], event_type="CONNECTED")["total"]
    assert reboot_events >= 1 and reconnects >= 1
    assert device["uptime_seconds"] is not None and device["uptime_seconds"] < 300

    details.select_tab("activity")
    expect(details.command_rows().filter(has_text=code)).to_have_count(1)
    audit = admin.wait_for_audit(action="COMMAND_REBOOT", username=creds.username, target=online_device["device_id"])
    assert audit["items"][0]["details"]["command_code"] == code
    capture(page, "workflow2_remote_reboot")


def test_workflow_firmware_deployment(page, credentials, device_factory, devices):
    """WORKFLOW 3: admin deploys firmware to selected devices and verifies the result on each device."""
    targets = [device_factory(model="VIP5662W") for _ in range(2)]
    firmware = devices.deployable_firmware("VIP5662W", targets[0]["firmware_version"])

    creds = credentials("admin")
    LoginPage(page).open().login(creds.username, creds.password)
    DashboardPage(page).navigate_via_sidebar("firmware")
    fw = FirmwarePage(page)
    fw.switch_tab("deployments")
    fw.open_create_dialog()
    fw.fill_deployment(factory.deployment_name(), firmware["version"], "VIP5662W")
    for t in targets:
        fw.select_target(t["device_id"])
    code = fw.submit_deployment()

    details = DeploymentDetailsPage(page)
    assert details.status() in {"SCHEDULED", "IN_PROGRESS", "COMPLETED"}
    assert details.wait_status(["COMPLETED", "COMPLETED_WITH_ERRORS", "FAILED"]) == "COMPLETED"
    assert details.counts()["successful"] == 2
    expect(details.target_rows()).to_have_count(2)

    for t in targets:
        device_page = DeviceDetailsPage(page).open_device(t["device_id"])
        assert device_page.field("detail-firmware") == firmware["version"]
        assert devices.get(t["device_id"])["firmware_version"] == firmware["version"]
    capture(page, "workflow3_firmware_deployment")


def test_workflow_role_based_access(page, browser, credentials, admin, track_user, base_url):
    """WORKFLOW 4: admin creates a support engineer, who is denied admin operations; admin reviews the audit."""
    admin_creds = credentials("admin")
    LoginPage(page).open().login(admin_creds.username, admin_creds.password)
    users = UserManagementPage(page).open()
    users.expect_loaded()
    new_user = factory.user_payload("SUPPORT_ENGINEER")
    track_user(new_user["username"])
    users.create_user(new_user)

    context = browser.new_context(base_url=base_url, viewport={"width": 1440, "height": 900})
    support = context.new_page()
    login = LoginPage(support).open()
    login.login(new_user["username"], new_user["password"])
    assert login.header_role() == "Support Engineer"
    # Allowed: inventory and remote operations.
    login.navigate_via_sidebar("device-inventory")
    expect(support.get_by_test_id("devices-table")).to_be_visible()
    expect(support.get_by_test_id("nav-users")).to_have_count(0)
    # Unauthorized administrative operation via UI and API.
    support.goto("/users")
    expect(support.get_by_test_id("access-denied")).to_be_visible()
    token = login.token()
    response = support.request.get(f"{base_url}/api/users", headers={"Authorization": f"Bearer {token}"})
    assert response.status == 403
    capture(support, "workflow4_access_denied")
    context.close()

    audit = AuditLogsPage(page).open()
    audit.expect_loaded()
    audit.apply_filters(username=new_user["username"], action="ACCESS_DENIED")
    expect(audit.rows().first).to_be_visible()
    assert set(audit.attr("data-result")) == {"DENIED"}
    created = admin.audit(action="USER_CREATED", target=new_user["username"])
    assert created["total"] == 1 and created["items"][0]["username"] == admin_creds.username
    assert_status(admin.c.get("/users"), 200)
    expect(page).to_have_url(re.compile("/audit-logs"))
