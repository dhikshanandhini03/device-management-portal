import re

from playwright.sync_api import Locator, expect

from config.settings import settings
from pages.base_page import BasePage

COMMAND_BUTTONS = {
    "REBOOT": "cmd-reboot",
    "SYNC_CONFIG": "cmd-sync-config",
    "REFRESH_INFO": "cmd-refresh-info",
    "RESTART_APP": "cmd-restart-app",
    "CLEAR_APP_CACHE": "cmd-clear-app-cache",
    "FACTORY_RESET": "cmd-factory-reset",
}


class DeviceInventoryPage(BasePage):
    path = "/devices"

    def open(self, path: str | None = None):
        super().open(path)
        return self.expect_loaded()

    def expect_loaded(self):
        expect(self.by_id("device-inventory-page")).to_be_visible()
        expect(self.by_id("devices-table").or_(self.by_id("empty-state"))).to_be_visible()
        return self

    @property
    def rows(self) -> Locator:
        return self.page.get_by_test_id("device-row")

    def search(self, term: str) -> None:
        box = self.by_id("device-search")
        box.fill(term)
        box.press("Enter")
        expect(self.page).to_have_url(re.compile(r"search="))
        self.wait_for_loaded()

    def filter_model(self, model: str) -> None:
        self.select_option("filter-model", model)
        expect(self.rows.get_by_test_id("cell-model").first).to_have_text(model)

    def total(self) -> int:
        text = self.by_id("pagination").locator(".MuiTablePagination-displayedRows").inner_text()
        return int(re.search(r"of\s+(?:more than\s+)?([\d,]+)", text).group(1).replace(",", ""))

    def column(self, cell_id: str) -> list[str]:
        return [t.strip() for t in self.rows.get_by_test_id(cell_id).all_inner_texts()]

    def open_device(self, device_id: str) -> None:
        self.page.locator(f"[data-testid='device-row'][data-device-id='{device_id}']").click()
        expect(self.by_id("device-title")).to_have_text(device_id)

    def register_device(self, data: dict) -> str:
        """Register a device through the dialog; returns the new device ID from the details page it opens."""
        self.by_id("register-device-button").click()
        expect(self.by_id("register-device-dialog")).to_be_visible()
        self.by_id("reg-serial").fill(data["serial_number"])
        self.by_id("reg-mac").fill(data["mac_address"])
        self.select_option("reg-model", data["model"])
        self.by_id("reg-hw").fill(data["hardware_version"])
        self.by_id("reg-ip").fill(data["ip_address"])
        self.by_id("reg-account").fill(data["customer_ref"])
        self.select_option("reg-region", data["region"])
        self.by_id("reg-city").fill(data["city"])
        self.select_by_label("Simulation profile", data["profile_label"])
        self.select_by_label("Initial status", data["status_label"])
        self.by_id("register-device-submit").click()
        device_id = f"STB-{data['serial_number'][-8:]}"
        expect(self.by_id("device-title")).to_have_text(device_id)
        return device_id


class DeviceDetailsPage(BasePage):
    def open_device(self, device_id: str, tab: str | None = None):
        self.open(f"/devices/{device_id}" + (f"?tab={tab}" if tab else ""))
        expect(self.by_id("device-title")).to_have_text(device_id)
        return self

    def field(self, test_id: str) -> str:
        return self.text(test_id)

    def header_status(self) -> str:
        return (self.by_id("header-status").get_attribute("data-status") or "").upper()

    def expect_status(self, status: str, timeout: float | None = None) -> None:
        expect(self.by_id("header-status")).to_have_attribute("data-status", re.compile(status, re.I), timeout=timeout)

    def select_tab(self, tab: str) -> None:
        self.by_id(f"tab-{tab}").click()
        expect(self.by_id(f"tabpanel-{tab}")).to_be_visible()
        self.wait_for_loaded()

    def event_rows(self) -> Locator:
        return self.page.get_by_test_id("event-row")

    def command_row(self, code: str) -> Locator:
        return self.by_id("device-command-history").locator(f"[data-testid='command-row'][data-command-code='{code}']")

    # ------------------------------------------------------------------ remote actions tab
    def open_remote_actions(self) -> None:
        self.by_id("open-remote-actions").click()
        expect(self.by_id("command-launcher")).to_be_visible()

    def command_button(self, command_type: str) -> Locator:
        return self.by_id(COMMAND_BUTTONS[command_type])

    def run_command(self, command_type: str, package_id: str | None = None) -> str:
        """Send a remote command through the confirmation dialog and return its command code."""
        self.command_button(command_type).click()
        expect(self.by_id("command-confirm")).to_be_visible()
        if package_id:
            self.select_option("command-app-select", package_id, exact=False)
        self.by_id("command-confirm-confirm").click()
        tracker = self.by_id("command-tracker")
        expect(tracker).to_have_attribute("data-command-code", re.compile(r"^CMD-"))
        code = tracker.get_attribute("data-command-code") or ""
        self.log.info("%s created as %s", command_type, code)
        return code

    def wait_command(self, statuses: list[str]) -> str:
        tracker = self.by_id("command-tracker")
        expect(tracker).to_have_attribute("data-status", re.compile("^(" + "|".join(statuses) + ")$"), timeout=settings.command_timeout_ms)
        return tracker.get_attribute("data-status") or ""
