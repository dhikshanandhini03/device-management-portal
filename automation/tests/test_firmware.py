import pytest
from playwright.sync_api import expect

from pages.firmware_page import DeploymentDetailsPage, FirmwarePage
from test_data.test_data_factory import DEVICES, deployment_name
from utils.assertions import assert_status

pytestmark = [pytest.mark.firmware, pytest.mark.regression]

MODEL = DEVICES["default_test_model"]


@pytest.fixture
def firmware_page(admin_page) -> FirmwarePage:
    return FirmwarePage(admin_page).open_tab("inventory")


@pytest.fixture
def target_firmware(devices, online_device) -> dict:
    """An ACTIVE firmware for the test model that differs from what new devices receive (the latest)."""
    return devices.deployable_firmware(MODEL, online_device["firmware_version"])


@pytest.mark.smoke
def test_view_firmware_inventory(firmware_page, devices):
    expect(firmware_page.firmware_rows().first).to_be_visible()
    assert firmware_page.firmware_rows().count() == len(devices.firmware())


def test_search_firmware_version(firmware_page, devices):
    version = devices.firmware(model=MODEL)[0]["version"]
    firmware_page.search(version)
    versions = firmware_page.versions()
    assert versions and all(version in v for v in versions)


def test_filter_firmware_by_model_and_status(firmware_page):
    firmware_page.filter_model(MODEL)
    assert set(firmware_page.models()) == {MODEL}
    firmware_page.filter_status("Deprecated")
    statuses = firmware_page.statuses()
    assert statuses and set(statuses) == {"DEPRECATED"}


def test_view_deployment_history(admin_page, devices):
    page = FirmwarePage(admin_page).open_tab("deployments")
    expect(page.deployment_rows().first).to_be_visible()
    api = devices.c.json("GET", "/firmware/deployments", params={"page_size": 15})
    # Parallel tests may add deployments; the page shows at most one page of 15.
    assert 0 < page.deployment_rows().count() <= 15
    assert api["total"] >= 10
    headers = [h.strip() for h in page.by_id("deployments-table").locator("thead th").all_inner_texts()]
    for col in ["Deployment ID", "Firmware", "Targets", "Successful", "Failed", "Pending", "Status", "Created"]:
        assert col in headers


@pytest.mark.smoke
def test_create_firmware_deployment(admin_page, device_factory, target_firmware, devices):
    targets = [device_factory(model=MODEL) for _ in range(2)]
    page = FirmwarePage(admin_page).open_tab("deployments")
    page.open_create_dialog()
    name = deployment_name()
    page.fill_deployment(name, target_firmware["version"], MODEL)
    for t in targets:
        page.select_target(t["device_id"])
    assert page.selected_target_count() == 2
    code = page.submit_deployment()
    dep = devices.deployment(code)
    assert dep["name"] == name and dep["firmware_version"] == target_firmware["version"]
    assert dep["target_count"] == 2
    target_ids = {t["device_id"] for t in devices.deployment_targets(code)["items"]}
    assert target_ids == {t["device_id"] for t in targets}


def test_select_target_devices_only_compatible(admin_page, target_firmware, devices):
    page = FirmwarePage(admin_page).open_tab("deployments")
    page.open_create_dialog()
    page.fill_deployment(deployment_name(), target_firmware["version"], MODEL)
    expect(page.page.get_by_test_id("target-device-row").first).to_be_visible()
    eligible = devices.c.json("GET", "/firmware/eligible-devices",
                              params={"firmware_version_id": target_firmware["id"], "page_size": 50})
    assert all(d["model"] == MODEL and d["firmware_version"] != target_firmware["version"] for d in eligible["items"])
    expect(page.by_id("deployment-submit")).to_be_disabled()


def test_deployment_validation_rejects_incompatible_device(devices, device_factory, target_firmware):
    other = device_factory(model="Fibe 4K Box (FTB-4K10)")
    r = devices.create_deployment({"name": deployment_name(), "firmware_version_id": target_firmware["id"],
                                   "device_ids": [other["device_id"]]})
    assert_status(r, 422)
    assert "not compatible" in r.json()["detail"]


def test_deployment_progress_and_device_firmware(admin_page, device_factory, target_firmware, devices):
    targets = [device_factory(model=MODEL) for _ in range(2)]
    r = devices.create_deployment({"name": deployment_name(), "firmware_version_id": target_firmware["id"],
                                   "device_ids": [t["device_id"] for t in targets]})
    assert_status(r, 201)
    code = r.json()["deployment_code"]
    details = DeploymentDetailsPage(admin_page).open_deployment(code)
    status = details.wait_status(["COMPLETED", "COMPLETED_WITH_ERRORS", "FAILED"])
    assert status == "COMPLETED"
    counts = details.counts()
    assert counts == {"targets": 2, "successful": 2, "failed": 0, "pending": 0}
    assert details.progress() == 100.0
    for t in targets:
        assert devices.get(t["device_id"])["firmware_version"] == target_firmware["version"]


def test_failed_device_counts(admin_page, device_factory, target_firmware, devices):
    online = device_factory(model=MODEL)
    offline = device_factory(model=MODEL, profile="STABLE_OFFLINE", status="OFFLINE")
    r = devices.create_deployment({"name": deployment_name(), "firmware_version_id": target_firmware["id"],
                                   "device_ids": [online["device_id"], offline["device_id"]], "offline_policy": "SKIP"})
    code = r.json()["deployment_code"]
    final = devices.wait_for_deployment(code)
    assert final["status"] == "COMPLETED_WITH_ERRORS"
    assert (final["successful_count"], final["failed_count"]) == (1, 1)
    failed = devices.deployment_targets(code, status="FAILED")["items"]
    assert [t["device_id"] for t in failed] == [offline["device_id"]]
    details = DeploymentDetailsPage(admin_page).open_deployment(code)
    assert details.counts()["failed"] == 1
    page = FirmwarePage(admin_page).open_tab("deployments")
    expect(page.deployment_row(code).get_by_test_id("cell-failed")).to_have_text("1")


def test_rollback_simulation(devices, device_factory, target_firmware):
    target = device_factory(model=MODEL)
    original_version = target["firmware_version"]
    code = devices.create_deployment({"name": deployment_name(), "firmware_version_id": target_firmware["id"],
                                      "device_ids": [target["device_id"]]}).json()["deployment_code"]
    assert devices.wait_for_deployment(code)["status"] == "COMPLETED"
    rollback = devices.c.post(f"/firmware/deployments/{code}/rollback")
    assert_status(rollback, 201)
    rb = devices.wait_for_deployment(rollback.json()["deployment_code"])
    assert rb["is_rollback"] and rb["status"] == "COMPLETED"
    assert devices.deployment(code)["status"] == "ROLLED_BACK"
    assert devices.get(target["device_id"])["firmware_version"] == original_version


@pytest.mark.parametrize("role", ["support", "readonly"])
def test_restricted_user_permissions(request, page, role, devices, online_device, target_firmware):
    page = request.getfixturevalue(f"{role}_page")
    client = request.getfixturevalue(f"{role}_api")
    fw = FirmwarePage(page).open_tab("deployments")
    expect(fw.by_id("deployments-table")).to_be_visible()
    expect(fw.by_id("create-deployment")).to_have_count(0)
    r = client.post("/firmware/deployments", json={"name": deployment_name(), "firmware_version_id": target_firmware["id"],
                                                   "device_ids": [online_device["device_id"]]})
    assert_status(r, 403)
