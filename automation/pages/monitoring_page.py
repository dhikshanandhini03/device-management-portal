from playwright.sync_api import expect

from pages.base_page import BasePage

STATS = {
    "cpu": "mon-cpu",
    "memory": "mon-memory",
    "storage": "mon-storage",
    "uptime": "mon-uptime",
    "connectivity": "mon-connectivity",
    "crashes": "mon-crashes",
    "errors": "mon-errors",
}


class MonitoringPage(BasePage):
    path = "/monitoring"

    def open(self, path: str | None = None):
        super().open(path)
        expect(self.by_id("monitoring-page")).to_be_visible()
        expect(self.by_id("mon-cpu-value")).to_contain_text("%")
        return self

    def stat(self, name: str) -> str:
        return self.get_text(f"{STATS[name]}-value")

    def health_chart_rendered(self) -> bool:
        expect(self.by_id("chart-health-history-body").locator("svg.recharts-surface").first).to_be_visible()
        return True

    def network_row(self, interface: str):
        return self.by_id(f"network-row-{interface}")

    def set_log_filters(self, device_id: str = "", serial: str = "", severity: str = "", category: str = "",
                        date_from: str = "", date_to: str = "") -> None:
        if device_id:
            self.by_id("log-filter-device").fill(device_id)
        if serial:
            self.by_id("log-filter-serial").fill(serial)
        if severity:
            self.select_option("log-filter-severity", severity)
        if category:
            self.select_option("log-filter-category", category)
        if date_from:
            self.by_id("log-filter-from").fill(date_from)
        if date_to:
            self.by_id("log-filter-to").fill(date_to)
        self.await_refresh(lambda: self.by_id("log-filter-apply").click(), "/api/monitoring/logs?")

    def log_rows(self):
        return self.page.get_by_test_id("diagnostic-log-row")

    def log_attr(self, attr: str) -> list[str]:
        return self.log_rows().evaluate_all(f"els => els.map(e => e.getAttribute('{attr}'))")

    def log_messages(self) -> list[str]:
        return self.column_texts(self.log_rows(), "diagnostic-log-message")

    def open_diagnostics_from_top(self) -> str:
        row = self.page.get_by_test_id("top-device-row").first
        device_id = row.locator("td").first.inner_text().strip()
        row.get_by_test_id("open-device-diagnostics").click()
        expect(self.by_id("device-diagnostics-page")).to_be_visible()
        return device_id

    def open_device_diagnostics(self, device_id: str):
        self.open(f"/monitoring/devices/{device_id}")
        expect(self.by_id("device-diagnostics-page")).to_be_visible()
        return self

    def diagnostic_checks(self) -> list[str]:
        return self.page.get_by_test_id("diagnostic-check-row").evaluate_all("els => els.map(e => e.getAttribute('data-result'))")
