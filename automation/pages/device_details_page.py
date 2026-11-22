import re

from playwright.sync_api import expect

from pages.base_page import BasePage

TABS = ["overview", "network", "software", "hardware", "activity", "logs", "remote"]


class DeviceDetailsPage(BasePage):
    def open_device(self, device_id: str, tab: str | None = None):
        self.open(f"/devices/{device_id}" + (f"?tab={tab}" if tab else ""))
        expect(self.by_id("device-title")).to_have_text(device_id)
        return self

    def select_tab(self, tab: str) -> None:
        self.by_id(f"tab-{tab}").click()
        expect(self.by_id(f"tabpanel-{tab}")).to_be_visible()
        self.wait_for_loaded()

    def active_tab(self) -> str:
        return self.page.get_by_role("tab", selected=True).inner_text().strip()

    def field(self, test_id: str) -> str:
        return self.get_text(test_id)

    def overview(self) -> dict[str, str]:
        keys = {
            "device_id": "detail-device-id", "serial_number": "detail-serial", "mac_address": "detail-mac",
            "model": "detail-model", "hardware_version": "detail-hardware", "firmware_version": "detail-firmware",
            "os_version": "detail-os", "ip_address": "detail-ip", "customer_ref": "detail-customer",
            "connection_status": "detail-status", "uptime": "detail-uptime", "last_seen": "detail-last-seen",
        }
        return {k: self.field(v) for k, v in keys.items()}

    def header_status(self) -> str:
        return (self.by_id("header-status").get_attribute("data-status") or "").upper()

    def app_rows(self):
        return self.page.get_by_test_id("app-row")

    def app_packages(self) -> list[str]:
        return self.app_rows().evaluate_all("els => els.map(e => e.getAttribute('data-package'))")

    def app_version(self, package_id: str) -> str:
        return self.page.locator(f"[data-testid='app-row'][data-package='{package_id}']").get_by_test_id("app-version").inner_text()

    def gauge_value(self, name: str) -> str:
        return self.get_text(f"hw-{name}-value")

    def event_rows(self):
        return self.page.get_by_test_id("event-row")

    def filter_events(self, group: str) -> None:
        self.await_refresh(lambda: self.by_id(f"event-filter-{group}").click(), "/events")

    def log_rows(self):
        return self.page.get_by_test_id("log-row")

    def filter_logs(self, severity: str) -> None:
        self.await_refresh(lambda: self.select_option("log-severity-filter", severity), "/logs")

    def log_severities(self) -> list[str]:
        return self.log_rows().evaluate_all("els => els.map(e => e.getAttribute('data-severity'))")

    def command_rows(self):
        return self.by_id("device-command-history").get_by_test_id("command-row")
