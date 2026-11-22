import re

from playwright.sync_api import Locator, expect

from pages.base_page import BasePage

COMMAND_BUTTONS = {
    "REBOOT": "cmd-reboot",
    "SYNC_CONFIG": "cmd-sync-config",
    "REFRESH_INFO": "cmd-refresh-info",
    "RESTART_APP": "cmd-restart-app",
    "CLEAR_APP_CACHE": "cmd-clear-app-cache",
    "FACTORY_RESET": "cmd-factory-reset",
}


class RemoteManagementPage(BasePage):
    path = "/device-management"

    def open_for_device(self, device_id: str | None = None):
        self.open(f"{self.path}?device={device_id}" if device_id else self.path)
        expect(self.by_id("device-management-page")).to_be_visible()
        if device_id:
            expect(self.by_id("selected-device-id")).to_have_text(device_id)
        return self

    def select_device(self, search: str, device_id: str) -> None:
        picker = self.by_id("device-picker")
        picker.fill(search)
        self.page.get_by_test_id("device-picker-option").filter(has_text=device_id).first.click()
        expect(self.by_id("selected-device-id")).to_have_text(device_id)

    def selected_status(self) -> str:
        return (self.by_id("selected-device-status").get_attribute("data-status") or "").upper()

    def command_button(self, command_type: str) -> Locator:
        return self.by_id(COMMAND_BUTTONS[command_type])

    def start_command(self, command_type: str) -> None:
        self.command_button(command_type).click()
        expect(self.by_id("command-confirm")).to_be_visible()

    def choose_application(self, package_id: str) -> None:
        self.select_option("command-app-select", package_id, exact=False)

    def confirm(self, typed_confirmation: str | None = None) -> str:
        if typed_confirmation is not None:
            self.by_id("command-confirm-input").fill(typed_confirmation)
        with self.page.expect_response(lambda r: r.url.endswith("/api/commands") and r.request.method == "POST") as resp:
            self.by_id("command-confirm-confirm").click()
        response = resp.value
        if response.status != 201:
            return ""
        return response.json()["command_code"]

    def cancel(self) -> None:
        self.cancel_dialog("command-confirm")

    def run_command(self, command_type: str, package_id: str | None = None, confirmation: str | None = None) -> str:
        self.start_command(command_type)
        if package_id:
            self.choose_application(package_id)
        code = self.confirm(confirmation)
        if code:
            expect(self.by_id("command-tracker")).to_have_attribute("data-command-code", code)
        return code

    def confirm_button(self) -> Locator:
        return self.by_id("command-confirm-confirm")

    def dialog_error(self) -> str:
        return self.get_text("command-confirm-error")

    def tracker_status(self) -> str:
        return self.by_id("command-tracker").get_attribute("data-status") or ""

    def wait_tracker_status(self, statuses: str | list[str], timeout: float = 60_000) -> str:
        wanted = [statuses] if isinstance(statuses, str) else statuses
        expect(self.by_id("command-tracker")).to_have_attribute("data-status", re.compile("^(" + "|".join(wanted) + ")$"), timeout=timeout)
        return self.tracker_status()

    def tracker_result(self) -> str:
        return self.get_text("command-result")

    def history_rows(self) -> Locator:
        return self.page.get_by_test_id("command-history-table").first.get_by_test_id("command-row")

    def history_row(self, code: str) -> Locator:
        return self.page.locator(f"[data-testid='command-row'][data-command-code='{code}']")

    def filter_history_device(self, device_id: str) -> None:
        self.by_id("history-device-filter").fill(device_id)
        expect(self.history_rows().first).to_contain_text(device_id)
