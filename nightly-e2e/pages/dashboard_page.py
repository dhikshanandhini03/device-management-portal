import re

from playwright.sync_api import expect

from pages.base_page import BasePage

STAT_CARDS = {
    "total": "stat-total-devices",
    "online": "stat-online-devices",
    "offline": "stat-offline-devices",
    "warning": "stat-warning-devices",
    "critical": "stat-critical-devices",
    "firmware": "stat-firmware-updates",
}
CHARTS = [
    "chart-online-offline",
    "chart-registration-trend",
    "chart-firmware-distribution",
    "chart-model-distribution",
    "chart-health-overview",
    "chart-recent-events",
]


class DashboardPage(BasePage):
    path = "/dashboard"

    def open(self, path: str | None = None):
        super().open(path)
        return self.expect_loaded()

    def expect_loaded(self):
        expect(self.by_id("dashboard-page")).to_be_visible()
        expect(self.by_id(f"{STAT_CARDS['total']}-value")).to_have_text(re.compile(r"^\d[\d,]*$"))
        return self

    def stat(self, name: str) -> int:
        return int(self.text(f"{STAT_CARDS[name]}-value").replace(",", ""))

    def expect_chart(self, test_id: str) -> None:
        expect(self.by_id(f"{test_id}-body").locator("svg.recharts-surface").first).to_be_visible()
