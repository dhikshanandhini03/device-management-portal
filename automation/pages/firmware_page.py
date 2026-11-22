import re

from playwright.sync_api import expect

from pages.base_page import BasePage


class FirmwarePage(BasePage):
    path = "/firmware"

    def open_tab(self, tab: str = "inventory"):
        self.open(f"{self.path}?tab={tab}")
        expect(self.by_id("firmware-page")).to_be_visible()
        return self

    def switch_tab(self, tab: str) -> None:
        self.by_id(f"tab-firmware-{tab}").click()
        self.wait_for_loaded()

    # inventory
    def firmware_rows(self):
        return self.page.get_by_test_id("firmware-row")

    def search(self, term: str) -> None:
        self.await_refresh(lambda: self.by_id("firmware-search").fill(term), "/api/firmware?")

    def filter_model(self, model: str) -> None:
        self.await_refresh(lambda: self.select_option("firmware-model-filter", model), "/api/firmware?")

    def filter_status(self, status_label: str) -> None:
        self.await_refresh(lambda: self.select_option("firmware-status-filter", status_label), "/api/firmware?")

    def versions(self) -> list[str]:
        return self.firmware_rows().evaluate_all("els => els.map(e => e.getAttribute('data-version'))")

    def models(self) -> list[str]:
        return self.firmware_rows().evaluate_all("els => els.map(e => e.getAttribute('data-model'))")

    def statuses(self) -> list[str]:
        return self.firmware_rows().get_by_test_id("cell-fw-status").locator("[data-status]").evaluate_all(
            "els => els.map(e => e.getAttribute('data-status'))")

    # deployments
    def deployment_rows(self):
        return self.page.get_by_test_id("deployment-row")

    def deployment_row(self, code: str):
        return self.page.locator(f"[data-testid='deployment-row'][data-code='{code}']")

    def open_create_dialog(self) -> None:
        self.by_id("create-deployment").click()
        expect(self.by_id("create-deployment-dialog")).to_be_visible()

    def fill_deployment(self, name: str, firmware_version: str, model: str) -> None:
        self.by_id("deployment-name").fill(name)
        combobox = self.by_id("deployment-firmware").locator("xpath=..").get_by_role("combobox")
        combobox.click()
        self.page.locator(f"[data-testid='deployment-firmware-option'][data-version='{firmware_version}'][data-model='{model}']").click()

    def choose_offline_policy(self, policy: str) -> None:
        self.by_id("policy-skip" if policy == "SKIP" else "policy-wait").click()

    def select_target(self, device_id: str) -> None:
        with self.page.expect_response(lambda r: "/firmware/eligible-devices" in r.url and "search=" in r.url):
            self.by_id("target-search").fill(device_id)
        row = self.page.locator(f"[data-testid='target-device-row'][data-device-id='{device_id}']")
        row.get_by_test_id("target-checkbox").check()

    def selected_target_count(self) -> int:
        return int(self.get_text("selected-target-count"))

    def submit_deployment(self) -> str:
        with self.page.expect_response(lambda r: r.url.endswith("/api/firmware/deployments") and r.request.method == "POST") as resp:
            self.by_id("deployment-submit").click()
        assert resp.value.status == 201, resp.value.text()
        code = resp.value.json()["deployment_code"]
        expect(self.page).to_have_url(re.compile(f"/firmware/deployments/{code}"))
        return code

    def filter_deployment_status(self, label: str) -> None:
        self.await_refresh(lambda: self.select_option("deployment-status-filter", label), "/firmware/deployments?")


class DeploymentDetailsPage(BasePage):
    def open_deployment(self, code: str):
        self.open(f"/firmware/deployments/{code}")
        expect(self.by_id("deployment-details-page")).to_be_visible()
        return self

    def status(self) -> str:
        return (self.by_id("deployment-status").get_attribute("data-status") or "").upper()

    def wait_status(self, statuses: list[str], timeout: float = 150_000) -> str:
        expect(self.by_id("deployment-status")).to_have_attribute("data-status", re.compile("^(" + "|".join(statuses) + ")$"), timeout=timeout)
        return self.status()

    def counts(self) -> dict[str, int]:
        return {k: int(self.get_text(f"dep-{k}-value")) for k in ("targets", "successful", "failed", "pending")}

    def progress(self) -> float:
        return float(self.get_text("dep-progress").rstrip("%"))

    def target_rows(self):
        return self.page.get_by_test_id("deployment-target-row")
