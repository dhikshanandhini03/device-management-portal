import re

from playwright.sync_api import expect

from pages.base_page import BasePage
from utils.helpers import parse_int

DIGITS = re.compile(r"^\d[\d,]*$")

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
        expect(self.by_id("dashboard-page")).to_be_visible()
        self.wait_for_stats()
        return self

    def wait_for_stats(self) -> None:
        expect(self.by_id(f"{STAT_CARDS['total']}-value")).to_have_text(DIGITS)

    def stat(self, name: str) -> int:
        return parse_int(self.get_text(f"{STAT_CARDS[name]}-value"))

    def all_stats(self) -> dict[str, int]:
        return {k: self.stat(k) for k in STAT_CARDS}

    def chart(self, test_id: str):
        return self.by_id(test_id)

    def chart_has_svg(self, test_id: str) -> bool:
        body = self.by_id(f"{test_id}-body")
        expect(body.locator("svg.recharts-surface").first).to_be_visible()
        return True

    def recent_alert_rows(self):
        return self.by_id("recent-alerts").get_by_test_id("recent-alert-row")

    def recent_event_rows(self):
        return self.by_id("recent-device-activity").get_by_test_id("recent-device-event-row")

    def click_stat(self, name: str) -> None:
        self.by_id(STAT_CARDS[name]).click()
