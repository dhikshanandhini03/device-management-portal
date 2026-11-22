import re

from playwright.sync_api import Locator, expect

from config.settings import settings
from pages.base_page import BasePage

FINISHED = ["COMPLETED", "COMPLETED_WITH_ERRORS", "FAILED", "CANCELLED"]


class FirmwarePage(BasePage):
    path = "/firmware"

    def open_tab(self, tab: str = "inventory"):
        self.open(f"{self.path}?tab={tab}")
        expect(self.by_id("firmware-page")).to_be_visible()
        return self

    def firmware_row(self, model: str, version: str) -> Locator:
        return self.page.locator(f"[data-testid='firmware-row'][data-model='{model}'][data-version='{version}']")

    def create_deployment(self, name: str, model: str, version: str, device_ids: list[str], policy: str = "WAIT") -> str:
        """Create a deployment via the dialog and return the deployment code from the details page URL."""
        self.by_id("create-deployment").click()
        expect(self.by_id("create-deployment-dialog")).to_be_visible()
        self.by_id("deployment-name").fill(name)
        self.by_id("deployment-firmware").locator("xpath=..").get_by_role("combobox").click()
        self.page.locator(f"[data-testid='deployment-firmware-option'][data-version='{version}'][data-model='{model}']").click()
        self.by_id("policy-skip" if policy == "SKIP" else "policy-wait").click()
        for device_id in device_ids:
            self.by_id("target-search").fill(device_id)
            row = self.page.locator(f"[data-testid='target-device-row'][data-device-id='{device_id}']")
            expect(row).to_be_visible()
            row.get_by_test_id("target-checkbox").check()
        expect(self.by_id("selected-target-count")).to_have_text(str(len(device_ids)))
        self.by_id("deployment-submit").click()
        expect(self.page).to_have_url(re.compile(r"/firmware/deployments/DEP-\d+"))
        code = self.page.url.rstrip("/").split("/")[-1]
        self.log.info("Deployment %s created for %s", code, device_ids)
        return code


class DeploymentDetailsPage(BasePage):
    def open_deployment(self, code: str):
        self.open(f"/firmware/deployments/{code}")
        return self.expect_loaded()

    def expect_loaded(self):
        expect(self.by_id("deployment-details-page")).to_be_visible()
        return self

    def status(self) -> str:
        return (self.by_id("deployment-status").get_attribute("data-status") or "").upper()

    def wait_finished(self) -> str:
        expect(self.by_id("deployment-status")).to_have_attribute(
            "data-status", re.compile("^(" + "|".join(FINISHED) + ")$"), timeout=settings.deployment_timeout_ms)
        return self.status()

    def count(self, key: str) -> int:
        return int(self.text(f"dep-{key}-value"))

    def target_rows(self) -> Locator:
        return self.page.get_by_test_id("deployment-target-row")

    def rollback(self) -> str:
        self.by_id("rollback-deployment").click()
        expect(self.by_id("deployment-confirm")).to_be_visible()
        original = self.page.url
        self.by_id("deployment-confirm-confirm").click()
        expect(self.page).not_to_have_url(original)
        expect(self.page).to_have_url(re.compile(r"/firmware/deployments/DEP-\d+"))
        self.expect_loaded()
        return self.page.url.rstrip("/").split("/")[-1]
