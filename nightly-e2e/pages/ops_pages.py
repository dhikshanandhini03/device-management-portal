from playwright.sync_api import Locator, expect

from pages.base_page import BasePage

ANALYTICS_CHARTS = ["chart-availability", "chart-an-firmware", "chart-an-models", "chart-an-failures"]


class MonitoringPage(BasePage):
    path = "/monitoring"

    def open(self, path: str | None = None):
        super().open(path)
        expect(self.by_id("monitoring-page")).to_be_visible()
        expect(self.by_id("mon-cpu-value")).to_contain_text("%")
        return self

    def filter_logs(self, severity: str = "", device_id: str = "") -> None:
        if device_id:
            self.by_id("log-filter-device").fill(device_id)
        if severity:
            self.select_option("log-filter-severity", severity)
        self.by_id("log-filter-apply").click()
        self.wait_for_loaded()

    def log_rows(self) -> Locator:
        return self.page.get_by_test_id("diagnostic-log-row")

    def log_attr(self, name: str) -> list[str]:
        return self.log_rows().evaluate_all(f"els => els.map(e => e.getAttribute('{name}'))")

    def open_diagnostics(self, device_id: str):
        BasePage.open(self, f"/monitoring/devices/{device_id}")
        expect(self.by_id("device-diagnostics-page")).to_be_visible()
        expect(self.page.get_by_test_id("diagnostic-check-row").first).to_be_visible()
        return self

    def diagnostic_results(self) -> list[str]:
        return self.page.get_by_test_id("diagnostic-check-row").evaluate_all("els => els.map(e => e.getAttribute('data-result'))")


class AnalyticsPage(BasePage):
    path = "/analytics"

    def open(self, path: str | None = None):
        super().open(path)
        expect(self.by_id("analytics-page")).to_be_visible()
        return self

    def expect_chart(self, test_id: str) -> None:
        expect(self.by_id(f"{test_id}-body").locator("svg.recharts-surface").first).to_be_visible()

    def summary(self, key: str) -> str:
        return self.text(f"an-{key}-value")

    def export(self, report_label: str):
        self.select_option("report-type", report_label)
        return self.download("export-report")


class SettingsPage(BasePage):
    path = "/settings"

    def open(self, path: str | None = None):
        super().open(path)
        expect(self.by_id("settings-page")).to_be_visible()
        expect(self.by_id("settings-table")).to_be_visible()
        return self

    def setting_input(self, key: str) -> Locator:
        return self.by_id(f"setting-input-{key}")

    def set_number(self, key: str, value: int) -> None:
        self.setting_input(key).fill(str(value))
        self.by_id("save-settings").click()
        self.expect_toast("saved")
