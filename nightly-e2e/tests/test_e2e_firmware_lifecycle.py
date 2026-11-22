"""E2E: provision lab devices, validate beta firmware on them, then roll the deployment back."""

import pytest
from playwright.sync_api import expect

from pages.audit_logs_page import AuditLogsPage
from pages.devices_page import DeviceDetailsPage, DeviceInventoryPage
from pages.firmware_page import DeploymentDetailsPage, FirmwarePage
from utils import demo_data, test_data

pytestmark = [pytest.mark.end_to_end, pytest.mark.firmware]


def test_beta_rollout_and_rollback_on_lab_devices(login, page):
    login("admin")
    model = test_data.LAB_MODEL
    beta = demo_data.firmware(page, model, status="BETA")
    latest = demo_data.firmware(page, model, latest=True)
    assert beta and latest, f"seed data must contain BETA and latest firmware for {model}"

    # 1. Provision two lab devices; they come up on the model's latest firmware.
    lab_ids = []
    for _ in range(2):
        device_id = DeviceInventoryPage(page).open().register_device(test_data.lab_device(model))
        details = DeviceDetailsPage(page)
        details.expect_status("ONLINE")
        assert details.field("detail-firmware") == latest["version"]
        lab_ids.append(device_id)

    # 2. Deploy the beta build to the lab devices only.
    code = FirmwarePage(page).open_tab("deployments").create_deployment(
        f"Nightly beta validation {test_data.run_id()}", model, beta["version"], lab_ids)
    deployment = DeploymentDetailsPage(page).expect_loaded()
    assert deployment.wait_finished() == "COMPLETED"
    assert deployment.count("successful") == 2 and deployment.count("failed") == 0
    expect(deployment.target_rows()).to_have_count(2)
    for device_id in lab_ids:
        assert DeviceDetailsPage(page).open_device(device_id).field("detail-firmware") == beta["version"]

    # 3. Roll back and confirm the devices return to the previous release.
    rollback_code = DeploymentDetailsPage(page).open_deployment(code).rollback()
    assert rollback_code != code
    assert DeploymentDetailsPage(page).wait_finished() == "COMPLETED"
    for device_id in lab_ids:
        assert DeviceDetailsPage(page).open_device(device_id).field("detail-firmware") == latest["version"]
    assert DeploymentDetailsPage(page).open_deployment(code).status() == "ROLLED_BACK"

    # 4. Every step is in the audit trail.
    audit = AuditLogsPage(page).open()
    audit.expect_event("FIRMWARE_DEPLOYMENT_CREATED", username="admin", target=code)
    audit.expect_event("FIRMWARE_ROLLBACK_CREATED", username="admin", target=rollback_code)
    audit.expect_event("DEVICE_REGISTERED", username="admin", target=lab_ids[0])
